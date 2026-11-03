-- Admin manda no privado o comprovante da mensalidade de um sócio: a aprovação pelo João usa esse comprovante
-- (antes respondia RECEIPT_NOT_FOUND porque só procurava comprovante enviado pelo próprio sócio).
create temp table u as select fab.usuario('henrique@x.com') as adm, fab.usuario('gian@x.com') as soc;
grant select on u to service_role, authenticated;
insert into public.profiles (id, name, role) select adm, 'Henrique Coelho', 'admin' from u on conflict (id) do update set name = excluded.name, role = excluded.role;
insert into public.profiles (id, name, role, is_active) select soc, 'Gianmarco Sócio', 'socio', true from u on conflict (id) do update set name = excluded.name, role = excluded.role, is_active = true;
insert into public.fin_settings (id, payee_names) values (true, array['Sobral Tenis Clube']) on conflict (id) do update set payee_names = excluded.payee_names;
insert into public.fin_accounts (id, name, kind, active, is_default_receipts, opening_date) values ('00000000-0000-0000-0000-0000000000c1', 'Cora', 'bank', true, true, '2026-01-01');
insert into public.conv_contacts (id, phone, name, profile_id, link_status) select '00000000-0000-0000-0000-00000000c701', '558800000701', 'Henrique', adm, 'linked' from u;
insert into public.conv_conversations (id, kind, contact_id) values ('00000000-0000-0000-0000-00000000d701', 'direct', '00000000-0000-0000-0000-00000000c701');
insert into public.conv_ai_sessions (id, conversation_id, requester_contact_id, expires_at) values
  ('00000000-0000-0000-0000-00000000e701', '00000000-0000-0000-0000-00000000d701', '00000000-0000-0000-0000-00000000c701', now() + interval '1 day');

select fab.como('authenticated', (select adm from u));
create temp table plano as select public.fin_create_member_plan(gen_random_uuid(), jsonb_build_object('profile_id', (select soc from u),
  'start_on', date_trunc('month', now() at time zone 'America/Fortaleza')::date, 'amount_cents', 40000)) r;
select public.fin_generate_member_charges(gen_random_uuid(), ((select r from plano)->>'id')::uuid, (now() at time zone 'America/Fortaleza')::date);
select fab.dono();

-- o mesmo arquivo mandado duas vezes pelo admin
insert into public.conv_messages (id, conversation_id, direction, kind, status, origin, sender_contact_id, created_at) values
  ('00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-00000000d701', 'inbound', 'image', 'received', 'customer', '00000000-0000-0000-0000-00000000c701', now() - interval '10 minutes'),
  ('00000000-0000-0000-0000-0000000007a2', '00000000-0000-0000-0000-00000000d701', 'inbound', 'image', 'received', 'customer', '00000000-0000-0000-0000-00000000c701', now() - interval '5 minutes');
insert into fin_private.whatsapp_receipt_intents (id, source_message_id, conversation_id, profile_id, contact_id, original_data, created_at)
select v.id, v.id, '00000000-0000-0000-0000-00000000d701', adm, '00000000-0000-0000-0000-00000000c701',
  jsonb_build_object('storage_path', 'adm/' || v.id || '.jpg', 'file_name', 'pix.jpg', 'content_type', 'image/jpeg', 'size_bytes', 700,
    'content_sha256', repeat('7', 64), 'declared_amount_cents', 40000, 'declared_paid_on', (now() at time zone 'America/Fortaleza')::date::text,
    'ocr_status', 'ok', 'ocr', '{}'::jsonb), v.at
from u, (values ('00000000-0000-0000-0000-0000000007a1'::uuid, now() - interval '10 minutes'),
                ('00000000-0000-0000-0000-0000000007a2'::uuid, now() - interval '5 minutes')) v(id, at);

select fab.como('service_role');
do $$
declare r jsonb; v_soc uuid := (select soc from u); v_sub record;
begin
  r := public.conv_svc_ai_admin_finance_propose('00000000-0000-0000-0000-00000000e701',
    jsonb_build_object('action', 'fin_receipt_approve', 'profile_id', v_soc));
  assert (r->>'ok')::boolean, 'aprovação acha o comprovante mandado pelo admin: ' || r::text;
  assert r->>'action' = 'fin_receipt_approve', 'proposta de aprovação';

  select * into v_sub from public.fin_receipt_submissions where profile_id = v_soc;
  assert v_sub.id = '00000000-0000-0000-0000-0000000007a2', 'usa o comprovante mais recente do admin';
  assert v_sub.status = 'submitted' and v_sub.declared_amount_cents = 40000 and v_sub.source = 'whatsapp', 'vira comprovante do sócio: ' || row_to_json(v_sub)::text;
end $$;

select fab.dono();
do $$ begin
  assert (select status from fin_private.whatsapp_receipt_intents where id = '00000000-0000-0000-0000-0000000007a2') = 'confirmed', 'intenção usada fica confirmada';
  assert (select finance_submission_id from fin_private.whatsapp_receipt_intents where id = '00000000-0000-0000-0000-0000000007a2') = '00000000-0000-0000-0000-0000000007a2', 'ligada à submissão';
  assert (select status from fin_private.whatsapp_receipt_intents where id = '00000000-0000-0000-0000-0000000007a1') = 'canceled', 'o reenvio do mesmo arquivo não fica pendurado';
end $$;

-- pedir de novo não cria outra submissão
select fab.como('service_role');
do $$
declare r jsonb; v_soc uuid := (select soc from u);
begin
  r := public.conv_svc_ai_admin_finance_propose('00000000-0000-0000-0000-00000000e701',
    jsonb_build_object('action', 'fin_receipt_approve', 'profile_id', v_soc));
  assert (r->>'ok')::boolean, 'segunda proposta segue ok: ' || r::text;
  assert (select count(*) from public.fin_receipt_submissions where profile_id = v_soc) = 1, 'uma submissão só';
end $$;

-- outra ação financeira não mexe em comprovante
do $$ begin
  perform public.conv_svc_ai_admin_finance_propose('00000000-0000-0000-0000-00000000e701', jsonb_build_object('action', 'fin_receipt_reject', 'profile_id', (select adm from u)));
  assert (select count(*) from public.fin_receipt_submissions) = 1, 'recusa não cria submissão';
end $$;
