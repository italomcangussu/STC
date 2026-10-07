-- Onda 1 do assessor administrativo: consultas (só leitura) sob demanda, por domínio.
-- Rodam COMO o administrador (mesmas funções e regras do painel) e só na conversa privada com administrador.
-- Domínios: caixa, receber_pagar, dre, receita_alunos, comprovantes, acessos, assinaturas, ocupacao.
create or replace function conv_private.ai_admin_read(p_session uuid, p_domain text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid; v_prev_claims text; v_prev_sub text; v_err text; v_out jsonb;
  v_today date := (now() at time zone 'America/Fortaleza')::date;
  v_from date; v_to date; v_day date;
begin
  v_admin := conv_private.ai_admin_requester(p_session);
  if v_admin is null then
    return conv_private.vfail('ADMIN_ONLY_PRIVATE', 'Isso só um administrador consulta, e só na conversa privada comigo.');
  end if;
  begin
    v_from := coalesce(nullif(p_args->>'from', '')::date, date_trunc('month', v_today)::date);
    v_to := coalesce(nullif(p_args->>'to', '')::date, v_today);
    v_day := coalesce(nullif(p_args->>'date', '')::date, v_today);
  exception when others then
    return conv_private.vfail('INVALID_DATA', 'Não entendi o período. Pode dizer as datas?');
  end;
  if v_to < v_from or v_to - v_from > 731 then
    return conv_private.vfail('INVALID_DATA', 'Esse período não vale (início depois do fim, ou mais de 2 anos).');
  end if;

  v_prev_claims := current_setting('request.jwt.claims', true);
  v_prev_sub := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  begin
    if p_domain = 'caixa' then
      select jsonb_build_object('from', v_from, 'to', v_to,
        'opening_cents', (array_agg(opening_cents order by bucket_start))[1],
        'inflow_cents', coalesce(sum(inflow_cents), 0), 'outflow_cents', coalesce(sum(outflow_cents), 0),
        'net_cents', coalesce(sum(net_cents), 0),
        'closing_cents', (array_agg(closing_cents order by bucket_start desc))[1])
      into v_out from public.fin_cash_flow(v_from, v_to, 'month', null);
    elsif p_domain = 'receber_pagar' then
      select jsonb_build_object('receivables', (select to_jsonb(r) from public.fin_receivables_summary(v_today) r),
                                'payables', (select to_jsonb(p) from public.fin_payables_summary(v_today) p))
      into v_out;
    elsif p_domain = 'dre' then
      -- fin_dre_lines devolve o período pedido ('current') e o anterior de mesma duração ('previous'); valores sempre positivos.
      select jsonb_build_object('from', v_from, 'to', v_to,
        'by_line', coalesce((select jsonb_agg(jsonb_build_object('line', line, 'amount_cents', amt) order by line)
                             from (select line, sum(amount_cents)::bigint amt from public.fin_dre_lines(v_from, v_to) where period = 'current' group by line) x), '[]'::jsonb),
        'previous_by_line', coalesce((select jsonb_agg(jsonb_build_object('line', line, 'amount_cents', amt) order by line)
                             from (select line, sum(amount_cents)::bigint amt from public.fin_dre_lines(v_from, v_to) where period = 'previous' group by line) w), '[]'::jsonb),
        'top', coalesce((select jsonb_agg(jsonb_build_object('line', line, 'name', name, 'amount_cents', amt) order by amt desc)
                         from (select line, name, sum(amount_cents)::bigint amt from public.fin_dre_lines(v_from, v_to)
                               where period = 'current' group by line, name having sum(amount_cents) <> 0 order by sum(amount_cents) desc limit 12) y), '[]'::jsonb))
      into v_out;
    elsif p_domain = 'receita_alunos' then
      select jsonb_build_object('from', v_from, 'to', v_to, 'count', count(*), 'total_cents', coalesce(sum(amount_cents), 0),
        'by_category', coalesce((select jsonb_agg(jsonb_build_object('name', coalesce(category_name, 'Sem categoria'), 'amount_cents', amt) order by amt desc)
                                 from (select category_name, sum(amount_cents)::bigint amt from public.fin_student_revenue(v_from, v_to) group by category_name) z), '[]'::jsonb))
      into v_out from public.fin_student_revenue(v_from, v_to);
    elsif p_domain = 'comprovantes' then
      select jsonb_build_object('total', coalesce(max(total_count), 0),
        'items', coalesce(jsonb_agg(jsonb_build_object('member', profile_name, 'status', status, 'declared_amount_cents', declared_amount_cents,
          'declared_paid_on', declared_paid_on, 'possible_duplicate', possible_duplicate, 'created_at', created_at) order by created_at), '[]'::jsonb))
      into v_out from public.fin_receipt_queue('pending', 15, 0);
    elsif p_domain = 'acessos' then
      select jsonb_build_object('total', count(*),
        'items', coalesce(jsonb_agg(jsonb_build_object('name', name, 'created_at', created_at) order by created_at) filter (where rn <= 15), '[]'::jsonb))
      into v_out from (select name, created_at, row_number() over (order by created_at) rn from public.access_requests where status = 'pending') a;
    elsif p_domain = 'assinaturas' then
      select jsonb_build_object('documents', coalesce(jsonb_agg(jsonb_build_object('title', title, 'version', version, 'due_at', due_at,
        'recipients', recipients, 'signed', signed, 'notifications_failed', notifications_failed, 'no_phone', no_phone) order by published_at desc), '[]'::jsonb))
      into v_out from public.sig_documents_overview where status = 'published';
    elsif p_domain = 'ocupacao' then
      select jsonb_build_object('date', v_day, 'items', coalesce(jsonb_agg(jsonb_build_object('court', c.name, 'start', to_char(r.start_time, 'HH24:MI'),
        'end', to_char(r.end_time, 'HH24:MI'), 'type', r.type, 'by', coalesce(p.name, r.guest_name)) order by c.name, r.start_time), '[]'::jsonb))
      into v_out from public.reservations r join public.courts c on c.id = r.court_id left join public.profiles p on p.id = r.creator_id
      where r.date = v_day and coalesce(r.status::text, 'active') = 'active';
    else
      v_err := 'UNKNOWN_DOMAIN';
    end if;
  exception when others then
    v_err := sqlerrm;
  end;
  perform set_config('request.jwt.claims', coalesce(v_prev_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_prev_sub, ''), true);

  if v_err is not null then
    return conv_private.vfail(case when v_err ~ '^[A-Z][A-Z_]+$' then v_err else 'READ_FAILED' end,
      'Não consegui consultar isso agora.');
  end if;
  perform conv_private.audit('ai_admin_read', 'conv_ai_sessions', p_session::text, null,
    jsonb_build_object('domain', p_domain, 'from', v_from, 'to', v_to),
    jsonb_build_object('actor', 'ai', 'source', 'whatsapp', 'requester_profile_id', v_admin), v_admin);
  return jsonb_build_object('ok', true, 'domain', p_domain, 'data', v_out);
end $$;

create or replace function public.conv_svc_ai_admin_read(p_session uuid, p_domain text, p_args jsonb default '{}'::jsonb) returns jsonb
language sql security definer set search_path = '' as $$ select conv_private.ai_admin_read(p_session, p_domain, coalesce(p_args, '{}'::jsonb)) $$;

revoke all on function conv_private.ai_admin_read(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.conv_svc_ai_admin_read(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_admin_read(uuid, text, jsonb) to service_role;
