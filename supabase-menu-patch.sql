-- PATCH: menu "Meus agendamentos"
-- Execute uma vez no Supabase SQL Editor.

create or replace function public.my_appointments()
returns table (
  id uuid,
  appointment_date date,
  appointment_time time,
  status text,
  barber_name text,
  service_name text,
  service_price numeric,
  created_at timestamptz
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

  return query
  select
    a.id,
    a.appointment_date,
    a.appointment_time,
    a.status,
    b.display_name,
    coalesce(s.name, 'Atendimento'),
    s.price,
    a.created_at
  from public.appointments a
  join public.barbers b on b.id = a.barber_id
  left join public.services s on s.id = a.service_id
  where a.user_id = (select auth.uid())
  order by a.appointment_date desc, a.appointment_time desc;
end;
$$;

revoke all on function public.my_appointments() from public;
grant execute on function public.my_appointments() to authenticated;
