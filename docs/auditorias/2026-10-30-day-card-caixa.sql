-- Saldo da Cora R$ 100 acima do banco (pedido do Ítalo em 30/10). Tudo pelas funções do financeiro, como administrador.
-- Causa: "Day Card entra no caixa" (fin_settings.day_card_in_cash) estava ligado desde 10/10, então cada reserva com
-- convidado somava R$ 50 na Cora sem pagamento registrado. Em outubro: Thiago 03/10, Glória 14/10, Osmar 28/10 e
-- Thiago 29/10 (este também lançado à mão em 30/10 como "Day use de um convidado": contado duas vezes).
-- Correção: desligar a opção. O Day Card passa a entrar no caixa só quando o recebimento é lançado.
-- Os Day Cards que chegaram de fato na Cora (conferir no extrato) devem ser lançados em "Outras receitas".
-- Rodar com begin; ... rollback; para ensaio; commit para aplicar.
select set_config('request.jwt.claims', '{"sub":"a585c738-98cc-45bf-a80a-e555f9cc16e3","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'a585c738-98cc-45bf-a80a-e555f9cc16e3', true);

do $$
declare v_ver int;
begin
  select version into v_ver from public.fin_settings;
  perform public.fin_save_settings(gen_random_uuid(), v_ver, jsonb_build_object('day_card_in_cash', false));
end $$;
