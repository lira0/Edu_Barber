-- ============================================================
-- PATCH: FUNCIONAMENTO DA BARBEARIA
-- - dias e horários
-- - status automático/forçado
-- - admin sempre pode editar
-- - admin escolhe quais barbeiros também podem editar
-- ============================================================

-- 1) Configuração geral
create table if not exists public.business_settings (
  id integer primary key default 1
    check (id = 1),

  manual_mode text not null default 'automatic'
    check (manual_mode in ('automatic','open','closed')),

  updated_at timestamptz not null default now()
);

insert into public.business_settings (id, manual_mode)
values (1, 'automatic')
on conflict (id) do nothing;

alter table public.business_settings enable row level security;
revoke all on public.business_settings from anon, authenticated;


-- 2) Horários semanais
create table if not exists public.business_hours (
  weekday integer primary key
    check (weekday between 0 and 6),

  is_open boolean not null default false,

  open_time time not null default '09:00',
  close_time time not null default '18:00',

  updated_at timestamptz not null default now(),

  check (close_time > open_time)
);

alter table public.business_hours enable row level security;
revoke all on public.business_hours from anon, authenticated;

-- padrão inicial: seg-sáb 09:00-18:00 / domingo fechado
insert into public.business_hours (
  weekday, is_open, open_time, close_time
)
values
  (0, false, '09:00', '18:00'),
  (1, true,  '09:00', '18:00'),
  (2, true,  '09:00', '18:00'),
  (3, true,  '09:00', '18:00'),
  (4, true,  '09:00', '18:00'),
  (5, true,  '09:00', '18:00'),
  (6, true,  '09:00', '18:00')
on conflict (weekday) do nothing;


-- 3) Permissão para barbeiro editar horários
create table if not exists public.schedule_editors (
  barber_id uuid primary key
    references public.barbers(id)
    on delete cascade,

  can_edit boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.schedule_editors enable row level security;
revoke all on public.schedule_editors from anon, authenticated;

insert into public.schedule_editors (barber_id, can_edit)
select b.id, false
from public.barbers b
on conflict (barber_id) do nothing;


-- 4) Função auxiliar de permissão
create or replace function public.can_current_user_edit_schedule()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'admin'
    )
    or
    exists (
      select 1
      from public.barbers b
      join public.schedule_editors se
        on se.barber_id = b.id
      where b.user_id = (select auth.uid())
        and se.can_edit = true
    );
$$;

revoke all on function public.can_current_user_edit_schedule()
from public, anon;

grant execute on function public.can_current_user_edit_schedule()
to authenticated;


-- 5) Leitura pública dos horários
create or replace function public.public_get_business_hours()
returns table (
  weekday integer,
  is_open boolean,
  open_time time,
  close_time time
)
language sql
stable
security definer
set search_path = public
as $$
  select
    h.weekday,
    h.is_open,
    h.open_time,
    h.close_time
  from public.business_hours h
  order by h.weekday;
$$;

revoke all on function public.public_get_business_hours()
from public;

grant execute on function public.public_get_business_hours()
to anon, authenticated;


-- 6) Status atual aberto/fechado
create or replace function public.public_get_shop_status()
returns table (
  is_open_now boolean,
  manual_mode text,
  status_detail text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_mode text;
  v_now timestamp;
  v_day integer;
  v_time time;
  v_hours public.business_hours%rowtype;
  v_open boolean;
begin

  select bs.manual_mode
  into v_mode
  from public.business_settings bs
  where bs.id = 1;

  v_mode := coalesce(v_mode, 'automatic');

  if v_mode = 'open' then
    return query
    select true, v_mode, 'Aberta manualmente'::text;
    return;
  end if;

  if v_mode = 'closed' then
    return query
    select false, v_mode, 'Fechada manualmente'::text;
    return;
  end if;

  v_now := now() at time zone 'America/Sao_Paulo';
  v_day := extract(dow from v_now)::integer;
  v_time := v_now::time;

  select *
  into v_hours
  from public.business_hours
  where weekday = v_day;

  v_open :=
    coalesce(v_hours.is_open, false)
    and v_time >= v_hours.open_time
    and v_time < v_hours.close_time;

  return query
  select
    v_open,
    'automatic'::text,
    case
      when not coalesce(v_hours.is_open, false)
        then 'Fechada hoje'
      when v_open
        then 'Aberta até ' || to_char(v_hours.close_time, 'HH24:MI')
      when v_time < v_hours.open_time
        then 'Abre às ' || to_char(v_hours.open_time, 'HH24:MI')
      else 'Fechada por hoje'
    end::text;

end;
$$;

revoke all on function public.public_get_shop_status()
from public;

grant execute on function public.public_get_shop_status()
to anon, authenticated;


-- 7) Dashboard: lê configuração + se pode editar
create or replace function public.dashboard_get_business_hours()
returns table (
  weekday integer,
  is_open boolean,
  open_time time,
  close_time time,
  manual_mode text,
  can_edit boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  v_can_edit boolean;
  v_mode text;
begin

  select p.role
  into v_role
  from public.profiles p
  where p.id = (select auth.uid())
  limit 1;

  if v_role not in ('barber','admin') then
    raise exception 'DASHBOARD_NOT_AUTHORIZED';
  end if;

  v_can_edit := public.can_current_user_edit_schedule();

  select bs.manual_mode
  into v_mode
  from public.business_settings bs
  where bs.id = 1;

  return query
  select
    h.weekday,
    h.is_open,
    h.open_time,
    h.close_time,
    coalesce(v_mode, 'automatic'),
    v_can_edit
  from public.business_hours h
  order by h.weekday;

end;
$$;

revoke all on function public.dashboard_get_business_hours()
from public, anon;

grant execute on function public.dashboard_get_business_hours()
to authenticated;


-- 8) Salvar um dia
create or replace function public.dashboard_save_business_day(
  p_weekday integer,
  p_is_open boolean,
  p_open_time time,
  p_close_time time
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin

  if not public.can_current_user_edit_schedule() then
    raise exception 'SCHEDULE_EDIT_NOT_AUTHORIZED';
  end if;

  if p_weekday < 0 or p_weekday > 6 then
    raise exception 'INVALID_WEEKDAY';
  end if;

  if p_close_time <= p_open_time then
    raise exception 'INVALID_TIME_RANGE';
  end if;

  insert into public.business_hours (
    weekday,
    is_open,
    open_time,
    close_time,
    updated_at
  )
  values (
    p_weekday,
    p_is_open,
    p_open_time,
    p_close_time,
    now()
  )
  on conflict (weekday)
  do update set
    is_open = excluded.is_open,
    open_time = excluded.open_time,
    close_time = excluded.close_time,
    updated_at = now();

  return true;

end;
$$;

revoke all on function public.dashboard_save_business_day(
  integer, boolean, time, time
)
from public, anon;

grant execute on function public.dashboard_save_business_day(
  integer, boolean, time, time
)
to authenticated;


-- 9) Salvar modo aberto/fechado
create or replace function public.dashboard_set_shop_mode(
  p_mode text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin

  if not public.can_current_user_edit_schedule() then
    raise exception 'SCHEDULE_EDIT_NOT_AUTHORIZED';
  end if;

  if p_mode not in ('automatic','open','closed') then
    raise exception 'INVALID_SHOP_MODE';
  end if;

  insert into public.business_settings (
    id,
    manual_mode,
    updated_at
  )
  values (
    1,
    p_mode,
    now()
  )
  on conflict (id)
  do update set
    manual_mode = excluded.manual_mode,
    updated_at = now();

  return p_mode;

end;
$$;

revoke all on function public.dashboard_set_shop_mode(text)
from public, anon;

grant execute on function public.dashboard_set_shop_mode(text)
to authenticated;


-- 10) Admin lista barbeiros e permissões
create or replace function public.admin_list_schedule_editors()
returns table (
  barber_id uuid,
  display_name text,
  can_edit boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin

  if not exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  ) then
    raise exception 'ADMIN_REQUIRED';
  end if;

  return query
  select
    b.id,
    b.display_name,
    coalesce(se.can_edit, false)
  from public.barbers b
  left join public.schedule_editors se
    on se.barber_id = b.id
  order by b.display_name;

end;
$$;

revoke all on function public.admin_list_schedule_editors()
from public, anon;

grant execute on function public.admin_list_schedule_editors()
to authenticated;


-- 11) Admin concede/remove permissão
create or replace function public.admin_set_schedule_editor(
  p_barber_id uuid,
  p_can_edit boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin

  if not exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  ) then
    raise exception 'ADMIN_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.barbers b
    where b.id = p_barber_id
  ) then
    raise exception 'BARBER_NOT_FOUND';
  end if;

  insert into public.schedule_editors (
    barber_id,
    can_edit,
    updated_at
  )
  values (
    p_barber_id,
    p_can_edit,
    now()
  )
  on conflict (barber_id)
  do update set
    can_edit = excluded.can_edit,
    updated_at = now();

  return p_can_edit;

end;
$$;

revoke all on function public.admin_set_schedule_editor(uuid,boolean)
from public, anon;

grant execute on function public.admin_set_schedule_editor(uuid,boolean)
to authenticated;


-- 12) Reforça criação automática da permissão ao criar barbeiro
create or replace function public.ensure_barber_schedule_editor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.schedule_editors (
    barber_id,
    can_edit
  )
  values (
    new.id,
    false
  )
  on conflict (barber_id) do nothing;

  return new;
end;
$$;

drop trigger if exists barbers_create_schedule_editor
on public.barbers;

create trigger barbers_create_schedule_editor
after insert on public.barbers
for each row
execute procedure public.ensure_barber_schedule_editor();


-- 13) Atualiza cache da API
notify pgrst, 'reload schema';
