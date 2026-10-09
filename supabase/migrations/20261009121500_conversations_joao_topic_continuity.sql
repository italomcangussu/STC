-- João: sessões técnicas podem terminar, mas assuntos pendentes não são descartados.
-- A fonte transacional continua sendo conv_booking_proposals: NÃO herdar autorizações entre sessões.
CREATE OR REPLACE FUNCTION conv_private.ai_context_continuity(p_session uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
  SELECT conv_private.ai_context(p_session)
     || jsonb_build_object('prior_memory', (
          SELECT old.memory
          FROM public.conv_ai_sessions current_session
          JOIN public.conv_ai_sessions old
            ON old.conversation_id = current_session.conversation_id
           AND old.requester_contact_id = current_session.requester_contact_id
           AND old.id <> current_session.id
          WHERE current_session.id = p_session
            AND old.started_at < current_session.started_at
            AND old.last_turn_at >= now() - interval '30 days'
          ORDER BY old.last_turn_at DESC
          LIMIT 1
        ))
$fn$;

REVOKE ALL ON FUNCTION conv_private.ai_context_continuity(uuid) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.conv_svc_ai_context(p_session uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO ''
AS $fn$ SELECT conv_private.ai_context_continuity(p_session) $fn$;

-- Guard de segurança no BANCO, independente do modelo: recusa não é aceite.
-- A checagem de proposta, solicitante, ordem temporal e idempotência continua nas RPCs existentes.
CREATE OR REPLACE FUNCTION conv_private.is_semantic_acceptance(p text, p_allow_cancel boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path TO ''
AS $fn$
DECLARE
  t text;
  words text[];
  positives text[] := ARRAY[
    'sim','isso','exato','exatamente','certo','correto','perfeito','confirmo','confirma',
    'confirmado','pode','claro','ok','okay','fechado','combinado','beleza','positivo',
    'aham','uhum','bora','vamos','topo','aceito','autorizo','aprovado','manda','prossiga'
  ];
  blockers text[] := ARRAY[
    'nao','nunca','jamais','negativo','recuso','recusado','desisto','desisti',
    'talvez','depois','espera','aguarda','aguarde','ainda','antes','duvida',
    'mas','porem','ou','se','so','apenas','troca','trocar','muda','mudar',
    'ignora','ignore','ignorar','reconsidera','reconsiderar','na','nao'
  ];
BEGIN
  IF p IS NULL OR length(p) > 160 OR position('?' IN p) > 0 THEN RETURN false; END IF;
  t := conv_private.fold(p);
  t := btrim(regexp_replace(regexp_replace(t, '[^a-z ]', ' ', 'g'), '[[:space:]]+', ' ', 'g'));
  IF t = '' THEN RETURN false; END IF;
  words := string_to_array(t, ' ');
  IF cardinality(words) > 12 THEN RETURN false; END IF;

  IF NOT p_allow_cancel THEN blockers := blockers || ARRAY['cancela','cancelar','cancelei']; END IF;
  IF words && blockers THEN RETURN false; END IF;

  -- Precisa começar por uma concordância reconhecível, nunca por um termo arbitrário.
  RETURN words[1] = ANY(positives)
    OR (cardinality(words) >= 2 AND words[1] = ANY(ARRAY['e','ta','esta','eh','bem'])
        AND words[2] = ANY(positives));
END $fn$;

-- Testes determinísticos de segurança; falha na migration se uma recusa parecer autorização.
DO $test$
BEGIN
  IF conv_private.is_semantic_acceptance('negativo', false)
     OR conv_private.is_semantic_acceptance('não quero', false)
     OR conv_private.is_semantic_acceptance('talvez pode lançar', false)
     OR conv_private.is_semantic_acceptance('não, pode fazer', false)
     OR NOT conv_private.is_semantic_acceptance('isso', false)
     OR NOT conv_private.is_semantic_acceptance('pode lançar', false)
     OR NOT conv_private.is_semantic_acceptance('exatamente', false)
  THEN RAISE EXCEPTION 'JOAO_CONFIRMATION_REGRESSION'; END IF;
END $test$;
