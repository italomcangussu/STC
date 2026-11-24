-- R$ 300 contados duas vezes: um Pix pagou o Card Kids do José (R$ 100) e o Card do Matheus (R$ 200).
-- Entrou como receita solta "Mensalidades de Matheus e José" (16/11, por Henrique, pelo João, com comprovante)
-- e de novo como os dois Cards lançados pelo painel em 23/11 (pagamento em 09/11, validade até 09/12).
-- Decisão (Henrique, áudio de 24/11): ficam os Cards; sai a receita solta.
--
-- 1. Exclui a receita pelo mesmo caminho do botão "Excluir lançamento incorreto" (fin_remove_cash_movement):
--    anula o lançamento, guarda o snapshot em fin_private.cash_removed e passa pela auditoria. Nunca DELETE.
-- 2. Liga o comprovante do WhatsApp (intent 2a512c8b) aos dois Cards, que nasceram sem comprovante.
--    O anexo continua guardado na receita excluída (fin_attachments 92082e64).
-- Observação: o OCR do comprovante e o código E2E (E18236120202611161118…) dão o Pix em 16/11, não em 09/11.
-- A data dos Cards fica como está até o Henrique confirmar.
--
-- Rodar com begin; ... rollback; para ensaio; commit para aplicar. Ator: Ítalo (admin).
select set_config('request.jwt.claims', '{"sub":"a585c738-98cc-45bf-a80a-e555f9cc16e3","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'a585c738-98cc-45bf-a80a-e555f9cc16e3', true);

do $$
declare
  v_entry uuid := 'bad73f44-e971-4586-a250-880c386fef67';
  v_payment uuid;
  v_intent uuid := '2a512c8b-8920-49fe-b893-a210dd40ce2a';
  v_cards uuid[] := array['c7f98182-a74f-4a23-9c01-e322ee6c7679', 'cdace3e2-7c3e-4d61-83f1-23c64b98754c']::uuid[];
  v_linked integer;
begin
  select id into strict v_payment from public.fin_entry_payments where entry_id = v_entry and kind = 'payment';
  perform public.fin_remove_cash_movement(gen_random_uuid(), 'entry_payment', v_payment,
    'Duplicado: já registrado como Card do Matheus (R$ 200) e do José (R$ 100) em 09/11');

  update public.student_payments set receipt_intent_id = v_intent
  where id = any(v_cards) and status = 'active' and receipt_intent_id is null;
  get diagnostics v_linked = row_count;
  if v_linked <> 2 then raise exception 'esperava ligar 2 Cards ao comprovante, liguei %', v_linked; end if;
end $$;
