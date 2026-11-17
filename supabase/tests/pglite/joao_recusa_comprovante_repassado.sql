-- Caso Henrique (12/11): o comprovante que o Ronaldo mandou foi repassado ao Henrique; "desconsidere esse comprovante"
-- respondia "Não achei comprovante pendente desse sócio". Agora a recusa acha o repassado a ESTE administrador e o
-- tira da fila; o repassado a outro administrador não é tocado.
create temp table u as select fab.usuario('henrique@x.com') as adm, fab.usuario('outro@x.com') as adm2, fab.usuario('ronaldo@x.com') as soc;
grant select on u to service_role, authenticated;
insert into public.profiles (id, name, role) select adm, 'Henrique Coelho', 'admin' from u on conflict (id) do update set name = excluded.name, role = excluded.role;
insert into public.profiles (id, name, role) select adm2, 'Outro Admin', 'admin' from u on conflict (id) do update set name = excluded.name, role = excluded.role;
insert into public.profiles (id, name, role, is_active) select soc, 'Ronaldo Rezende', 'socio', true from u on conflict (id) do update set name = excluded.name, role = excluded.role, is_active = true;
insert into public.conv_contacts (id, phone, name, profile_id, link_status) select '00000000-0000-0000-0000-00000000c801', '558800000801', 'Henrique', adm, 'linked' from u;
insert into public.conv_contacts (id, phone, name, profile_id, link_status) select '00000000-0000-0000-0000-00000000c802', '558800000802', 'Ronaldo', soc, 'linked' from u;
insert into public.conv_conversations (id, kind, contact_id) values
  ('00000000-0000-0000-0000-00000000d801', 'direct', '00000000-0000-0000-0000-00000000c801'),
  ('00000000-0000-0000-0000-00000000d802', 'direct', '00000000-0000-0000-0000-00000000c802');
insert into public.conv_ai_sessions (id, conversation_id, requester_contact_id, expires_at) values
  ('00000000-0000-0000-0000-00000000e801', '00000000-0000-0000-0000-00000000d801', '00000000-0000-0000-0000-00000000c801', now() + interval '1 day');
insert into public.conv_messages (id, conversation_id, direction, kind, status, origin, sender_contact_id, created_at) values
  ('00000000-0000-0000-0000-0000000008a1', '00000000-0000-0000-0000-00000000d802', 'inbound', 'image', 'received', 'customer', '00000000-0000-0000-0000-00000000c802', now() - interval '30 minutes');
insert into fin_private.whatsapp_receipt_intents (id, source_message_id, conversation_id, profile_id, contact_id, original_data, status,
  purpose_kind, purpose_detail, escalated_to, escalated_at, created_at)
select '00000000-0000-0000-0000-0000000008b1', '00000000-0000-0000-0000-0000000008a1', '00000000-0000-0000-0000-00000000d802', soc,
  '00000000-0000-0000-0000-00000000c802', jsonb_build_object('storage_path', 'soc/x/agua.jpg', 'file_name', 'agua.jpg', 'content_type', 'image/jpeg',
  'size_bytes', 500, 'content_sha256', repeat('e', 64), 'declared_amount_cents', 750, 'declared_paid_on', conv_private.today()::text, 'ocr_status', 'ok'),
  'escalated', 'other', 'Compra de 3 águas no Kaleno', adm2, now() - interval '29 minutes', now() - interval '30 minutes'
from u;

select fab.como('service_role');
-- repassado a outro administrador: segue sem achar
do $$ declare r jsonb := public.conv_svc_ai_admin_finance_propose('00000000-0000-0000-0000-00000000e801',
  jsonb_build_object('action', 'fin_receipt_reject', 'profile_id', (select soc from u), 'reason', 'Não tem ligação com o clube')); begin
  assert r->>'code' = 'RECEIPT_NOT_FOUND', 'de outro admin não acha: ' || r::text;
end $$;
select fab.dono();
do $$ begin
  assert (select status from fin_private.whatsapp_receipt_intents where id = '00000000-0000-0000-0000-0000000008b1') = 'escalated', 'intocado';
end $$;

-- repassado ao Henrique: vira a proposta de recusa
update fin_private.whatsapp_receipt_intents set escalated_to = (select adm from u) where id = '00000000-0000-0000-0000-0000000008b1';
select fab.como('service_role');
create temp table prop as select public.conv_svc_ai_admin_finance_propose('00000000-0000-0000-0000-00000000e801',
  jsonb_build_object('action', 'fin_receipt_reject', 'profile_id', (select soc from u), 'reason', 'Não tem ligação com o clube')) r;
grant select on prop to service_role;
do $$ declare r jsonb := (select r from prop); begin
  assert (r->>'ok')::boolean and r->>'action' = 'fin_receipt_reject', 'proposta de recusa: ' || r::text;
  assert r->'summary'->>'submission_id' = '00000000-0000-0000-0000-0000000008b1', 'o comprovante repassado';
  assert (r->'summary'->>'amount_cents')::bigint = 750, 'com o valor';
end $$;

select fab.dono();
do $$ begin
  assert (select status from fin_private.whatsapp_receipt_intents where id = '00000000-0000-0000-0000-0000000008b1') = 'confirmed', 'sai da fila de repassados';
  assert (select purpose_detail from fin_private.whatsapp_receipt_intents where id = '00000000-0000-0000-0000-0000000008b1') = 'Compra de 3 águas no Kaleno', 'mantém o que o sócio disse';
  assert (select member_note from public.fin_receipt_submissions where id = '00000000-0000-0000-0000-0000000008b1') like '%recusa pedida pelo administrador', 'nota da recusa';
end $$;

-- aprovação continua ignorando o que foi repassado (só espera finalidade ou confirmação)
insert into public.conv_messages (id, conversation_id, direction, kind, status, origin, sender_contact_id, created_at) values
  ('00000000-0000-0000-0000-0000000008a2', '00000000-0000-0000-0000-00000000d802', 'inbound', 'image', 'received', 'customer', '00000000-0000-0000-0000-00000000c802', now() - interval '20 minutes');
insert into fin_private.whatsapp_receipt_intents (id, source_message_id, conversation_id, profile_id, contact_id, original_data, status,
  purpose_kind, purpose_detail, escalated_to, escalated_at, created_at)
select '00000000-0000-0000-0000-0000000008b2', '00000000-0000-0000-0000-0000000008a2', '00000000-0000-0000-0000-00000000d802', soc,
  '00000000-0000-0000-0000-00000000c802', jsonb_build_object('storage_path', 'soc/x/b.jpg', 'file_name', 'b.jpg', 'content_type', 'image/jpeg',
  'size_bytes', 500, 'content_sha256', repeat('d', 64), 'declared_amount_cents', 900, 'ocr_status', 'ok'),
  'escalated', 'other', 'Outra coisa', adm, now() - interval '19 minutes', now() - interval '20 minutes'
from u;
update public.conv_booking_proposals set created_at = now() - interval '1 minute' where id = ((select r from prop)->>'proposal_id')::uuid;
insert into public.conv_messages (id, conversation_id, direction, kind, status, origin, sender_contact_id, body) values
  ('00000000-0000-0000-0000-0000000008c1', '00000000-0000-0000-0000-00000000d801', 'inbound', 'text', 'received', 'customer', '00000000-0000-0000-0000-00000000c801', 'confirmo');
select fab.como('service_role');
do $$ declare r jsonb := public.conv_svc_ai_confirm(((select r from prop)->>'proposal_id')::uuid, '00000000-0000-0000-0000-0000000008c1'); begin
  assert (r->>'ok')::boolean, 'recusa confirmada: ' || r::text;
end $$;
select fab.dono();
do $$ begin
  assert (select status from public.fin_receipt_submissions where id = '00000000-0000-0000-0000-0000000008b1') = 'rejected', 'comprovante recusado';
end $$;
select fab.como('service_role');
do $$ begin
  perform public.conv_svc_ai_admin_finance_propose('00000000-0000-0000-0000-00000000e801',
    jsonb_build_object('action', 'fin_receipt_approve', 'profile_id', (select soc from u)));
end $$;
select fab.dono();
do $$ begin
  assert (select status from fin_private.whatsapp_receipt_intents where id = '00000000-0000-0000-0000-0000000008b2') = 'escalated', 'aprovação não pega o repassado';
end $$;
