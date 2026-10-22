-- Auditoria do caixa de outubro/2026 (pedido do Ítalo em 22/10). Tudo pelas funções do financeiro, como administrador.
-- Rodar com begin; ... rollback; para ensaio; commit para aplicar.
select set_config('request.jwt.claims', '{"sub":"a585c738-98cc-45bf-a80a-e555f9cc16e3","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'a585c738-98cc-45bf-a80a-e555f9cc16e3', true);

do $$
declare
  v_italo uuid := 'a585c738-98cc-45bf-a80a-e555f9cc16e3';
  v_cora uuid := 'fd47ea74-dc76-4c80-b2a6-6fa5eb520465';
  v_ronaldo uuid := '76d1d8df-9309-4b24-b7e1-3133cf0fab2e';
  v_estrutura uuid := 'c2fb8165-d3c1-48f8-9630-6b5cbc1c8e77';
  v_quadras uuid := '0a778d20-6cb5-45fb-b830-18aea83fde12';
  v_cat_limpeza uuid; v_cat_predial uuid; v_entry uuid; v_ver int; v_plan uuid; v_charge uuid; v_fees bigint; v_res jsonb; v_new uuid;
  a public.fin_accounts%rowtype;
begin
  -- 1) Mensalidade do Igor lançada de novo em 10/10 como "Outras receitas": já entrou em 07/10 pelo comprovante.
  perform public.fin_remove_cash_movement(gen_random_uuid(), 'entry_payment', '096b72f8-ade2-416d-bf22-1bc79675ea88',
    'Auditoria 22/10: duplicidade da mensalidade do Igor Morais, já registrada em 07/10 pelo comprovante aprovado');

  -- 2) "Correção de saldo" de 08/10 (-293,19) foi calculada com a mensalidade do Igor contada duas vezes
  --    (o mesmo comprovante tinha baixado também em novembro do Hermeson, removido só em 10/10).
  --    A diferença real do início do sistema era +106,81: vai para o saldo inicial da Cora e a correção sai do caixa e da DRE.
  perform public.fin_remove_cash_movement(gen_random_uuid(), 'entry_payment', 'ad1f3b73-36bf-4bd7-83c2-4a65bf9679bc',
    'Auditoria 22/10: correção calculada com a mensalidade do Igor em dobro; diferença real (+106,81) foi para o saldo inicial da Cora');
  select * into a from public.fin_accounts where id = v_cora;
  perform public.fin_save_account(gen_random_uuid(), v_cora, a.version,
    jsonb_build_object('opening_balance_cents', a.opening_balance_cents + 10681));

  -- 3) Irmão do Matheus é Mensalista Kids: Card de R$ 100, não R$ 200 (comprovante de R$ 300 de 19/10 = 200 + 100).
  update public.non_socio_students set card_tier = 'kids' where id = 'd68dc276-070b-4601-866d-d39da690a1f4';
  update public.student_payments set amount = 100 where id = 'fe354744-53e8-444f-a6d5-604d3ece15da';
  update public.student_payments set receipt_intent_id = '3f5e07aa-dfcd-43dc-87b6-1390e8e1c555'
   where id in ('fe354744-53e8-444f-a6d5-604d3ece15da', 'a5869b7d-dac8-4996-b1e5-023bb53c811f');
  update fin_private.whatsapp_receipt_intents set status = 'confirmed', purpose_kind = 'student_card',
    purpose_detail = 'Card Mensal do Matheus (R$ 200) e do irmão José, Kids (R$ 100)', updated_at = now()
   where id = '3f5e07aa-dfcd-43dc-87b6-1390e8e1c555';
  update fin_private.whatsapp_receipt_intents set status = 'canceled', purpose_detail = 'Mesmo comprovante já usado (Cards do Matheus e do José)', updated_at = now()
   where id = 'cb061268-99db-4ad7-93e4-f4e8592f7941';

  -- 4) Ronaldo Rezende: plano de R$ 400 desde outubro; 1º mês com desconto de R$ 200 (entrou em 21/10) e pago com o comprovante.
  v_res := public.fin_create_member_plan(gen_random_uuid(), jsonb_build_object('profile_id', v_ronaldo, 'start_on', '2026-10-01',
    'amount_cents', 40000, 'notes', 'Entrou em 21/10/2026; 1º mês proporcional de R$ 200'));
  v_plan := (v_res->>'id')::uuid;
  perform public.fin_generate_member_charges(gen_random_uuid(), v_plan, null);
  select id into v_charge from public.fin_member_charges where plan_id = v_plan and competence_month = '2026-10-01' and status <> 'canceled';
  perform public.fin_adjust_charge(gen_random_uuid(), v_charge, 'discount', 20000, 'Primeiro mês proporcional: entrou no clube em 21/10/2026');
  perform conv_private.admin_receipt_materialize('416cbaf6-eacb-4140-9949-194bc50c7ddd', 'cf21f409-4afa-426f-9f3b-9a2036b1f5ae');
  update public.fin_receipt_submissions set profile_id = v_ronaldo,
    member_note = 'Mensalidade proporcional de outubro do sócio novo Ronaldo Rezende; pago em espécie e transferido por Diego Memória'
   where id = '416cbaf6-eacb-4140-9949-194bc50c7ddd';
  select st.fees_due into v_fees from fin_private.charge_statement(v_charge, '2026-10-21') st;
  perform public.fin_approve_receipt(gen_random_uuid(), '416cbaf6-eacb-4140-9949-194bc50c7ddd', jsonb_build_object(
    'paid_on', '2026-10-21', 'method', 'pix', 'account_id', v_cora,
    'allocations', jsonb_build_array(jsonb_build_object('charge_id', v_charge, 'amount_cents', 20000)),
    'waivers', case when coalesce(v_fees, 0) > 0 then jsonb_build_array(jsonb_build_object('charge_id', v_charge, 'amount_cents', v_fees,
      'reason', 'Sócio novo: mensalidade do mês de entrada')) else '[]'::jsonb end,
    'note', 'Auditoria 22/10: 1º mês proporcional do Ronaldo Rezende'));
  update fin_private.whatsapp_receipt_intents set status = 'canceled', purpose_detail = 'Mesmo comprovante já usado (mensalidade do Ronaldo)', updated_at = now()
   where id in ('7e74d582-8e74-49bd-ba47-9fcb03607450', '494973af-c769-4b38-9cf6-b0817a7a477e');

  -- 5) Categorias: "Materia de limpeza" foi criada como grupo (sem pai) e nunca podia ser escolhida.
  v_res := public.fin_save_category(gen_random_uuid(), null, null, jsonb_build_object('kind', 'expense', 'parent_id', v_estrutura, 'name', 'Material de limpeza'));
  v_cat_limpeza := (v_res->>'id')::uuid;
  v_res := public.fin_save_category(gen_random_uuid(), null, null, jsonb_build_object('kind', 'expense', 'parent_id', v_estrutura, 'name', 'Manutenção predial'));
  v_cat_predial := (v_res->>'id')::uuid;
  perform public.fin_save_category(gen_random_uuid(), '03d5ea19-4326-4a10-9fd4-f375fe87e9e4', 1, '{"active": false}'::jsonb);
  perform public.fin_save_category(gen_random_uuid(), '5f3b5c2c-c2e7-42f2-9bf3-c7771f10c73c', 1, '{"active": false}'::jsonb);

  -- 6) Despesas: categoria certa, "quadra" e o comprovante que chegou pelo WhatsApp como anexo.
  for v_entry, v_ver in select e.id, e.version from public.fin_entries e join public.fin_entry_payments x on x.entry_id = e.id
    where x.id = 'b5b330d2-1661-4149-a102-5dd9e0a56b96' loop
    perform public.fin_update_entry(gen_random_uuid(), v_entry, v_ver, jsonb_build_object('description', 'Manutenção de quadra', 'category_id', v_quadras),
      'Auditoria 22/10: descrição (quadra) e categoria');
    perform conv_private.attach_receipt_to_entry('52f75dca-c9fe-4b8a-8829-75e73059abae', v_entry, 'cf21f409-4afa-426f-9f3b-9a2036b1f5ae');
  end loop;
  for v_entry, v_ver in select e.id, e.version from public.fin_entries e join public.fin_entry_payments x on x.entry_id = e.id
    where x.id = '1b7d4120-3edf-43ce-a8be-0a84a933583e' loop
    perform public.fin_update_entry(gen_random_uuid(), v_entry, v_ver, jsonb_build_object('category_id', v_cat_predial), 'Auditoria 22/10: categoria');
    perform conv_private.attach_receipt_to_entry('270cad60-e504-4eb6-a16a-0abb0341db9e', v_entry, 'cf21f409-4afa-426f-9f3b-9a2036b1f5ae');
  end loop;
  for v_entry, v_ver in select e.id, e.version from public.fin_entries e join public.fin_entry_payments x on x.entry_id = e.id
    where x.id = 'fe8e1a10-8a25-4668-ab8d-0a484056c327' loop
    perform public.fin_update_entry(gen_random_uuid(), v_entry, v_ver, jsonb_build_object('category_id', v_quadras), 'Auditoria 22/10: categoria');
    perform conv_private.attach_receipt_to_entry('90198162-7c20-46a4-8485-e2a83aaae8d1', v_entry, 'cf21f409-4afa-426f-9f3b-9a2036b1f5ae');
  end loop;
  for v_entry, v_ver in select e.id, e.version from public.fin_entries e join public.fin_entry_payments x on x.entry_id = e.id
    where x.id = '3fb74832-2c74-4f61-82f6-8ff0718020f3' loop
    perform public.fin_update_entry(gen_random_uuid(), v_entry, v_ver, jsonb_build_object('category_id', v_cat_predial), 'Auditoria 22/10: categoria');
    perform conv_private.attach_receipt_to_entry('3b073e63-79cb-40b7-a2ed-c8bbb48b9e6e', v_entry, 'e94aef10-e42c-4760-a794-0bb719a073bf');
  end loop;

  -- 7) Material de limpeza: o PIX do Derlan (10/10, M. S. Bezerra de Souza) foi de R$ 140,00; o lançamento de 12/10
  --    (R$ 140,24) era a mesma compra pelo valor da nota. Fica um lançamento só, de R$ 140,00 em 10/10, com o comprovante.
  perform public.fin_remove_cash_movement(gen_random_uuid(), 'entry_payment', 'ea0b2962-e714-49dc-bfc5-26a61ea83943',
    'Auditoria 22/10: mesma compra do PIX de R$ 140,00 de 10/10 (nota de R$ 140,24); relançada pelo valor pago');
  v_res := public.fin_create_entry(gen_random_uuid(), jsonb_build_object('kind', 'expense', 'status', 'paid', 'description', 'Material de limpeza',
    'supplier', 'M. S. Bezerra de Souza LTDA', 'category_id', v_cat_limpeza, 'amount_cents', 14000, 'paid_on', '2026-10-10',
    'account_id', v_cora, 'notes', 'Nota de R$ 140,24; PIX de R$ 140,00 pago pelo Derlan'));
  v_new := (v_res->>'id')::uuid;
  update fin_private.whatsapp_receipt_intents set status = 'awaiting_confirmation' where id = '615a0e70-29a9-4a5b-b3a3-0fe2703e13ba';
  perform conv_private.attach_receipt_to_entry('615a0e70-29a9-4a5b-b3a3-0fe2703e13ba', v_new, 'e94aef10-e42c-4760-a794-0bb719a073bf');

  -- 8) Day Card do convidado do Lucas (05/10): já baixado em 11/10; os dois envios do mesmo comprovante saem da fila.
  update fin_private.whatsapp_receipt_intents set status = 'confirmed', purpose_kind = 'member_pendency',
    purpose_detail = 'Day Card do convidado de 05/10 (baixado em 11/10)', updated_at = now()
   where id = '5f1694a1-6668-4301-a0e6-37177231b516';
  update fin_private.whatsapp_receipt_intents set status = 'canceled', purpose_detail = 'Mesmo comprovante do Lucas (Day Card de 05/10, já baixado)', updated_at = now()
   where id = 'acd8e25f-7727-4821-89ba-6438d27f06a1';
end $$;

select round(sum(amount_cents) / 100.0, 2) saldo_cora from fin_private.cash_rows('2000-01-01', fin_private.today()) where account_id = 'fd47ea74-dc76-4c80-b2a6-6fa5eb520465';
