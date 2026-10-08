-- Assessor: o administrador pede um arquivo que o sistema já guarda (comprovante enviado por sócio, anexo de despesa, documento de
-- assinatura) e o João devolve no privado. Só localiza (somente leitura, N0, vai para o próprio administrador): devolve bucket, caminho,
-- nome e tipo; quem copia e envia é o servidor da conversa. Relatórios em PDF não passam por aqui: o servidor gera a partir de
-- conv_svc_ai_admin_read.
create function conv_private.ai_admin_file_lookup(p_session uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid; v_kind text := coalesce(p->>'kind', ''); v_profile uuid := nullif(p->>'profile_id', '')::uuid;
  v_today date := (now() at time zone 'America/Fortaleza')::date; v_from date; v_to date;
  v_text text := nullif(trim(coalesce(p->>'text', '')), ''); v_files jsonb;
begin
  v_admin := conv_private.ai_admin_requester(p_session);
  if v_admin is null then
    return conv_private.vfail('ADMIN_ONLY_PRIVATE', 'Isso só um administrador pede, e só na conversa privada comigo.');
  end if;
  begin
    v_from := coalesce(nullif(p->>'from', '')::date, v_today - 90);
    v_to := coalesce(nullif(p->>'to', '')::date, v_today);
  exception when others then
    return conv_private.vfail('INVALID_DATA', 'Não entendi o período. Pode dizer as datas?');
  end;
  if v_kind = 'comprovante' then
    select coalesce(jsonb_agg(f order by f.at desc), '[]'::jsonb) into v_files from (
      select jsonb_build_object('bucket', 'fin-receipts', 'path', s.storage_path, 'name', coalesce(s.file_name, 'comprovante'),
               'mime', coalesce(s.content_type, 'application/octet-stream'),
               'label', 'Comprovante de ' || coalesce(pr.name, 'sócio')
                 || case when s.declared_amount_cents is not null then ' (R$ ' || replace(to_char(s.declared_amount_cents / 100.0, 'FM999G990D00'), '.', ',') || ')' else '' end
                 || ' de ' || to_char(coalesce(s.declared_paid_on, (s.created_at at time zone 'America/Fortaleza')::date), 'DD/MM/YYYY')) f,
             s.created_at at
      from public.fin_receipt_submissions s left join public.profiles pr on pr.id = s.profile_id
      where s.status <> 'superseded' and s.storage_path is not null
        and (v_profile is null or s.profile_id = v_profile)
        and (s.created_at at time zone 'America/Fortaleza')::date between v_from and v_to
      order by s.created_at desc limit 5) x(f, at);
  elsif v_kind = 'despesa_anexo' then
    select coalesce(jsonb_agg(f order by f.at desc), '[]'::jsonb) into v_files from (
      select jsonb_build_object('bucket', 'fin-docs', 'path', a.storage_path, 'name', coalesce(a.file_name, 'anexo'),
               'mime', coalesce(a.content_type, 'application/octet-stream'),
               'label', 'Anexo de «' || coalesce(e.description, 'lançamento') || '»') f, a.uploaded_at at
      from public.fin_attachments a join public.fin_entries e on e.id = a.entry_id
      where a.removed_at is null and (v_text is null or e.description ilike '%' || v_text || '%' or e.supplier ilike '%' || v_text || '%')
        and (a.uploaded_at at time zone 'America/Fortaleza')::date between v_from and v_to
      order by a.uploaded_at desc limit 5) x(f, at);
  elsif v_kind = 'documento' then
    select coalesce(jsonb_agg(f order by f.at desc), '[]'::jsonb) into v_files from (
      select jsonb_build_object('bucket', 'sig-docs', 'path', d.storage_path, 'name', coalesce(d.file_name, d.title || '.pdf'),
               'mime', 'application/pdf', 'label', 'Documento «' || d.title || '»') f, d.created_at at
      from public.sig_documents d
      where d.archived_at is null and (v_text is null or d.title ilike '%' || v_text || '%')
      order by d.created_at desc limit 3) x(f, at);
  else
    return conv_private.vfail('INVALID_KIND', 'Esse tipo de arquivo eu não sei buscar.');
  end if;
  if jsonb_array_length(v_files) = 0 then
    return conv_private.vfail('NO_FILE', 'Não achei nenhum arquivo com esses dados. Quer tentar outro período ou nome?');
  end if;
  perform conv_private.audit('ai_admin_file', 'conv_ai_sessions', p_session::text, null,
    jsonb_build_object('kind', v_kind, 'count', jsonb_array_length(v_files)),
    jsonb_build_object('actor', 'ai', 'source', 'whatsapp', 'requester_profile_id', v_admin), v_admin);
  return jsonb_build_object('ok', true, 'files', v_files);
end $$;

create function public.conv_svc_ai_admin_file(p_session uuid, p jsonb) returns jsonb
language sql security definer set search_path = '' as $$ select conv_private.ai_admin_file_lookup(p_session, p) $$;

revoke all on function conv_private.ai_admin_file_lookup(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.conv_svc_ai_admin_file(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_admin_file(uuid, jsonb) to service_role;
