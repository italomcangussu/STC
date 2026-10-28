-- Confirmação de comprovante que não se perde (caso Romário, 28/10).
-- O PDF levou ~30 s para ser lido e a inscrição foi confirmada, mas a pessoa mandou outra mensagem no meio e a guarda
-- "esta ainda é a última mensagem?" calou a confirmação. Para avisos de algo que o servidor JÁ fez (Pix conferido,
-- inscrição confirmada), a guarda passa a ser só esta: a conversa segue aberta e com a IA (a equipe não assumiu).

create or replace function conv_private.ai_still_active(p_message uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.conv_messages m join public.conv_conversations cv on cv.id = m.conversation_id
                 where m.id = p_message and cv.status = 'open' and cv.ai_status = 'ai')
$$;
revoke all on function conv_private.ai_still_active(uuid) from public, anon, authenticated;

create or replace function public.conv_svc_ai_still_active(p_message uuid) returns boolean
language sql security definer set search_path = '' as $$ select conv_private.ai_still_active(p_message) $$;
revoke all on function public.conv_svc_ai_still_active(uuid) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_still_active(uuid) to service_role;

-- Rollback: drop function public.conv_svc_ai_still_active(uuid); drop function conv_private.ai_still_active(uuid);
