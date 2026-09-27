-- ============================================================
-- PATCH: 1 AGENDAMENTO ATIVO POR DIA + CONTA DE CLIENTE POR TELEFONE
-- Execute no Supabase -> SQL Editor.
-- Pode ser executado depois dos SQLs anteriores.
-- ============================================================

-- 1) Atualiza o trigger de perfil para aceitar contas sem e-mail.
--    Clientes podem autenticar por telefone + senha.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text;
begin
  v_phone := coalesce(
    nullif(regexp_replace(coalesce(new.raw_user_meta_data ->> 'phone', ''), '\D', '', 'g'), ''),
    nullif(regexp_replace(coalesce(new.phone, ''), '\D', '', 'g'), '')
  );

  insert into public.profiles (id, full_name, phone, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    v_phone,
    'customer'
  )
  on conflict (id) do update set
    full_name = case
      when excluded.full_name <> '' then excluded.full_name
      else public.profiles.full_name
    end,
    phone = coalesce(excluded.phone, public.profiles.phone);

  return new;
end;
$$;

-- 2) Substitui a RPC pública de agendamento.
--    Regra:
--    - o mesmo telefone não pode ter dois agendamentos ativos no mesmo dia;
--    - se estiver logado, o mesmo user_id também não pode ter dois ativos no mesmo dia;
--    - a regra vale mesmo se escolher outro barbeiro.
create or replace function public.create_public_appointment(
  p_barber_id uuid,
  p_customer_name text,
  p_phone text,
  p_date date,
  p_time time,
  p_reminder_consent boolean default true,
  p_service_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_uid uuid := (select auth.uid());
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  if p_customer_name is null
     or char_length(trim(p_customer_name)) < 2
     or char_length(trim(p_customer_name)) > 80 then
    raise exception 'NOME_INVALIDO';
  end if;

  if v_phone !~ '^55[0-9]{10,11}$' then
    raise exception 'TELEFONE_INVALIDO';
  end if;

  if p_date < current_date then
    raise exception 'DATA_INVALIDA';
  end if;

  if not exists (
    select 1
    from public.barbers b
    where b.id = p_barber_id
      and b.active = true
  ) then
    raise exception 'BARBEIRO_INDISPONIVEL';
  end if;

  if p_service_id is not null
     and not exists (
       select 1
       from public.services s
       where s.id = p_service_id
         and s.active = true
     ) then
    raise exception 'SERVICO_INVALIDO';
  end if;

  -- Serializa tentativas simultâneas para o mesmo telefone/dia.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'barbearia-phone-day|' || v_phone || '|' || p_date::text,
      0
    )
  );

  if exists (
    select 1
    from public.appointments a
    where regexp_replace(a.phone, '\D', '', 'g') = v_phone
      and a.appointment_date = p_date
      and a.status in ('pending', 'confirmed')
  ) then
    raise exception 'JA_POSSUI_AGENDAMENTO_NO_DIA';
  end if;

  if v_uid is not null
     and exists (
       select 1
       from public.appointments a
       where a.user_id = v_uid
         and a.appointment_date = p_date
         and a.status in ('pending', 'confirmed')
     ) then
    raise exception 'JA_POSSUI_AGENDAMENTO_NO_DIA';
  end if;

  insert into public.appointments (
    user_id,
    barber_id,
    service_id,
    customer_name,
    phone,
    appointment_date,
    appointment_time,
    reminder_consent,
    status
  )
  values (
    v_uid,
    p_barber_id,
    p_service_id,
    trim(p_customer_name),
    v_phone,
    p_date,
    p_time,
    true,
    'confirmed'
  )
  returning id into v_id;

  return v_id;

exception
  when unique_violation then
    if exists (
      select 1
      from public.appointments a
      where regexp_replace(a.phone, '\D', '', 'g') = v_phone
        and a.appointment_date = p_date
        and a.status in ('pending', 'confirmed')
    ) then
      raise exception 'JA_POSSUI_AGENDAMENTO_NO_DIA';
    end if;

    raise exception 'HORARIO_INDISPONIVEL';
end;
$$;

revoke all on function public.create_public_appointment(
  uuid,text,text,date,time,boolean,uuid
) from public;

grant execute on function public.create_public_appointment(
  uuid,text,text,date,time,boolean,uuid
) to anon, authenticated;

-- 3) Permite que, depois de criar/login na conta pelo mesmo telefone,
--    o cliente associe agendamentos que fez anteriormente como visitante.
--    O telefone NÃO é recebido do navegador: é lido da própria conta autenticada.
create or replace function public.claim_my_guest_appointments()
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := (select auth.uid());
  v_phone text;
  v_count integer := 0;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select coalesce(
    nullif(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), ''),
    nullif(regexp_replace(coalesce(u.phone, ''), '\D', '', 'g'), '')
  )
  into v_phone
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = v_uid;

  if v_phone is null or v_phone = '' then
    raise exception 'PHONE_NOT_FOUND';
  end if;

  update public.appointments a
  set user_id = v_uid,
      updated_at = now()
  where a.user_id is null
    and regexp_replace(a.phone, '\D', '', 'g') = v_phone;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.claim_my_guest_appointments() from public;
grant execute on function public.claim_my_guest_appointments() to authenticated;
