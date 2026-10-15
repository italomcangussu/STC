-- Defense in depth: nenhum caminho SQL deve autoquitar um comprovante do WhatsApp
-- sem finalidade e consentimento registrado em conversa posterior.
do $block$
declare v_sql text; v_target text; v_replace text;
begin
  select pg_get_functiondef(p.oid) into v_sql
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='fin_private' and p.proname='auto_approve_pendency_receipt'
  and pg_get_function_identity_arguments(p.oid)='p_submission uuid';
  if v_sql is null then raise exception 'AUTO_RECEIPT_FUNCTION_NOT_FOUND'; end if;
  if position('PURPOSE_CONFIRMATION_REQUIRED' in v_sql)>0 then return; end if;

  v_target:='if not found then return jsonb_build_object(''approved'',false,''reason'',''RECEIPT_NOT_FOUND''); end if;';
  v_replace:=v_target||E'\n  '||
   'if s.source = ''whatsapp'' and not exists ('||
   'select 1 from fin_private.whatsapp_receipt_intents wi '||
   'where wi.id=s.id and wi.status=''confirmed'' '||
   'and wi.purpose_kind in (''membership'',''member_pendency'') '||
   'and wi.confirmation_message_id is not null) then '||
   'return jsonb_build_object(''approved'',false,''reason'',''PURPOSE_CONFIRMATION_REQUIRED''); '||
   'end if;';
  if position(v_target in v_sql)=0 then raise exception 'AUTO_RECEIPT_BODY_CHANGED'; end if;
  execute replace(v_sql,v_target,v_replace);
end $block$;
