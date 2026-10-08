-- Fim da segunda confirmação de R$ 400,00 ou mais (regra de 20261007210000): o "sim" do administrador basta
-- para qualquer valor, como nos demais casos. A camada que repetia o valor vira só uma passagem para o passo seguinte
-- da cadeia de `ai_confirm` (a ordem dos renames das ondas continua a mesma).
create or replace function conv_private.ai_confirm_before_student_card(p_proposal uuid, p_message uuid) returns jsonb
language sql security definer set search_path = '' as $$
  select conv_private.ai_confirm_single_step(p_proposal, p_message)
$$;

revoke all on function conv_private.ai_confirm_before_student_card(uuid, uuid) from public, anon, authenticated;
