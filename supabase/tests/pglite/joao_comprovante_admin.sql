-- Comprovante pelo WhatsApp: a intenção em análise é a mais recente das últimas 24 h (a antiga sem finalidade não
-- captura a conversa) e o assessor do administrador lê o OCR da intenção quando não há submissão.

create temp table u as select fab.usuario('adm@x.com') as adm;
insert into public.profiles (id, name, role) select adm, 'Admin A', 'admin' from u on conflict (id) do update set name = excluded.name, role = excluded.role;

insert into public.conv_contacts (id, phone, name, profile_id, link_status) select '00000000-0000-0000-0000-00000000c101', '558800000101', 'Admin A', adm, 'linked' from u;
insert into public.conv_conversations (id, kind, contact_id) values ('00000000-0000-0000-0000-00000000d101', 'direct', '00000000-0000-0000-0000-00000000c101');
insert into public.conv_ai_sessions (id, conversation_id, requester_contact_id, expires_at) values
  ('00000000-0000-0000-0000-00000000e101', '00000000-0000-0000-0000-00000000d101', '00000000-0000-0000-0000-00000000c101', now() + interval '1 day');
insert into public.conv_messages (id, conversation_id, direction, kind, status, origin, sender_contact_id, created_at) values
  ('00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-00000000d101', 'inbound', 'document', 'received', 'customer', '00000000-0000-0000-0000-00000000c101', now() - interval '6 days'),
  ('00000000-0000-0000-0000-0000000001a2', '00000000-0000-0000-0000-00000000d101', 'inbound', 'image', 'received', 'customer', '00000000-0000-0000-0000-00000000c101', now() - interval '1 minute');
insert into fin_private.whatsapp_receipt_intents (id, source_message_id, conversation_id, profile_id, contact_id, original_data, created_at)
select v.id, v.msg, '00000000-0000-0000-0000-00000000d101', adm, '00000000-0000-0000-0000-00000000c101', v.data, v.at from u, (values
  ('00000000-0000-0000-0000-0000000002a1'::uuid, '00000000-0000-0000-0000-0000000001a1'::uuid, now() - interval '6 days',
   jsonb_build_object('content_sha256', repeat('a', 64), 'declared_amount_cents', 2250, 'declared_paid_on', '2026-10-13', 'ocr_status', 'ok', 'ocr', jsonb_build_object('payee', 'Fulano'))),
  ('00000000-0000-0000-0000-0000000002a2'::uuid, '00000000-0000-0000-0000-0000000001a2'::uuid, now() - interval '1 minute',
   jsonb_build_object('content_sha256', repeat('b', 64), 'declared_amount_cents', 30000, 'declared_paid_on', '2026-10-19', 'ocr_status', 'ok', 'ocr', jsonb_build_object('payee', 'Fulano')))
) v(id, msg, at, data);

select fab.como('service_role');
do $$
declare s jsonb; r jsonb;
begin
  s := public.conv_svc_receipt_stage('00000000-0000-0000-0000-00000000d101');
  assert s->>'id' = '00000000-0000-0000-0000-0000000002a2', 'a intenção em análise é a mais recente: ' || coalesce(s::text, 'null');
  assert s->>'amount_cents' = '30000', 'com o valor do comprovante novo';

  r := public.conv_svc_ai_admin_receipt('00000000-0000-0000-0000-00000000e101', '00000000-0000-0000-0000-0000000001a2');
  assert (r->>'found')::boolean, 'o assessor acha o comprovante pela intenção: ' || r::text;
  assert r->>'amount_cents' = '30000' and r->>'paid_on' = '2026-10-19' and r->>'payee' = 'Fulano', 'lê o OCR da intenção';
  assert not (r->>'duplicate')::boolean, 'arquivo diferente não é repetido';
end $$;

-- a mais nova sai da análise: a de 6 dias não volta a capturar a conversa
select fab.dono();
update fin_private.whatsapp_receipt_intents set status = 'canceled' where id = '00000000-0000-0000-0000-0000000002a2';
select fab.como('service_role');
do $$
begin
  assert public.conv_svc_receipt_stage('00000000-0000-0000-0000-00000000d101') is null, 'intenção de mais de 24 h não fica em análise';
end $$;
