-- As automações de pendência de sócio (cobrança, pagamento confirmado, comprovante em análise) usam estágios
-- que a validação não conhecia: apareciam com ESTAGIO_INVALIDO no painel e, pausadas, não voltavam a ser ativadas.
-- Só muda a lista de estágios aceitos; o resto da função é igual ao que está em produção.

CREATE OR REPLACE FUNCTION conv_private.automation_problems(a public.conv_automations)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_p text[] := '{}'; d jsonb := a.definition; s jsonb := a.schedule; k text; v_allowed text[] := conv_private.automation_vars(a.source);
  v_fee_ok boolean; v_date text; v_time text := s->>'time';
begin
  if length(trim(a.message_body)) = 0 then v_p := array_append(v_p, 'MENSAGEM_VAZIA'::text); end if;
  foreach k in array conv_private.template_vars(a.message_body) loop
    if not (k = any (v_allowed)) then v_p := array_append(v_p, 'VARIAVEL_INDISPONIVEL:' || k); end if;
  end loop;
  if 'encargos' = any (conv_private.template_vars(a.message_body)) then
    select (late_fee_confirmed_at is not null) into v_fee_ok from public.fin_settings where id;
    if not coalesce(v_fee_ok, false) then v_p := array_append(v_p, 'ENCARGOS_NAO_CONFIGURADOS'::text); end if;
  end if;

  if a.source = 'finance_charge' and coalesce(d->>'stage', '') not in ('period_start', 'before_due', 'overdue', 'in_review',
      'member_pendency', 'member_pendency_paid', 'member_pendency_receipt_review') then v_p := array_append(v_p, 'ESTAGIO_INVALIDO'::text); end if;
  if a.source in ('championship_notice') or (a.source = 'audience' and d->>'audience' = 'championship_participants') then
    if not exists (select 1 from public.championships c where c.id = nullif(d->>'championship_id', '')::uuid) then v_p := array_append(v_p, 'CAMPEONATO_OBRIGATORIO'::text); end if;
  end if;
  if a.source = 'audience' and coalesce(d->>'audience', '') not in ('members', 'students', 'dependents', 'professors', 'card_holders', 'championship_participants') then
    v_p := array_append(v_p, 'PUBLICO_INVALIDO'::text);
  end if;
  if a.source in ('championship_result', 'championship_advance') and nullif(d->>'championship_id', '') is not null
     and not exists (select 1 from public.championships c where c.id = (d->>'championship_id')::uuid) then v_p := array_append(v_p, 'CAMPEONATO_INEXISTENTE'::text); end if;

  if a.trigger_type = 'scheduled' then
    if v_time is null or conv_private.hhmm_to_min(v_time) is null then v_p := array_append(v_p, 'HORARIO_INVALIDO'::text); end if;
    if coalesce(jsonb_typeof(s->'dates') = 'array' and jsonb_array_length(s->'dates') > 0, false) then
      for v_date in select jsonb_array_elements_text(s->'dates') loop
        begin perform v_date::date; exception when others then v_p := array_append(v_p, 'DATA_INVALIDA'::text); end;
      end loop;
    elsif not coalesce(jsonb_typeof(s->'weekdays') = 'array' and jsonb_array_length(s->'weekdays') between 1 and 7, false) then
      v_p := array_append(v_p, 'RECORRENCIA_OBRIGATORIA'::text);
    end if;
  end if;
  return v_p;
end $function$;
