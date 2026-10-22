-- Sócio comum (Memória) manda comprovante dizendo que é o Card de um aluno: o João repassa ao financeiro (Henrique),
-- e na conversa do Henrique o comprovante paga o Card do aluno que ele mandar cadastrar.
create temp table u as select fab.usuario('henrique@x.com') as adm, fab.usuario('memoria@x.com') as soc;
grant select on u to service_role;
insert into public.profiles (id, name, role) select adm, 'Henrique Coelho', 'admin' from u on conflict (id) do update set name = excluded.name, role = excluded.role;
insert into public.profiles (id, name, role) select soc, 'Diego Memória', 'socio' from u on conflict (id) do update set name = excluded.name, role = excluded.role;
insert into public.fin_settings (id, payee_names, card_mensal_price_cents) values (true, array['Sobral Tenis Clube'], 20000)
  on conflict (id) do update set payee_names = excluded.payee_names, card_mensal_price_cents = 20000, finance_admin_profile_id = null;

insert into public.conv_contacts (id, phone, name, profile_id, link_status) select '00000000-0000-0000-0000-00000000c501', '558800000501', 'Henrique', adm, 'linked' from u;
insert into public.conv_contacts (id, phone, name, profile_id, link_status) select '00000000-0000-0000-0000-00000000c502', '558800000502', 'Memória', soc, 'linked' from u;
insert into public.conv_conversations (id, kind, contact_id) values ('00000000-0000-0000-0000-00000000d502', 'direct', '00000000-0000-0000-0000-00000000c502');
insert into public.conv_messages (id, conversation_id, direction, kind, status, origin, sender_contact_id, media_path, media_mime, media_name, created_at) values
  ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000d502', 'inbound', 'image', 'received', 'customer', '00000000-0000-0000-0000-00000000c502',
   'in/x/pix.jpg', 'image/jpeg', 'pix.jpg', now() - interval '3 minutes'),
  ('00000000-0000-0000-0000-00000000aa02', '00000000-0000-0000-0000-00000000d502', 'inbound', 'text', 'received', 'customer', '00000000-0000-0000-0000-00000000c502',
   null, null, null, now() - interval '1 minute');
insert into fin_private.whatsapp_receipt_intents (id, source_message_id, conversation_id, profile_id, contact_id, original_data, created_at)
select '00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000d502', soc,
  '00000000-0000-0000-0000-00000000c502', jsonb_build_object('storage_path', 'soc/x/pix.jpg', 'file_name', 'pix.jpg', 'content_type', 'image/jpeg',
  'size_bytes', 800, 'content_sha256', repeat('f', 64), 'declared_amount_cents', 20000, 'declared_paid_on', '2026-10-21', 'ocr_status', 'ok',
  'ocr', jsonb_build_object('payee', 'Sobral Tenis Clube')), now() - interval '3 minutes'
from u;

-- sem responsável financeiro: não repassa (o turno cai no fluxo antigo)
select fab.como('service_role');
do $$ declare r jsonb := public.conv_svc_receipt_escalate('00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-00000000aa02', 'student_card', 'Card do Ronaldo'); begin
  assert r->>'code' = 'NO_FINANCE_ADMIN', 'sem financeiro configurado: ' || r::text;
end $$;

select fab.dono();
update public.fin_settings set finance_admin_profile_id = (select adm from u);
select fab.como('service_role');
create temp table esc as select public.conv_svc_receipt_escalate('00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-00000000aa02', 'student_card', 'Card Mensal do Ronaldo') r;
grant select on esc to service_role;
do $$ declare r jsonb := (select r from esc); begin
  assert (r->>'ok')::boolean, 'repassado: ' || r::text;
  assert r->>'admin_name' = 'Henrique' and r->>'sender_name' = 'Diego Memória', 'quem recebe e quem mandou';
  assert r->>'amount_cents' = '20000' and r->>'media_path' = 'in/x/pix.jpg' and r->>'media_kind' = 'image', 'leva valor e a imagem original';
  assert r->>'submission_id' is null, 'Card de aluno não vira submissão do sócio';
  assert public.conv_svc_receipt_escalate('00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-00000000aa02', 'other', 'x')->>'code' = 'ALREADY_ESCALATED', 'não repassa duas vezes';
end $$;

select fab.dono();
do $$ begin
  assert (select status from fin_private.whatsapp_receipt_intents where id = '00000000-0000-0000-0000-00000000bb01') = 'escalated', 'intenção repassada';
  assert exists (select 1 from public.conv_conversations c where c.id = ((select r from esc)->>'admin_conversation_id')::uuid
                 and c.contact_id = '00000000-0000-0000-0000-00000000c501'), 'conversa privada do Henrique';
end $$;

-- Henrique, na conversa dele, manda cadastrar o Ronaldo como mensalista já pago: usa o comprovante repassado
insert into public.conv_ai_sessions (id, conversation_id, requester_contact_id, expires_at)
select '00000000-0000-0000-0000-00000000e501', ((select r from esc)->>'admin_conversation_id')::uuid, '00000000-0000-0000-0000-00000000c501', now() + interval '1 day';
select fab.como('service_role');
do $$ declare r jsonb := public.conv_svc_ai_admin_student_propose('00000000-0000-0000-0000-00000000e501',
  '{"name":"Ronaldo","plan":"Card Mensal","card_tier":"regular","paid":true}'); begin
  assert (r->>'ok')::boolean, 'proposta: ' || r::text;
  assert r->'summary'#>>'{receipt,intent_id}' = '00000000-0000-0000-0000-00000000bb01', 'usa o comprovante que o Memória mandou';
  assert r->'summary'#>>'{receipt,from_name}' = 'Diego Memória', 'e diz de quem é';
end $$;

-- mensalidade do próprio sócio: o repasse cria a submissão dele (para "pode dar baixa")
select fab.dono();
insert into public.conv_messages (id, conversation_id, direction, kind, status, origin, sender_contact_id, created_at) values
  ('00000000-0000-0000-0000-00000000aa03', '00000000-0000-0000-0000-00000000d502', 'inbound', 'image', 'received', 'customer', '00000000-0000-0000-0000-00000000c502', now());
insert into fin_private.whatsapp_receipt_intents (id, source_message_id, conversation_id, profile_id, contact_id, original_data)
select '00000000-0000-0000-0000-00000000bb02', '00000000-0000-0000-0000-00000000aa03', '00000000-0000-0000-0000-00000000d502', soc,
  '00000000-0000-0000-0000-00000000c502', jsonb_build_object('storage_path', 'soc/y/pix.jpg', 'file_name', 'pix2.jpg', 'content_type', 'image/jpeg',
  'size_bytes', 800, 'content_sha256', repeat('a', 64), 'declared_amount_cents', 15000, 'declared_paid_on', '2026-10-21', 'ocr_status', 'ok', 'ocr', '{}'::jsonb)
from u;
select fab.como('service_role');
do $$ declare r jsonb := public.conv_svc_receipt_escalate('00000000-0000-0000-0000-00000000bb02', '00000000-0000-0000-0000-00000000aa02', 'membership', 'mensalidade de outubro'); begin
  assert r->>'submission_id' = '00000000-0000-0000-0000-00000000bb02', 'mensalidade vira submissão do sócio: ' || r::text;
end $$;
select fab.dono();
do $$ begin
  assert (select profile_id from public.fin_receipt_submissions where id = '00000000-0000-0000-0000-00000000bb02') = (select soc from u), 'submissão é do Memória';
end $$;
