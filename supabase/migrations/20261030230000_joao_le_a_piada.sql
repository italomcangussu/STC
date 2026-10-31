-- O João lê a piada inteira no grupo do campeonato (Italo, 30/10): "ele precisa entender melhor as piadas, procurar
-- saber qual é o contexto; não é pegar pesado, é não ser genérico". O papo recente que chega ao turno era 12 mensagens
-- da última hora, sem horário, sem saber quem respondeu a quem, e foto/figurinha/áudio sem legenda chegavam vazios.
-- A resenha do "golpe de estado" (30/10) começou com a "sauna no Auge Open" e o "Kim Jong-un" bem antes do "kkk".
-- Agora cada linha leva a hora, a mensagem citada (reply_preview) e o tipo da mídia ("[foto] Só rapazes"). No grupo do
-- campeonato a janela vai a 40 mensagens das últimas 3 horas; nos outros grupos fica como era (12 da última hora).

create or replace function conv_private.ai_group_context(p_session uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare v_conv uuid; v_kind text; v_persona text; v_champ boolean;
begin
  select s.conversation_id, c.kind, g.championship_id is not null into v_conv, v_kind, v_champ
  from public.conv_ai_sessions s
  join public.conv_conversations c on c.id = s.conversation_id
  left join public.conv_groups g on g.id = c.group_id
  where s.id = p_session;
  if v_conv is null then raise exception 'SESSION_NOT_FOUND'; end if;
  if v_kind <> 'group' then return '[]'::jsonb; end if;

  select coalesce(a.persona_name, 'João Fonseca') into v_persona
  from public.conv_ai_settings a where a.active order by a.version desc limit 1;

  return (
    select coalesce(jsonb_agg(to_jsonb(x) - 'created_at' order by x.created_at), '[]'::jsonb)
    from (
      select m.created_at,
             to_char(m.created_at at time zone 'America/Fortaleza', 'HH24:MI') as at,
             case
               when m.direction = 'inbound' then coalesce(p.name, cc.name, 'Participante')
               when m.origin = 'ai' then v_persona
               when m.origin = 'automation' then 'Clube'
               else 'Equipe'
             end as sender,
             left(btrim(case m.kind
                    when 'text' then ''
                    when 'image' then '[foto] ' when 'sticker' then '[figurinha] ' when 'ptt' then '[áudio] '
                    when 'audio' then '[áudio] ' when 'video' then '[vídeo] ' when 'document' then '[documento] '
                    else '[' || m.kind || '] ' end || coalesce(m.body, '')), 320) as body,
             nullif(left(btrim(coalesce(m.reply_preview, '')), 140), '') as reply_to
      from public.conv_messages m
      left join public.conv_contacts cc on cc.id = m.sender_contact_id
      left join public.profiles p on p.id = cc.profile_id
      where m.conversation_id = v_conv
        and m.deleted_at is null
        and m.created_at > now() - case when v_champ then interval '3 hours' else interval '60 minutes' end
      order by m.created_at desc
      limit case when v_champ then 40 else 12 end
    ) x
  );
end $function$;

-- Rollback: reaplicar conv_private.ai_group_context de 20261007101000 (12 mensagens, 60 min, sem hora nem citação).
