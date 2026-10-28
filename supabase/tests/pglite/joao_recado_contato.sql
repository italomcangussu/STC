-- Caso Romário: o administrador manda recado a quem não é sócio mas conversa com o João, e vê o comprovante que chegou lá.
create temp table u as select fab.usuario('hermeson2@x.com') as adm;
insert into public.profiles (id, name, role) select adm, 'Hermeson Veras', 'admin' from u on conflict (id) do update set name = excluded.name, role = excluded.role;
insert into public.conv_contacts (id, phone, name, profile_id, link_status) select '00000000-0000-0000-0000-00000000c701', '558800000701', 'Hermeson Veras', adm, 'linked' from u;
insert into public.conv_contacts (id, phone, name) values
  ('00000000-0000-0000-0000-00000000c702', '558800000702', 'Romário Soares'),
  ('00000000-0000-0000-0000-00000000c703', '558800000703', 'Romário Silva'),
  ('00000000-0000-0000-0000-00000000c704', '558800000704', 'Pedro Calado');
insert into public.conv_conversations (id, kind, contact_id) values
  ('00000000-0000-0000-0000-00000000d701', 'direct', '00000000-0000-0000-0000-00000000c701'),
  ('00000000-0000-0000-0000-00000000d702', 'direct', '00000000-0000-0000-0000-00000000c702'),
  ('00000000-0000-0000-0000-00000000d703', 'direct', '00000000-0000-0000-0000-00000000c703'),
  ('00000000-0000-0000-0000-00000000d704', 'direct', '00000000-0000-0000-0000-00000000c704');
insert into public.conv_ai_sessions (id, conversation_id, requester_contact_id, expires_at) values
  ('00000000-0000-0000-0000-00000000e701', '00000000-0000-0000-0000-00000000d701', '00000000-0000-0000-0000-00000000c701', now() + interval '1 day');
-- Pedro só recebeu mensagem (nunca falou com o João): não conta como quem tem conversa.
insert into public.conv_messages (id, conversation_id, direction, kind, status, origin, sender_contact_id, media_path, media_mime, media_name, created_at) values
  ('00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-00000000d702', 'inbound', 'document', 'received', 'customer', '00000000-0000-0000-0000-00000000c702',
   'in/r/c.pdf', 'application/pdf', 'Comprovante.pdf', now() - interval '20 minutes'),
  ('00000000-0000-0000-0000-0000000007a2', '00000000-0000-0000-0000-00000000d703', 'inbound', 'text', 'received', 'customer', '00000000-0000-0000-0000-00000000c703',
   null, null, null, now() - interval '2 days'),
  ('00000000-0000-0000-0000-0000000007a3', '00000000-0000-0000-0000-00000000d704', 'outbound', 'text', 'sent', 'ai', null, null, null, null, now() - interval '1 day');
insert into fin_private.whatsapp_receipt_intents (id, source_message_id, conversation_id, contact_id, original_data, status, purpose_kind, purpose_detail, created_at)
values ('00000000-0000-0000-0000-0000000007b1', '00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-00000000d702', '00000000-0000-0000-0000-00000000c702',
  jsonb_build_object('file_name', 'Comprovante.pdf', 'content_type', 'application/pdf', 'declared_amount_cents', 13000, 'declared_paid_on', '2026-10-28',
    'ocr', jsonb_build_object('amount_cents', 13000)), 'confirmed', 'other', 'Inscrição Serra e Sertão 2026: Romário Pontes Soares', now() - interval '20 minutes');

select fab.como('service_role');
do $$
declare s uuid := '00000000-0000-0000-0000-00000000e701'; r jsonb; p jsonb;
begin
  r := public.conv_svc_ai_admin_find_contact(s, 'Romário Pontes Soares');
  assert r->>'status' = 'unique' and r->'matches'->0->>'name' = 'Romário Soares', 'nome completo acha o contato "Romário Soares": ' || r::text;
  r := public.conv_svc_ai_admin_find_contact(s, 'Romário');
  assert r->>'status' = 'many', 'só o primeiro nome: dois Romários, o João pergunta: ' || r::text;
  r := public.conv_svc_ai_admin_find_contact(s, 'Pedro Calado');
  assert r->>'status' = 'none', 'quem nunca falou com o João não conta: ' || r::text;
  r := public.conv_svc_ai_admin_find_contact(s, 'Joaquim Barbosa');
  assert r->>'status' = 'none', 'nome que não existe: ' || r::text;

  p := public.conv_svc_ai_admin_message_propose(s, jsonb_build_object('contact_id', '00000000-0000-0000-0000-00000000c702', 'body', 'Romário, sua inscrição está confirmada!'));
  assert (p->>'ok')::boolean and p->'summary'->>'member_name' = 'Romário Soares' and p->'summary'->>'phone' = '558800000702', 'recado ao contato: ' || p::text;

  r := public.conv_svc_ai_admin_whatsapp_receipts(s, null, null, null);
  assert jsonb_array_length(r->'data'->'items') = 1, 'comprovante da conversa do atleta aparece: ' || r::text;
  assert r->'data'->'items'->0->>'sender' = 'Romário Soares' and (r->'data'->'items'->0->>'pdf')::boolean
     and (r->'data'->'items'->0->>'amount_cents')::int = 13000 and (r->'data'->'items'->0->>'launched')::boolean is false, 'dados do comprovante: ' || r::text;
  r := public.conv_svc_ai_admin_whatsapp_receipts(s, 'Romário Pontes Soares', null, null);
  assert jsonb_array_length(r->'data'->'items') = 1, 'filtra pelo nome do atleta: ' || r::text;
  r := public.conv_svc_ai_admin_whatsapp_receipts(s, 'Pedro Calado', null, null);
  assert jsonb_array_length(r->'data'->'items') = 0, 'outro nome não traz nada: ' || r::text;
end $$;
select fab.dono();
