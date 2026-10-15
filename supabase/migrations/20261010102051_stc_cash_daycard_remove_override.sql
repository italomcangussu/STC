-- O Day Card incorreto permanece no histórico da reserva, mas não é cobrado.
create or replace function fin_private.day_card_rows(p_from date,p_to date)
returns table(reservation_id uuid,occurred_on date,guest_name text,booked_by text,exempt boolean,charged_cents bigint)
language plpgsql stable security definer set search_path=''
as $fn$
declare v_price bigint;
begin
  select day_card_price_cents into v_price from public.fin_settings;
  return query
  select r.id,r.date,trim(r.guest_name),
         (select p.name from public.profiles p where p.id=r.creator_id),
         (r.payment_status::text='exempt' or cd.source_id is not null),
         case when r.payment_status::text='exempt' or cd.source_id is not null then 0::bigint else v_price end
  from public.reservations r
  left join fin_private.cash_removed cd on cd.source_type='day_card' and cd.source_id=r.id::text
  where r.type='Play' and nullif(trim(coalesce(r.guest_name,'')),'') is not null
    and r.date between p_from and p_to and coalesce(r.status,'active')<>'cancelled'
  order by r.date,r.id;
end $fn$;
