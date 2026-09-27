-- ============================================================
-- AGENDA AGENT — PATCH DE DISPOSITIVO / POLLING SUPABASE
-- Execute após o supabase.sql principal do site.
-- ============================================================

-- 1) Permite a role interna "device".
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('customer', 'barber', 'admin', 'device'));

-- 2) Dispositivos autorizados.
create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  last_seen timestamptz,
  battery_level integer,
  accessibility_enabled boolean,
  automation_enabled boolean,
  app_version text,
  created_at timestamptz not null default now()
);

alter table public.devices enable row level security;
revoke all on table public.devices from anon, authenticated;
grant select on table public.devices to authenticated;

drop policy if exists devices_select_own_or_admin on public.devices;
create policy devices_select_own_or_admin
on public.devices
for select
to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  )
);

-- 3) Colunas de claim e diagnóstico na fila.
alter table public.notification_jobs
  add column if not exists claimed_by_device_id uuid references public.devices(id) on delete set null,
  add column if not exists claimed_at timestamptz,
  add column if not exists delivery_detail text;

-- 4) Promove uma conta Auth já criada para dispositivo.
create or replace function public.promote_user_to_device(
  p_email text,
  p_name text
)
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
  set role = 'device', updated_at = now()
  where id = v_user_id;

  insert into public.devices (user_id, name, active)
  values (v_user_id, coalesce(nullif(trim(p_name), ''), 'Galaxy S5 Mini'), true)
  on conflict (user_id) do update set
    name = excluded.name,
    active = true;

  return v_user_id;
end;
$$;

revoke all on function public.promote_user_to_device(text,text)
from public, anon, authenticated;

-- 5) Claim atômico da próxima mensagem vencida.
create or replace function public.claim_next_notification()
returns table (
  job_id uuid,
  phone text,
  message text,
  scheduled_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device_id uuid;
begin
  select d.id into v_device_id
  from public.devices d
  join public.profiles p on p.id = d.user_id
  where d.user_id = (select auth.uid())
    and d.active = true
    and p.role = 'device'
  limit 1;

  if v_device_id is null then
    raise exception 'DEVICE_NOT_AUTHORIZED';
  end if;

  return query
  with candidate as (
    select n.id
    from public.notification_jobs n
    where (
      (n.status = 'pending' and n.scheduled_at <= now())
      or
      (n.status = 'processing' and n.claimed_at < now() - interval '10 minutes')
    )
    order by n.scheduled_at asc
    for update skip locked
    limit 1
  )
  update public.notification_jobs n
  set status = 'processing',
      attempts = n.attempts + 1,
      claimed_by_device_id = v_device_id,
      claimed_at = now(),
      last_error = null
  from candidate c
  where n.id = c.id
  returning n.id, n.phone, n.message, n.scheduled_at;
end;
$$;

revoke all on function public.claim_next_notification() from public;
grant execute on function public.claim_next_notification() to authenticated;

-- 6) Confirma envio.
create or replace function public.complete_notification(
  p_job_id uuid,
  p_detail text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device_id uuid;
  v_count integer;
begin
  select d.id into v_device_id
  from public.devices d
  join public.profiles p on p.id = d.user_id
  where d.user_id = (select auth.uid())
    and d.active = true
    and p.role = 'device'
  limit 1;

  if v_device_id is null then
    raise exception 'DEVICE_NOT_AUTHORIZED';
  end if;

  update public.notification_jobs
  set status = 'sent',
      sent_at = now(),
      delivery_detail = p_detail,
      last_error = null
  where id = p_job_id
    and status = 'processing'
    and claimed_by_device_id = v_device_id;

  get diagnostics v_count = row_count;
  if v_count = 0 then raise exception 'JOB_NOT_OWNED'; end if;
  return 'sent';
end;
$$;

revoke all on function public.complete_notification(uuid,text) from public;
grant execute on function public.complete_notification(uuid,text) to authenticated;

-- 7) Registra falha. Até 3 tentativas, volta para pending em 2 minutos.
create or replace function public.fail_notification(
  p_job_id uuid,
  p_error text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device_id uuid;
  v_attempts integer;
begin
  select d.id into v_device_id
  from public.devices d
  join public.profiles p on p.id = d.user_id
  where d.user_id = (select auth.uid())
    and d.active = true
    and p.role = 'device'
  limit 1;

  if v_device_id is null then
    raise exception 'DEVICE_NOT_AUTHORIZED';
  end if;

  select attempts into v_attempts
  from public.notification_jobs
  where id = p_job_id
    and claimed_by_device_id = v_device_id
  for update;

  if v_attempts is null then raise exception 'JOB_NOT_OWNED'; end if;

  if v_attempts < 3 then
    update public.notification_jobs
    set status = 'pending',
        scheduled_at = now() + interval '2 minutes',
        last_error = left(coalesce(p_error, 'UNKNOWN'), 500),
        claimed_by_device_id = null,
        claimed_at = null
    where id = p_job_id;
    return 'retry';
  else
    update public.notification_jobs
    set status = 'failed',
        last_error = left(coalesce(p_error, 'UNKNOWN'), 500),
        claimed_at = now()
    where id = p_job_id;
    return 'failed';
  end if;
end;
$$;

revoke all on function public.fail_notification(uuid,text) from public;
grant execute on function public.fail_notification(uuid,text) to authenticated;

-- 8) Heartbeat do S5 Mini.
create or replace function public.device_heartbeat(
  p_battery integer,
  p_accessibility boolean,
  p_automation boolean,
  p_app_version text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.devices d
  set last_seen = now(),
      battery_level = case when p_battery between 0 and 100 then p_battery else null end,
      accessibility_enabled = p_accessibility,
      automation_enabled = p_automation,
      app_version = left(coalesce(p_app_version,''), 80)
  where d.user_id = (select auth.uid())
    and d.active = true
    and exists (
      select 1 from public.profiles p
      where p.id = d.user_id and p.role = 'device'
    );

  get diagnostics v_count = row_count;
  if v_count = 0 then raise exception 'DEVICE_NOT_AUTHORIZED'; end if;
  return 'ok';
end;
$$;

revoke all on function public.device_heartbeat(integer,boolean,boolean,text) from public;
grant execute on function public.device_heartbeat(integer,boolean,boolean,text) to authenticated;
