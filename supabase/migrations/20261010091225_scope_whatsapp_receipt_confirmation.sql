-- "Sim" só confirma a proposta de classificação se ela foi a última pergunta do João.
-- Evita que um "sim" para reservar quadra ou outra operação confirme comprovante antigo.
do $scope$
declare v_sql text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_sql
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='conv_svc_receipt_confirm'
    and pg_get_function_identity_arguments(p.oid)='p_stage uuid, p_message uuid';
  if v_sql is null then raise exception 'RECEIPT_CONFIRM_FUNCTION_NOT_FOUND'; end if;
  if position('SCOPE_LAST_RECEIPT_PROPOSAL' in v_sql)>0 then return; end if;
  v_old := 'or trim(coalesce(m.body,';
  v_new := E'or not exists ( -- SCOPE_LAST_RECEIPT_PROPOSAL\n'||
    '       select 1 from public.conv_messages last_question'||
    '       where last_question.id = ('||
    '         select last.id from public.conv_messages last'||
    '         where last.conversation_id=s.conversation_id'||
    '           and last.direction=''outbound'' and last.created_at<m.created_at'||
    '         order by last.created_at desc,last.id desc limit 1)'||
    '         and last_question.body ilike ''Vou classificar o comprovante%'')'||
    E'\n    '||v_old;
  if position(v_old in v_sql)=0 then raise exception 'RECEIPT_CONFIRM_BODY_CHANGED'; end if;
  execute replace(v_sql,v_old,v_new);
end $scope$;
