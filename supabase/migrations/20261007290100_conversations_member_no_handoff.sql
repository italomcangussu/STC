-- Trava: sócio (ou administrador) no privado nunca é transferido para atendimento humano. O João continua a conversa.
-- A mesma regra existe no servidor do turno (turn.ts); aqui é a segunda camada, para qualquer caminho que chame a função:
-- em conversa direta cujo solicitante está vinculado a um perfil socio/admin ativo, a transferência NÃO muda nada
-- (não vira `human`, não fecha a sessão, não reinicia a janela de contexto); fica só um registro de auditoria.
-- Grupo e pessoa sem vínculo seguem como antes.
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
  ) into v_member;
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
