-- ============================================================
-- BARBEARIA PRIME
-- SUPABASE: AUTH + BARBEIROS + AGENDAMENTOS + LEMBRETES + RLS
-- Execute TODO este arquivo no Supabase Dashboard -> SQL Editor.
-- ============================================================

create extension if not exists pgcrypto;

-- ----------------------------
-- PERFIS
-- ----------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text,
  role text not null default 'customer'
    check (role in ('customer', 'barber', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists role text not null default 'customer';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_role_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_role_check
      check (role in ('customer', 'barber', 'admin'));
  end if;
end $$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.raw_user_meta_data ->> 'phone',
    'customer'
  )
  on conflict (id) do update set
    full_name = excluded.full_name,
    phone = coalesce(excluded.phone, public.profiles.phone);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Impede que um usuário comum eleve o próprio papel pelo frontend.
create or replace function public.protect_profile_role()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select auth.uid()) is not null
     and new.role is distinct from old.role then
    raise exception 'ROLE_CHANGE_NOT_ALLOWED';
  end if;

  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists protect_profile_role_trigger on public.profiles;
create trigger protect_profile_role_trigger
before update on public.profiles
for each row execute procedure public.protect_profile_role();

alter table public.profiles enable row level security;

revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (full_name, phone, updated_at) on table public.profiles to authenticated;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

-- ----------------------------
-- BARBEIROS
-- ----------------------------
create table if not exists public.barbers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  display_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.barbers enable row level security;

revoke all on table public.barbers from anon, authenticated;
grant select on table public.barbers to authenticated;

drop policy if exists barbers_select_own_or_admin on public.barbers;
create policy barbers_select_own_or_admin
on public.barbers
for select
to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  )
);

-- Lista pública segura: não expõe user_id.
create or replace function public.list_active_barbers()
returns table (
  id uuid,
  display_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.display_name
  from public.barbers b
  where b.active = true
  order by b.display_name;
$$;

revoke all on function public.list_active_barbers() from public;
grant execute on function public.list_active_barbers() to anon, authenticated;

-- ----------------------------
-- SERVIÇOS
-- ----------------------------
create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  duration_minutes integer not null default 30
    check (duration_minutes between 10 and 480),
  price numeric(10,2),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.services enable row level security;

revoke all on table public.services from anon, authenticated;
grant select on table public.services to anon, authenticated;

drop policy if exists services_public_read on public.services;
create policy services_public_read
on public.services
for select
to anon, authenticated
using (active = true);

insert into public.services (name, duration_minutes, price, active)
values
  ('Corte', 30, 35.00, true),
  ('Barba', 30, 25.00, true),
  ('Corte + Barba', 60, 55.00, true)
on conflict (name) do nothing;

-- ----------------------------
-- AGENDAMENTOS
-- ----------------------------
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  barber_id uuid not null references public.barbers(id) on delete restrict,
  service_id uuid references public.services(id) on delete set null,
  customer_name text not null
    check (char_length(customer_name) between 2 and 80),
  phone text not null,
  appointment_date date not null,
  appointment_time time not null,
  reminder_consent boolean not null default false,
  status text not null default 'confirmed'
    check (status in ('pending','confirmed','completed','cancelled','no_show')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Migração se uma tabela antiga já existia.
alter table public.appointments
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists barber_id uuid references public.barbers(id) on delete restrict,
  add column if not exists service_id uuid references public.services(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

-- Remove índice antigo que ignorava barbeiro, caso exista.
drop index if exists public.appointments_unique_active_slot;

create unique index if not exists appointments_unique_active_slot_per_barber
on public.appointments (barber_id, appointment_date, appointment_time)
where status in ('pending','confirmed');

create index if not exists appointments_barber_date_idx
on public.appointments (barber_id, appointment_date, appointment_time);

alter table public.appointments enable row level security;

revoke all on table public.appointments from anon, authenticated;
grant select on table public.appointments to authenticated;
grant update (status, updated_at) on table public.appointments to authenticated;

-- Cliente autenticado vê somente os próprios agendamentos.
drop policy if exists appointments_customer_select_own on public.appointments;
create policy appointments_customer_select_own
on public.appointments
for select
to authenticated
using (user_id = (select auth.uid()));

-- Barbeiro vê somente os agendamentos ligados ao próprio perfil.
-- Admin vê todos.
drop policy if exists appointments_barber_select on public.appointments;
create policy appointments_barber_select
on public.appointments
for select
to authenticated
using (
  exists (
    select 1
    from public.barbers b
    where b.id = appointments.barber_id
      and b.user_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  )
);

drop policy if exists appointments_barber_update on public.appointments;
create policy appointments_barber_update
on public.appointments
for update
to authenticated
using (
  exists (
    select 1
    from public.barbers b
    where b.id = appointments.barber_id
      and b.user_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.barbers b
    where b.id = appointments.barber_id
      and b.user_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  )
);

-- ----------------------------
-- CONSULTA PÚBLICA DE HORÁRIOS
-- Retorna apenas horários ocupados, nunca nome ou telefone.
-- ----------------------------
create or replace function public.get_booked_times(
  p_date date,
  p_barber_id uuid
)
returns table (
  appointment_time time
)
language sql
stable
security definer
set search_path = public
as $$
  select a.appointment_time
  from public.appointments a
  join public.barbers b on b.id = a.barber_id
  where a.appointment_date = p_date
    and a.barber_id = p_barber_id
    and b.active = true
    and a.status in ('pending', 'confirmed')
  order by a.appointment_time;
$$;

revoke all on function public.get_booked_times(date, uuid) from public;
grant execute on function public.get_booked_times(date, uuid) to anon, authenticated;

-- ----------------------------
-- CRIAÇÃO PÚBLICA SEGURA DE AGENDAMENTO
-- Nenhum INSERT direto na tabela é concedido ao visitante.
-- ----------------------------
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
begin
  if p_customer_name is null
     or char_length(trim(p_customer_name)) < 2
     or char_length(trim(p_customer_name)) > 80 then
    raise exception 'NOME_INVALIDO';
  end if;

  if p_phone is null or p_phone !~ '^[0-9]{12,13}$' then
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
    (select auth.uid()),
    p_barber_id,
    p_service_id,
    trim(p_customer_name),
    p_phone,
    p_date,
    p_time,
    p_reminder_consent,
    'confirmed'
  )
  returning id into v_id;

  return v_id;

exception
  when unique_violation then
    raise exception 'HORARIO_INDISPONIVEL';
end;
$$;

revoke all on function public.create_public_appointment(uuid,text,text,date,time,boolean,uuid) from public;
grant execute on function public.create_public_appointment(uuid,text,text,date,time,boolean,uuid)
to anon, authenticated;

-- ----------------------------
-- FILA DE LEMBRETES PARA O APK
-- ----------------------------
create table if not exists public.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  barber_id uuid not null references public.barbers(id) on delete cascade,
  reminder_type text not null
    check (reminder_type in ('24h', '1h')),
  phone text not null,
  message text not null,
  scheduled_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending','processing','sent','failed','cancelled')),
  attempts integer not null default 0,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (appointment_id, reminder_type)
);

create index if not exists notification_jobs_pending_idx
on public.notification_jobs (status, scheduled_at);

alter table public.notification_jobs enable row level security;

revoke all on table public.notification_jobs from anon, authenticated;

-- O APK ganhará acesso controlado numa etapa própria de pareamento.
-- Por enquanto o navegador público e o cliente não conseguem ler essa fila.

create or replace function public.create_appointment_reminders()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_at timestamptz;
begin
  if new.reminder_consent is not true then
    return new;
  end if;

  v_at :=
    (new.appointment_date::text || ' ' || new.appointment_time::text)::timestamp
    at time zone 'America/Sao_Paulo';

  if v_at - interval '24 hours' > now() then
    insert into public.notification_jobs (
      appointment_id, barber_id, reminder_type, phone, message, scheduled_at
    )
    values (
      new.id,
      new.barber_id,
      '24h',
      new.phone,
      'Olá ' || new.customer_name ||
      '! Lembrando que seu horário na barbearia está marcado para amanhã às ' ||
      to_char(new.appointment_time, 'HH24:MI') || '.',
      v_at - interval '24 hours'
    )
    on conflict (appointment_id, reminder_type) do nothing;
  end if;

  if v_at - interval '1 hour' > now() then
    insert into public.notification_jobs (
      appointment_id, barber_id, reminder_type, phone, message, scheduled_at
    )
    values (
      new.id,
      new.barber_id,
      '1h',
      new.phone,
      'Olá ' || new.customer_name ||
      '! Seu atendimento na barbearia é daqui a 1 hora, às ' ||
      to_char(new.appointment_time, 'HH24:MI') || '. Estamos te aguardando!',
      v_at - interval '1 hour'
    )
    on conflict (appointment_id, reminder_type) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists appointment_create_reminders on public.appointments;
create trigger appointment_create_reminders
after insert on public.appointments
for each row execute procedure public.create_appointment_reminders();

create or replace function public.cancel_pending_reminders()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('cancelled', 'no_show')
     and old.status is distinct from new.status then
    update public.notification_jobs
    set status = 'cancelled'
    where appointment_id = new.id
      and status in ('pending', 'processing');
  end if;

  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists appointment_cancel_reminders on public.appointments;
create trigger appointment_cancel_reminders
before update on public.appointments
for each row execute procedure public.cancel_pending_reminders();

-- ----------------------------
-- FUNÇÃO DE SETUP DO BARBEIRO
-- Use SOMENTE no SQL Editor do Supabase.
-- Ela NÃO pode ser chamada pelo site.
-- ----------------------------
create or replace function public.promote_user_to_barber(
  p_email text,
  p_display_name text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid;
begin
  select u.id
  into v_user_id
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
  limit 1;

  if v_user_id is null then
    raise exception 'USUARIO_NAO_ENCONTRADO';
  end if;

  update public.profiles
  set role = 'barber',
      full_name = case
        when trim(coalesce(p_display_name,'')) <> '' then trim(p_display_name)
        else full_name
      end,
      updated_at = now()
  where id = v_user_id;

  insert into public.barbers (user_id, display_name, active)
  values (
    v_user_id,
    coalesce(nullif(trim(p_display_name), ''), p_email),
    true
  )
  on conflict (user_id) do update set
    display_name = excluded.display_name,
    active = true;

  return v_user_id;
end;
$$;

revoke all on function public.promote_user_to_barber(text,text)
from public, anon, authenticated;

-- Opcional: transforma uma conta em administradora geral.
create or replace function public.promote_user_to_admin(p_email text)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid;
begin
  select u.id into v_user_id
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
  limit 1;

  if v_user_id is null then
    raise exception 'USUARIO_NAO_ENCONTRADO';
  end if;

  update public.profiles
  set role = 'admin',
      updated_at = now()
  where id = v_user_id;

  return v_user_id;
end;
$$;

revoke all on function public.promote_user_to_admin(text)
from public, anon, authenticated;
