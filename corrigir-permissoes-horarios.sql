-- ============================================================
-- CORREÇÃO: PERMISSÕES PARA ALTERAR HORÁRIOS
-- Freitas Barbearia
--
-- Pode executar este arquivo inteiro no Supabase SQL Editor.
-- Ele não apaga barbeiros, clientes ou agendamentos.
-- ============================================================


-- 1. Garante que a tabela exista.
create table if not exists public.schedule_editors (
  barber_id uuid primary key
    references public.barbers(id)
    on delete cascade,

  can_edit boolean not null default false,

  updated_at timestamptz not null default now()
);


-- 2. RLS permanece ativado.
alter table public.schedule_editors
enable row level security;


-- O navegador NÃO acessa essa tabela diretamente.
-- O acesso será feito pelas funções SECURITY DEFINER abaixo.
revoke all
on table public.schedule_editors
from anon, authenticated;


-- 3. Garante uma linha para todo barbeiro existente.
insert into public.schedule_editors (
  barber_id,
  can_edit,
  updated_at
)
select
  b.id,
  false,
  now()
from public.barbers b
on conflict (barber_id)
do nothing;


-- 4. Garante que novos barbeiros recebam automaticamente
--    uma configuração de permissão.
create or replace function public.ensure_barber_schedule_editor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin

  insert into public.schedule_editors (
    barber_id,
    can_edit,
    updated_at
  )
  values (
    new.id,
    false,
    now()
  )
  on conflict (barber_id)
  do nothing;

  return new;

end;
$$;


drop trigger if exists barbers_create_schedule_editor
on public.barbers;


create trigger barbers_create_schedule_editor
after insert on public.barbers
for each row
execute procedure public.ensure_barber_schedule_editor();


-- 5. Lista os barbeiros e informa se cada um pode editar
--    os horários.
--
-- Somente role = admin pode executar com sucesso.
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

  if (select auth.uid()) is null then
    raise exception 'AUTH_REQUIRED';
  end if;


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
    b.id as barber_id,
    b.display_name::text as display_name,
    coalesce(se.can_edit, false)::boolean as can_edit

  from public.barbers b

  left join public.schedule_editors se
    on se.barber_id = b.id

  order by
    b.display_name asc;

end;
$$;


-- 6. Admin concede ou remove a permissão.
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

  if (select auth.uid()) is null then
    raise exception 'AUTH_REQUIRED';
  end if;


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


-- 7. Permissões das RPCs.
revoke all
on function public.admin_list_schedule_editors()
from public, anon;


grant execute
on function public.admin_list_schedule_editors()
to authenticated;


revoke all
on function public.admin_set_schedule_editor(uuid, boolean)
from public, anon;


grant execute
on function public.admin_set_schedule_editor(uuid, boolean)
to authenticated;


-- 8. Garante acesso ao schema para usuários autenticados.
grant usage
on schema public
to authenticated;


-- 9. Força o PostgREST/Supabase a reconhecer as funções novas.
notify pgrst, 'reload schema';


-- ============================================================
-- TESTE
--
-- Depois de executar, você pode conferir as funções com:
--
-- select proname
-- from pg_proc
-- where proname in (
--   'admin_list_schedule_editors',
--   'admin_set_schedule_editor'
-- );
-- ============================================================
