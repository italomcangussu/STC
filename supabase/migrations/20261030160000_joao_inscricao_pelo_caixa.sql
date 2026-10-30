-- Pix de inscrição lançado pelo administrador confirma a pré-inscrição (Hermeson/Henrique, 30/10).
-- O Henrique mandava o comprovante do atleta e lançava "Inscrição AUGE OPEN — Juarez Enderson e Heitor Freitas" no caixa;
-- a receita entrava, mas a pré-inscrição continuava "aguardando Pix" e o atleta não ia para a chave. Só o comprovante
-- mandado pelo próprio atleta confirmava (conv_svc_receipt_championship_auto).
-- Agora, depois de lançar uma receita paga do campeonato (categoria do campeonato, ou nome/título do evento junto de
-- "inscrição"), o sistema acha as pré-inscrições pelos nomes da descrição e confirma, se o valor fecha com o número de
-- atletas. Valor que não fecha, nome que não casa ou receita fora do campeonato: lança no caixa e só avisa.

-- O nome do atleta aparece no texto: o 1º nome e mais um nome (sem "de", "da", "filho"…), como palavras inteiras.
create or replace function conv_private.champ_name_in_text(p_name text, p_text text) returns boolean
language sql immutable set search_path = '' as $$
  with nome as (
    select w, ord from regexp_split_to_table(conv_private.champ_name_key(p_name), '[^a-z0-9]+') with ordinality as t(w, ord)
    where length(w) >= 2 and w not in ('de', 'da', 'do', 'das', 'dos', 'e', 'filho', 'filha', 'junior', 'jr', 'neto', 'sobrinho')),
  texto as (select array_agg(w) ws from regexp_split_to_table(conv_private.champ_name_key(p_text), '[^a-z0-9]+') w)
  select coalesce((select n.w = any(t.ws) from nome n, texto t order by n.ord limit 1), false)
     and (select count(*) from nome n, texto t where n.w = any(t.ws)) >= 2
$$;

-- Confirma as pré-inscrições pagas por uma receita do caixa. Devolve null quando a receita não é do campeonato.
create or replace function conv_private.champ_confirm_from_entry(p_entry uuid, p_admin uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  e public.fin_entries%rowtype; v_cat text; v_text text; c public.championships%rowtype; x public.championship_signups%rowtype;
  v_ids uuid[]; v_names jsonb; v_price bigint; v_reg uuid; v_ok text[] := '{}'; v_wait text[] := '{}';
begin
  select * into e from public.fin_entries where id = p_entry;
  if not found or e.kind <> 'revenue' or e.status <> 'paid' then return null; end if;
  select k.name into v_cat from public.fin_categories k where k.id = e.category_id;
  v_text := conv_private.champ_name_key(coalesce(v_cat, '') || ' ' || coalesce(e.description, ''));
  select * into c from public.championships ch
   where coalesce((ch.joao_info->>'enabled')::boolean, false) and ch.status in ('draft', 'ongoing')
     and (conv_private.champ_name_key(v_cat) = conv_private.champ_name_key(ch.joao_info->>'category_name')
          or (v_text like '%inscri%' and (position(conv_private.champ_name_key(ch.name) in v_text) > 0
              or (nullif(ch.joao_info->'title'->>0, '') is not null and position(conv_private.champ_name_key(ch.joao_info->'title'->>0) in v_text) > 0))))
   order by ch.start_date limit 1;
  if not found then return null; end if;
  if exists (select 1 from public.championship_signups s where s.fin_entry_id = e.id) then
    return jsonb_build_object('championship', c.name, 'reason', 'ALREADY');
  end if;

  select array_agg(s.id order by s.created_at), jsonb_agg(s.full_name order by s.created_at) into v_ids, v_names
  from public.championship_signups s
  where s.championship_id = c.id and s.status = 'pre' and conv_private.champ_name_in_text(s.full_name, e.description);
  if v_ids is null then return jsonb_build_object('championship', c.name, 'reason', 'NO_MATCH'); end if;
  v_price := coalesce((c.joao_info->>'price_cents')::bigint, 0);
  if e.amount_cents <> v_price * cardinality(v_ids) then
    return jsonb_build_object('championship', c.name, 'reason', 'AMOUNT', 'names', v_names, 'amount_cents', e.amount_cents,
      'expected_cents', v_price * cardinality(v_ids));
  end if;

  -- Como no comprovante do atleta: entra na classe; com a classe cheia, fica pago na lista de espera.
  for x in select * from public.championship_signups s where s.id = any(v_ids) order by s.created_at for update loop
    perform pg_advisory_xact_lock(hashtext(x.championship_id::text || x.class));
    if conv_private.champ_confirmed(x.championship_id, x.class) < coalesce((c.joao_info->>'max_per_class')::int, 16) then
      insert into public.championship_registrations (championship_id, participant_type, user_id, guest_name, class, shirt_size, registered_by, guest_cidade)
      values (x.championship_id, case when x.profile_id is null then 'guest' else 'socio' end, x.profile_id,
        case when x.profile_id is null then x.full_name end, x.class, x.shirt_size, p_admin, x.city)
      returning id into v_reg;
      update public.championship_signups set status = 'confirmed', registration_id = v_reg, paid_at = now(), fin_entry_id = e.id, updated_at = now() where id = x.id;
      v_ok := v_ok || x.full_name;
    else
      update public.championship_signups set status = 'waitlist', paid_at = now(), fin_entry_id = e.id, updated_at = now() where id = x.id;
      v_wait := v_wait || x.full_name;
    end if;
  end loop;
  return jsonb_build_object('championship', c.name, 'confirmed', to_jsonb(v_ok), 'waitlist', to_jsonb(v_wait));
end $$;
revoke all on function conv_private.champ_confirm_from_entry(uuid, uuid) from public, anon, authenticated;
revoke all on function conv_private.champ_name_in_text(text, text) from public, anon, authenticated;

-- A confirmação do administrador (a mesma de 20261022050000) passa a chamar a confirmação da inscrição.
CREATE OR REPLACE FUNCTION conv_private.ai_confirm_wave2_step(p_proposal uuid, p_message uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  bp public.conv_booking_proposals%rowtype; m public.conv_messages%rowtype; v_admin uuid;
  v_prev_claims text; v_prev_sub text; v_res jsonb; v_err text; v_code text; v_cat text; v_champ jsonb;
begin
  select * into bp from public.conv_booking_proposals where id = p_proposal for update;
  if not found or bp.action not in ('fin_charge_cancel', 'fin_charge_adjust', 'fin_payment_reverse', 'fin_receipt_reject', 'fin_entry_create') then
    return conv_private.ai_confirm_pendency_step(p_proposal, p_message);
  end if;
  if bp.status = 'confirmed' then return jsonb_build_object('ok', true, 'replayed', true, 'action', bp.action, 'summary', bp.payload); end if;
  if bp.status <> 'open' then return conv_private.vfail('PROPOSAL_CLOSED', 'Essa proposta não está mais aberta.'); end if;
  if bp.expires_at <= now() then
    update public.conv_booking_proposals set status = 'expired' where id = bp.id;
    return conv_private.vfail('PROPOSAL_EXPIRED', 'A proposta venceu. Posso montar outra.');
  end if;
  select * into m from public.conv_messages where id = p_message and direction = 'inbound' and conversation_id = bp.conversation_id;
  if not found or m.created_at <= bp.created_at then
    return conv_private.vfail('CONFIRMATION_NOT_AFTER_PROPOSAL', 'A confirmação precisa vir depois da proposta.');
  end if;
  if m.kind <> 'text' or not (conv_private.is_confirmation(m.body) or conv_private.is_semantic_acceptance(m.body, false)) then
    return conv_private.vfail('NOT_EXPLICIT', 'Não entendi como confirmação clara.');
  end if;
  if m.sender_contact_id is distinct from bp.requester_contact_id then
    return conv_private.vfail('NOT_AUTHORIZED_TO_CONFIRM', 'Só o administrador que pediu pode confirmar.');
  end if;
  v_admin := conv_private.ai_admin_requester(bp.session_id);
  if v_admin is null or v_admin <> bp.requester_profile_id then
    update public.conv_booking_proposals set status = 'failed', failure_code = 'ADMIN_ONLY_PRIVATE' where id = bp.id;
    return conv_private.vfail('ADMIN_ONLY_PRIVATE', 'Isso só um administrador faz, e só na conversa privada comigo.');
  end if;

  v_prev_claims := current_setting('request.jwt.claims', true);
  v_prev_sub := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  begin
    if bp.action = 'fin_charge_cancel' then
      v_res := public.fin_cancel_charge(bp.request_key, (bp.payload->>'charge_id')::uuid, bp.payload->>'reason');
    elsif bp.action = 'fin_charge_adjust' then
      v_res := public.fin_adjust_charge(bp.request_key, (bp.payload->>'charge_id')::uuid, bp.payload->>'adjust_kind',
        (bp.payload->>'amount_cents')::bigint, bp.payload->>'reason');
    elsif bp.action = 'fin_payment_reverse' then
      v_res := public.fin_reverse_payment(bp.request_key, (bp.payload->>'payment_id')::uuid, bp.payload->>'reason');
    elsif bp.action = 'fin_receipt_reject' then
      v_res := public.fin_reject_receipt(bp.request_key, (bp.payload->>'submission_id')::uuid, bp.payload->>'reason');
    else
      v_cat := nullif(bp.payload->>'category_id', '');
      if v_cat is null and coalesce((bp.payload->>'category_new')::boolean, false) then
        v_res := public.fin_save_category(md5(bp.id::text || 'category')::uuid, null, null, jsonb_build_object(
          'kind', bp.payload->>'entry_kind', 'parent_id', bp.payload->>'category_parent_id', 'name', bp.payload->>'category_name'));
        v_cat := v_res->>'id';
        bp.payload := bp.payload || jsonb_build_object('category_id', v_cat);
      end if;
      v_res := public.fin_create_entry(bp.request_key, jsonb_strip_nulls(jsonb_build_object(
        'kind', bp.payload->>'entry_kind', 'description', bp.payload->>'description', 'amount_cents', (bp.payload->>'amount_cents')::bigint,
        'status', bp.payload->>'entry_status', 'due_date', bp.payload->>'due_date', 'paid_on', bp.payload->>'paid_on',
        'account_id', bp.payload->>'account_id', 'category_id', v_cat, 'supplier', bp.payload->>'supplier')));
    end if;
  exception when others then
    v_err := sqlerrm;
  end;
  perform set_config('request.jwt.claims', coalesce(v_prev_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_prev_sub, ''), true);

  if v_err is not null then
    v_code := case when v_err ~ '^[A-Z][A-Z_]+$' then v_err else 'FINANCE_FAILED' end;
    update public.conv_booking_proposals set status = 'failed', failure_code = v_code where id = bp.id;
    return conv_private.vfail(v_code, 'O financeiro recusou: ' || v_code || '.');
  end if;

  update public.conv_booking_proposals set status = 'confirmed', confirmed_at = now(), confirmed_message_id = m.id,
    confirmed_by_contact_id = m.sender_contact_id, payload = bp.payload || jsonb_build_object('result', v_res) where id = bp.id;
  perform conv_private.audit('ai_admin_finance', 'fin_member_charges', coalesce(v_res->>'id', bp.payload->>'charge_id', bp.payload->>'submission_id'), null,
    jsonb_build_object('action', bp.action, 'amount_cents', bp.payload->'amount_cents', 'reason', bp.payload->'reason'),
    jsonb_build_object('actor', 'ai', 'source', 'whatsapp', 'conversation_id', bp.conversation_id, 'proposal_id', bp.id,
      'requester_profile_id', bp.requester_profile_id),
    bp.requester_profile_id);
  -- Receita de inscrição do campeonato: confirma a pré-inscrição do atleta (nunca derruba o lançamento já feito).
  if bp.action = 'fin_entry_create' and bp.payload->>'entry_kind' = 'revenue' then
    begin
      v_champ := conv_private.champ_confirm_from_entry((v_res->>'id')::uuid, v_admin);
    exception when others then
      v_champ := jsonb_build_object('reason', 'FAILED', 'error', left(sqlerrm, 120));
    end;
  end if;
  return jsonb_build_object('ok', true, 'action', bp.action,
    'summary', bp.payload || jsonb_build_object('result', v_res) || jsonb_strip_nulls(jsonb_build_object('championship', v_champ)));
end $function$;

-- Receitas de inscrição já lançadas pelo administrador desde a abertura do campeonato e que não confirmaram ninguém.
do $$ declare e record; v_admin uuid := (select finance_admin_profile_id from public.fin_settings where id); begin
  for e in select f.id from public.fin_entries f
           where f.kind = 'revenue' and f.status = 'paid' and f.created_at >= '2026-10-26'
             and not exists (select 1 from public.championship_signups s where s.fin_entry_id = f.id)
           order by f.created_at loop
    perform conv_private.champ_confirm_from_entry(e.id, v_admin);
  end loop;
end $$;

-- Rollback: reaplicar conv_private.ai_confirm_wave2_step de 20261022050000_joao_caixa_categoria_comprovante.sql e
-- drop function conv_private.champ_confirm_from_entry(uuid, uuid), conv_private.champ_name_in_text(text, text).
