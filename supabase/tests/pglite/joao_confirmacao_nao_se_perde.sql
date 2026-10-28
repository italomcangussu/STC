-- Aviso do que o servidor já fez sai mesmo com mensagem nova da pessoa; só para se a equipe assumir.
insert into public.conv_contacts (id, phone, name) values ('00000000-0000-0000-0000-00000000c901', '558800000901', 'Romário');
insert into public.conv_conversations (id, kind, contact_id) values ('00000000-0000-0000-0000-00000000d901', 'direct', '00000000-0000-0000-0000-00000000c901');
insert into public.conv_messages (id, conversation_id, direction, kind, status, origin, sender_contact_id, created_at) values
  ('00000000-0000-0000-0000-00000000e901', '00000000-0000-0000-0000-00000000d901', 'inbound', 'document', 'received', 'customer', '00000000-0000-0000-0000-00000000c901', now() - interval '30 seconds'),
  ('00000000-0000-0000-0000-00000000e902', '00000000-0000-0000-0000-00000000d901', 'inbound', 'text', 'received', 'customer', '00000000-0000-0000-0000-00000000c901', now());
do $$
declare pdf uuid := '00000000-0000-0000-0000-00000000e901';
begin
  update public.conv_conversations set status = 'open', ai_status = 'ai' where id = '00000000-0000-0000-0000-00000000d901';
  assert not conv_private.ai_is_latest(pdf), 'o PDF não é mais a última mensagem';
  assert conv_private.ai_still_active(pdf), 'mas a conversa segue com a IA: a confirmação sai';
  update public.conv_conversations set ai_status = 'human' where id = '00000000-0000-0000-0000-00000000d901';
  assert not conv_private.ai_still_active(pdf), 'equipe assumiu: a IA para de falar';
end $$;
