-- Conversas · o João ouve áudio
-- A transcrição (Whisper via Groq, feita no whatsapp-webhook) fica em conv_messages.meta.transcription:
-- {status: ok|unclear|failed, text, low_confidence, confidence, model, language, seconds, reason, at}.
-- O corpo da mensagem não muda (continua "🎤 Áudio" ou a legenda): a tela mostra a transcrição à parte e
-- o turno da IA troca o corpo pelo texto ouvido só na hora de montar a conversa para o modelo.

create or replace function conv_private.set_message_transcription(p_message uuid, p jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_status text := p->>'status';
  v jsonb;
begin
  if v_status is null or v_status not in ('ok', 'unclear', 'failed') then raise exception 'INVALID_TRANSCRIPTION'; end if;
  -- Só as chaves conhecidas, com tipos conferidos: o resto do payload é descartado.
  v := jsonb_strip_nulls(jsonb_build_object(
    'status', v_status,
    'text', case when v_status = 'ok' then left(nullif(btrim(p->>'text'), ''), 4000) end,
    'low_confidence', case when v_status = 'ok' and jsonb_typeof(p->'low_confidence') = 'boolean' then p->'low_confidence' end,
    'confidence', case when jsonb_typeof(p->'confidence') = 'number' then p->'confidence' end,
    'model', left(p->>'model', 60),
    'language', left(p->>'language', 20),
    'seconds', case when jsonb_typeof(p->'seconds') = 'number' then p->'seconds' end,
    'reason', left(p->>'reason', 60),
    'at', now()));
  if v_status = 'ok' and v->>'text' is null then
    v := v || '{"status":"unclear","reason":"sem_texto"}'::jsonb;
  end if;
  update public.conv_messages
     set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('transcription', v)
   where id = p_message and kind in ('audio', 'ptt') and direction = 'inbound';
  return found;
end $$;

-- O turno pede as transcrições dos áudios que está para ler (ids vindos de conv_svc_ai_context).
-- p_ids em texto: id malformado é ignorado, não derruba o turno.
create or replace function conv_private.ai_audio_transcripts(p_ids text[]) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'transcription', m.meta->'transcription')), '[]'::jsonb)
  from public.conv_messages m
  where m.id in (
      select x::uuid from unnest(coalesce(p_ids, '{}')) x
      where x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' limit 50)
    and m.kind in ('audio', 'ptt') and m.deleted_at is null;
$$;

create or replace function public.conv_svc_set_message_transcription(p_message uuid, p jsonb) returns boolean
language sql security definer set search_path = '' as $$ select conv_private.set_message_transcription(p_message, p) $$;

create or replace function public.conv_svc_ai_audio_transcripts(p_ids text[]) returns jsonb
language sql stable security definer set search_path = '' as $$ select conv_private.ai_audio_transcripts(p_ids) $$;

revoke all on function conv_private.set_message_transcription(uuid, jsonb) from public, anon, authenticated;
revoke all on function conv_private.ai_audio_transcripts(text[]) from public, anon, authenticated;
revoke all on function public.conv_svc_set_message_transcription(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.conv_svc_ai_audio_transcripts(text[]) from public, anon, authenticated;
grant execute on function public.conv_svc_set_message_transcription(uuid, jsonb) to service_role;
grant execute on function public.conv_svc_ai_audio_transcripts(text[]) to service_role;
