-- Conversas · assessor de professor nunca vai para atendimento humano
--
-- O assessor fala em nome do professor (`conv_contact_delegates`, 20261016161000), mas `ai_handoff` só reconhecia sócio pelo
-- telefone vinculado ao cadastro, e o telefone do assessor não é vinculado de propósito. Resultado: a IA transferia a conversa
-- e ela ficava em `human`, sem o João responder. Agora a delegação válida conta como sócio no privado: a transferência é
-- bloqueada (fica só a auditoria `ai_handoff_blocked`), igual à trava de sócio.
-- Também devolve à IA as conversas de assessores que ficaram presas em `human` por transferência da IA (mesmo efeito do botão
-- "Devolver à IA" do painel). Conversa assumida por um atendente (sem `handoff_kind`) não é tocada.
-- Rollback: voltar `ai_handoff` ao corpo de 20261007290100_conversations_member_no_handoff.sql.

create or replace function conv_private.ai_handoff(p_session uuid, p_kind text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare sess public.conv_ai_sessions%rowtype; cv public.conv_conversations%rowtype; v_member boolean;
begin
  if p_kind not in ('soft', 'hard') then raise exception 'INVALID_HANDOFF'; end if;
  select * into sess from public.conv_ai_sessions where id = p_session for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  select * into cv from public.conv_conversations where id = sess.conversation_id for update;

  select exists (
    select 1 from public.conv_contacts c join public.profiles pr on pr.id = c.profile_id
    where c.id = sess.requester_contact_id and c.link_status in ('linked', 'manual')
      and pr.role::text in ('socio', 'admin') and coalesce(pr.is_active, true)
  ) or conv_private.contact_delegation(sess.requester_contact_id) is not null into v_member;
  if cv.kind = 'direct' and v_member then
    perform conv_private.audit('ai_handoff_blocked', 'conv_conversations', cv.id::text, null,
      jsonb_build_object('kind', p_kind, 'note', left(coalesce(p_note, ''), 300)),
      jsonb_build_object('actor', 'ai', 'session_id', p_session, 'reason', 'MEMBER_PRIVATE_NO_HANDOFF'));
    return;
  end if;

  update public.conv_conversations set
    ai_status = case when p_kind = 'hard' and kind = 'direct' then 'human' else ai_status end,
    handoff_kind = p_kind, handoff_note = left(p_note, 1000), handoff_at = now(),
    staff_read_at = case when p_kind = 'hard' then least(coalesce(staff_read_at, now()), now() - interval '1 second') else staff_read_at end
  where id = cv.id;
  if p_kind = 'hard' then
    update public.conv_ai_sessions set status = 'handoff', awaiting = false where id = p_session;
    update public.conv_booking_proposals set status = 'canceled' where session_id = p_session and status = 'open';
  end if;
  perform conv_private.audit('ai_handoff', 'conv_conversations', cv.id::text, null,
    jsonb_build_object('kind', p_kind, 'note', left(coalesce(p_note, ''), 300)), jsonb_build_object('actor', 'ai', 'session_id', p_session));
end $$;

-- Conversas de assessores presas em atendimento humano por transferência da IA voltam para o João.
with liberadas as (
  update public.conv_conversations cv set
    ai_status = 'ai', handled_by_human = false, handoff_kind = null, handoff_note = null, ai_turns = 0
  where cv.kind = 'direct' and cv.ai_status = 'human' and cv.handoff_kind is not null
    and conv_private.contact_delegation(cv.contact_id) is not null
  returning cv.id
)
select conv_private.audit('ai_status', 'conv_conversations', l.id::text, jsonb_build_object('ai_status', 'human'),
  jsonb_build_object('ai_status', 'ai'), jsonb_build_object('actor', 'migration', 'reason', 'DELEGATE_NO_HANDOFF'))
from liberadas l;
