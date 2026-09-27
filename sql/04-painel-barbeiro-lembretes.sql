-- ============================================================
-- PATCH: PAINEL DO BARBEIRO + LEMBRETES MANUAIS/AUTOMÁTICOS
--
-- Execute este arquivo inteiro no Supabase -> SQL Editor.
--
-- Requer que já existam:
-- profiles, barbers, appointments, services, notification_jobs
-- e o patch do dispositivo usado pelo Agenda Agent.
-- ============================================================


-- ============================================================
-- 1. REPARA CONTAS COM role='barber' QUE NÃO TENHAM LINHA
--    NA TABELA barbers.
-- ============================================================

insert into public.barbers (
  user_id,
  display_name,
  active
)
select
  p.id,
  coalesce(nullif(trim(p.full_name), ''), 'Barbeiro'),
  true
from public.profiles p
where p.role = 'barber'
and not exists (
  select 1
  from public.barbers b
  where b.user_id = p.id
)
on conflict (user_id) do nothing;


-- ============================================================
-- 2. CONFIGURAÇÃO DE LEMBRETES POR BARBEIRO
-- ============================================================

create table if not exists public.barber_settings (
  barber_id uuid primary key
    references public.barbers(id)
    on delete cascade,

  automatic_reminder_count integer
    not null
    default 2
    check (automatic_reminder_count between 0 and 4),

  updated_at timestamptz
    not null
    default now()
);

insert into public.barber_settings (
  barber_id,
  automatic_reminder_count
)
select
  b.id,
  2
from public.barbers b
on conflict (barber_id) do nothing;


create or replace function public.ensure_barber_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin

  insert into public.barber_settings (
    barber_id,
    automatic_reminder_count
  )
  values (
    new.id,
    2
  )
  on conflict (barber_id) do nothing;

  return new;

end;
$$;


drop trigger if exists barbers_create_settings
on public.barbers;

create trigger barbers_create_settings
after insert on public.barbers
for each row
execute procedure public.ensure_barber_settings();


alter table public.barber_settings
enable row level security;

revoke all
on table public.barber_settings
from anon, authenticated;

grant select
on table public.barber_settings
to authenticated;


-- ============================================================
-- 3. AJUSTA notification_jobs PARA SUPORTAR:
--    - lembretes automáticos variáveis
--    - múltiplos lembretes manuais
-- ============================================================

alter table public.notification_jobs
  add column if not exists job_source text
    not null
    default 'auto';

alter table public.notification_jobs
  drop constraint if exists notification_jobs_job_source_check;

alter table public.notification_jobs
  add constraint notification_jobs_job_source_check
  check (job_source in ('auto', 'manual'));


-- A constraint antiga permitia só reminder_type 24h ou 1h.
alter table public.notification_jobs
  drop constraint if exists notification_jobs_reminder_type_check;


-- A constraint antiga impedia mais de um lembrete manual.
alter table public.notification_jobs
  drop constraint if exists notification_jobs_appointment_id_reminder_type_key;


-- Garante somente um lembrete automático de cada tipo.
create unique index if not exists notification_jobs_auto_unique
on public.notification_jobs (
  appointment_id,
  reminder_type
)
where job_source = 'auto';


create index if not exists notification_jobs_appointment_idx
on public.notification_jobs (
  appointment_id,
  created_at
);


-- ============================================================
-- 4. FUNÇÕES AUXILIARES DE AUTORIZAÇÃO
-- ============================================================

create or replace function public.current_dashboard_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from public.profiles p
  where p.id = (select auth.uid())
    and p.role in ('barber', 'admin')
  limit 1;
$$;

revoke all
on function public.current_dashboard_role()
from public, anon;

grant execute
on function public.current_dashboard_role()
to authenticated;


-- ============================================================
-- 5. BARBEIROS QUE A CONTA PODE VER
-- ============================================================

create or replace function public.barber_dashboard_barbers()
returns table (
  barber_id uuid,
  display_name text,
  active boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
begin

  select p.role
  into v_role
  from public.profiles p
  where p.id = (select auth.uid())
  limit 1;

  if v_role = 'barber' then

    return query
    select
      b.id,
      b.display_name,
      b.active
    from public.barbers b
    where b.user_id = (select auth.uid())
    order by b.display_name;

  elsif v_role = 'admin' then

    return query
    select
      b.id,
      b.display_name,
      b.active
    from public.barbers b
    order by b.display_name;

  else

    raise exception 'DASHBOARD_NOT_AUTHORIZED';

  end if;

end;
$$;

revoke all
on function public.barber_dashboard_barbers()
from public, anon;

grant execute
on function public.barber_dashboard_barbers()
to authenticated;


-- ============================================================
-- 6. AGENDA DO BARBEIRO
--
-- Não depende do SELECT direto com RLS no navegador.
-- A função confere auth.uid() internamente.
-- ============================================================

create or replace function public.barber_dashboard_appointments(
  p_date date default null,
  p_upcoming boolean default true,
  p_status text default null,
  p_barber_id uuid default null
)
returns table (
  appointment_id uuid,
  customer_name text,
  phone text,
  appointment_date date,
  appointment_time time,
  status text,
  barber_id uuid,
  barber_name text,
  service_name text,
  pending_reminders bigint,
  sent_reminders bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  v_own_barber_id uuid;
begin

  select p.role
  into v_role
  from public.profiles p
  where p.id = (select auth.uid())
  limit 1;

  if v_role = 'barber' then

    select b.id
    into v_own_barber_id
    from public.barbers b
    where b.user_id = (select auth.uid())
      and b.active = true
    limit 1;

    if v_own_barber_id is null then
      raise exception 'BARBER_PROFILE_NOT_FOUND';
    end if;

  elsif v_role <> 'admin' then

    raise exception 'DASHBOARD_NOT_AUTHORIZED';

  end if;


  return query
  select
    a.id,
    a.customer_name,
    a.phone,
    a.appointment_date,
    a.appointment_time,
    a.status,
    a.barber_id,
    b.display_name,
    coalesce(s.name, 'Atendimento'),

    (
      select count(*)
      from public.notification_jobs nj
      where nj.appointment_id = a.id
        and nj.status in ('pending', 'processing')
    ) as pending_reminders,

    (
      select count(*)
      from public.notification_jobs nj
      where nj.appointment_id = a.id
        and nj.status = 'sent'
    ) as sent_reminders

  from public.appointments a

  join public.barbers b
    on b.id = a.barber_id

  left join public.services s
    on s.id = a.service_id

  where
    (
      (
        v_role = 'barber'
        and a.barber_id = v_own_barber_id
      )
      or
      (
        v_role = 'admin'
        and (
          p_barber_id is null
          or a.barber_id = p_barber_id
        )
      )
    )

    and
    (
      (
        p_upcoming = true
        and a.appointment_date >= current_date
      )
      or
      (
        p_upcoming = false
        and p_date is not null
        and a.appointment_date = p_date
      )
    )

    and
    (
      p_status is null
      or a.status = p_status
    )

  order by
    a.appointment_date asc,
    a.appointment_time asc;

end;
$$;


revoke all
on function public.barber_dashboard_appointments(
  date,
  boolean,
  text,
  uuid
)
from public, anon;

grant execute
on function public.barber_dashboard_appointments(
  date,
  boolean,
  text,
  uuid
)
to authenticated;


-- ============================================================
-- 7. ALTERAÇÃO DE STATUS PELO PAINEL
-- ============================================================

create or replace function public.barber_update_appointment_status(
  p_appointment_id uuid,
  p_status text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_allowed boolean := false;
begin

  if p_status not in (
    'pending',
    'confirmed',
    'completed',
    'cancelled',
    'no_show'
  ) then
    raise exception 'INVALID_STATUS';
  end if;


  select p.role
  into v_role
  from public.profiles p
  where p.id = (select auth.uid())
  limit 1;


  if v_role = 'admin' then

    v_allowed := true;

  elsif v_role = 'barber' then

    select exists (
      select 1
      from public.appointments a
      join public.barbers b
        on b.id = a.barber_id
      where a.id = p_appointment_id
        and b.user_id = (select auth.uid())
    )
    into v_allowed;

  end if;


  if not v_allowed then
    raise exception 'DASHBOARD_NOT_AUTHORIZED';
  end if;


  update public.appointments
  set
    status = p_status,
    updated_at = now()
  where id = p_appointment_id;


  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND';
  end if;


  return p_status;

end;
$$;


revoke all
on function public.barber_update_appointment_status(
  uuid,
  text
)
from public, anon;

grant execute
on function public.barber_update_appointment_status(
  uuid,
  text
)
to authenticated;


-- ============================================================
-- 8. CONFIGURAÇÃO ATUAL DOS LEMBRETES
-- ============================================================

create or replace function public.barber_get_reminder_settings(
  p_barber_id uuid default null
)
returns table (
  barber_id uuid,
  display_name text,
  automatic_reminder_count integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  v_target uuid;
begin

  select p.role
  into v_role
  from public.profiles p
  where p.id = (select auth.uid())
  limit 1;


  if v_role = 'barber' then

    select b.id
    into v_target
    from public.barbers b
    where b.user_id = (select auth.uid())
    limit 1;

  elsif v_role = 'admin' then

    v_target := p_barber_id;

  else

    raise exception 'DASHBOARD_NOT_AUTHORIZED';

  end if;


  if v_target is null then
    raise exception 'BARBER_REQUIRED';
  end if;


  return query
  select
    b.id,
    b.display_name,
    coalesce(bs.automatic_reminder_count, 2)
  from public.barbers b
  left join public.barber_settings bs
    on bs.barber_id = b.id
  where b.id = v_target;

end;
$$;


revoke all
on function public.barber_get_reminder_settings(uuid)
from public, anon;

grant execute
on function public.barber_get_reminder_settings(uuid)
to authenticated;


-- ============================================================
-- 9. GERA / REGERA OS LEMBRETES AUTOMÁTICOS
-- ============================================================

create or replace function public.rebuild_appointment_reminders(
  p_appointment_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a public.appointments%rowtype;
  v_count integer;
  v_at timestamptz;
  v_offsets integer[];
  v_minutes integer;
  v_type text;
  v_created integer := 0;
begin

  select *
  into v_a
  from public.appointments
  where id = p_appointment_id;

  if not found then
    return 0;
  end if;


  -- Não cria lembretes para atendimento encerrado.
  if v_a.status not in ('pending', 'confirmed') then
    return 0;
  end if;


  select coalesce(bs.automatic_reminder_count, 2)
  into v_count
  from public.barber_settings bs
  where bs.barber_id = v_a.barber_id;

  v_count := coalesce(v_count, 2);


  -- Remove somente automáticos ainda não enviados.
  delete from public.notification_jobs
  where appointment_id = v_a.id
    and job_source = 'auto'
    and status in ('pending', 'failed');


  v_at :=
    (
      v_a.appointment_date::text
      || ' '
      || v_a.appointment_time::text
    )::timestamp
    at time zone 'America/Sao_Paulo';


  v_offsets :=
    case v_count

      when 0 then
        array[]::integer[]

      when 1 then
        array[60]

      when 2 then
        array[1440, 60]

      when 3 then
        array[1440, 120, 60]

      else
        array[2880, 1440, 120, 60]

    end;


  foreach v_minutes in array v_offsets
  loop

    if v_at - make_interval(mins => v_minutes) > now() then

      v_type :=
        case v_minutes
          when 2880 then '48h'
          when 1440 then '24h'
          when 120 then '2h'
          when 60 then '1h'
          else v_minutes::text || 'min'
        end;


      insert into public.notification_jobs (
        appointment_id,
        barber_id,
        reminder_type,
        job_source,
        phone,
        message,
        scheduled_at,
        status
      )
      values (
        v_a.id,
        v_a.barber_id,
        v_type,
        'auto',
        v_a.phone,

        'Olá '
        || v_a.customer_name
        || '! Lembrete: seu horário na barbearia está marcado para '
        || to_char(v_a.appointment_date, 'DD/MM')
        || ' às '
        || to_char(v_a.appointment_time, 'HH24:MI')
        || '.',

        v_at - make_interval(mins => v_minutes),
        'pending'
      )
      on conflict do nothing;


      v_created := v_created + 1;

    end if;

  end loop;


  return v_created;

end;
$$;


revoke all
on function public.rebuild_appointment_reminders(uuid)
from public, anon, authenticated;


-- O trigger antigo continua existindo; substituímos sua implementação.
create or replace function public.create_appointment_reminders()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin

  if new.reminder_consent is true then
    perform public.rebuild_appointment_reminders(new.id);
  end if;

  return new;

end;
$$;


-- ============================================================
-- 10. ALTERA QUANTIDADE E REGERA AGENDAMENTOS FUTUROS
-- ============================================================

create or replace function public.barber_set_reminder_count(
  p_count integer,
  p_barber_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_target uuid;
  v_appointment record;
begin

  if p_count < 0 or p_count > 4 then
    raise exception 'INVALID_REMINDER_COUNT';
  end if;


  select p.role
  into v_role
  from public.profiles p
  where p.id = (select auth.uid())
  limit 1;


  if v_role = 'barber' then

    select b.id
    into v_target
    from public.barbers b
    where b.user_id = (select auth.uid())
    limit 1;

  elsif v_role = 'admin' then

    v_target := p_barber_id;

  else

    raise exception 'DASHBOARD_NOT_AUTHORIZED';

  end if;


  if v_target is null then
    raise exception 'BARBER_REQUIRED';
  end if;


  insert into public.barber_settings (
    barber_id,
    automatic_reminder_count,
    updated_at
  )
  values (
    v_target,
    p_count,
    now()
  )

  on conflict (barber_id)
  do update set
    automatic_reminder_count = excluded.automatic_reminder_count,
    updated_at = now();


  for v_appointment in

    select a.id
    from public.appointments a
    where a.barber_id = v_target
      and a.appointment_date >= current_date
      and a.status in ('pending', 'confirmed')

  loop

    perform public.rebuild_appointment_reminders(
      v_appointment.id
    );

  end loop;


  return p_count;

end;
$$;


revoke all
on function public.barber_set_reminder_count(integer,uuid)
from public, anon;

grant execute
on function public.barber_set_reminder_count(integer,uuid)
to authenticated;


-- ============================================================
-- 11. LEMBRETE MANUAL
--
-- Cria uma tarefa PENDING com scheduled_at = agora.
-- O Agenda Agent / S5 a pega no próximo polling.
-- ============================================================

create or replace function public.barber_queue_manual_reminder(
  p_appointment_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_a public.appointments%rowtype;
  v_job_id uuid;
  v_allowed boolean := false;
begin

  select p.role
  into v_role
  from public.profiles p
  where p.id = (select auth.uid())
  limit 1;


  select *
  into v_a
  from public.appointments
  where id = p_appointment_id;


  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND';
  end if;


  if v_role = 'admin' then

    v_allowed := true;

  elsif v_role = 'barber' then

    select exists (
      select 1
      from public.barbers b
      where b.id = v_a.barber_id
        and b.user_id = (select auth.uid())
    )
    into v_allowed;

  end if;


  if not v_allowed then
    raise exception 'DASHBOARD_NOT_AUTHORIZED';
  end if;


  if v_a.status not in ('pending', 'confirmed') then
    raise exception 'APPOINTMENT_NOT_ACTIVE';
  end if;


  -- Evita vários cliques seguidos gerando spam.
  if exists (
    select 1
    from public.notification_jobs nj
    where nj.appointment_id = p_appointment_id
      and nj.job_source = 'manual'
      and nj.status in ('pending', 'processing')
      and nj.created_at > now() - interval '5 minutes'
  ) then
    raise exception 'MANUAL_REMINDER_ALREADY_QUEUED';
  end if;


  insert into public.notification_jobs (
    appointment_id,
    barber_id,
    reminder_type,
    job_source,
    phone,
    message,
    scheduled_at,
    status
  )
  values (
    v_a.id,
    v_a.barber_id,
    'manual',
    'manual',
    v_a.phone,

    'Olá '
    || v_a.customer_name
    || '! Passando para lembrar que seu horário na barbearia está marcado para '
    || to_char(v_a.appointment_date, 'DD/MM')
    || ' às '
    || to_char(v_a.appointment_time, 'HH24:MI')
    || '.',

    now(),
    'pending'
  )
  returning id
  into v_job_id;


  return v_job_id;

end;
$$;


revoke all
on function public.barber_queue_manual_reminder(uuid)
from public, anon;

grant execute
on function public.barber_queue_manual_reminder(uuid)
to authenticated;


-- ============================================================
-- 12. CANCELAMENTO:
-- O trigger existente já cancela jobs pendentes/processing.
-- Mantemos o comportamento.
-- ============================================================


-- ============================================================
-- 13. ATUALIZA CACHE DO POSTGREST
-- ============================================================

notify pgrst, 'reload schema';
