-- Day Cards de outubro conferidos no extrato da Cora pelo Ítalo em 30/10 (continuação de 2026-10-30-day-card-caixa.sql).
-- Com o Day Card automático desligado, a Cora no app ficou R$ 100 abaixo do banco (R$ 18.790,67 x R$ 18.890,67).
-- Os dois Pix de R$ 50 que faltavam: Osmar em 28/10 (reserva do Carlos Carneiro) e Thiago em 03/10 (reserva do Diego Memória).
-- Mesma categoria do "Day use de um convidado" lançado em 29/10. O Day Card da Glória (14/10) não entrou na Cora.
-- Rodar com begin; ... rollback; para ensaio; commit para aplicar.
select set_config('request.jwt.claims', '{"sub":"a585c738-98cc-45bf-a80a-e555f9cc16e3","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'a585c738-98cc-45bf-a80a-e555f9cc16e3', true);

do $$
declare
  v_cora uuid := 'fd47ea74-dc76-4c80-b2a6-6fa5eb520465';
  v_cat uuid;
begin
  select category_id into strict v_cat from public.fin_entries where description = 'Day use de um convidado';
  perform public.fin_create_entry(gen_random_uuid(), jsonb_build_object('kind', 'revenue', 'status', 'paid',
    'description', 'Day Card — Thiago (convidado do Diego Memória)', 'category_id', v_cat, 'amount_cents', 5000,
    'paid_on', '2026-10-03', 'account_id', v_cora, 'notes', 'Pix conferido no extrato da Cora pelo Ítalo em 30/10'));
  perform public.fin_create_entry(gen_random_uuid(), jsonb_build_object('kind', 'revenue', 'status', 'paid',
    'description', 'Day Card — Osmar (convidado do Carlos Carneiro)', 'category_id', v_cat, 'amount_cents', 5000,
    'paid_on', '2026-10-28', 'account_id', v_cora, 'notes', 'Pix conferido no extrato da Cora pelo Ítalo em 30/10'));
end $$;
