-- Financeiro do clube — Day Card dos convidados (4/5).
--
-- Quem paga o quê ao CLUBE (tudo abaixo é receita do clube; nada é repassado a
-- professor: o professor é pago pelo próprio aluno, por hora/aula, e isso NÃO entra
-- no financeiro do clube):
--
--   * Mensalidade do sócio ............ `fin_member_charges` (migration 2).
--   * Day Card ........................ taxa cobrada de um CONVIDADO (não-sócio) de um
--                                       sócio, para ter acesso ao clube por um dia. Nada
--                                       a ver com aula. Não há registro de pagamento no
--                                       STC: é DERIVADO da reserva com convidado
--                                       (`reservations.guest_name`), como o painel sempre fez.
--   * Aula avulsa e Card Mensal ....... taxas que o aluno NÃO-sócio paga ao clube para ter
--                                       acesso às aulas (a aula avulsa custa o mesmo que o
--                                       Day Card). São pagamentos REGISTRADOS em
--                                       `student_payments` (no app, o plano "Day Card" do
--                                       aluno é a Aula avulsa). Contam pelo que foi pago —
--                                       nunca por estimativa a partir da reserva —, e por isso
--                                       aula de aluno não gera receita derivada.
--
-- Nada é copiado das reservas: esta migration só cria a LEITURA do Day Card derivado.
-- Nenhuma tabela nova, nenhuma FK para reserva (o app exclui reservas).

-- ------------------------------------------------------------------
-- 1. Day Card derivado das reservas com convidado
-- ------------------------------------------------------------------
-- `exempt`: reserva marcada como isenta (`payment_status = 'exempt'`) vale R$ 0.
-- Reservas canceladas ficam de fora. Valor = `fin_settings.day_card_price_cents`.
create function fin_private.day_card_rows(p_from date, p_to date)
returns table(reservation_id uuid, occurred_on date, guest_name text, booked_by text, exempt boolean, charged_cents bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v_price bigint;
begin
  select day_card_price_cents into v_price from public.fin_settings;
  return query
  select r.id, r.date, trim(r.guest_name),
    (select p.name from public.profiles p where p.id = r.creator_id),
    (r.payment_status::text = 'exempt'),
    case when r.payment_status::text = 'exempt' then 0::bigint else v_price end
  from public.reservations r
  where r.type = 'Play' and nullif(trim(coalesce(r.guest_name, '')), '') is not null
    and r.date between p_from and p_to and coalesce(r.status, 'active') <> 'cancelled'
  order by r.date, r.id;
end $$;

create function public.fin_day_card_rows(p_from date, p_to date)
returns table(reservation_id uuid, occurred_on date, guest_name text, booked_by text, exempt boolean, charged_cents bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform fin_private.require_admin();
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 731 then raise exception 'INVALID_PERIOD'; end if;
  return query select * from fin_private.day_card_rows(p_from, p_to);
end $$;

-- ------------------------------------------------------------------
-- 2. Permissões
-- ------------------------------------------------------------------
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'fin\_%' loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
