-- Retorno agendado com arquivo: a varredura devolve a mídia junto com o texto; texto sozinho e arquivo sozinho também saem.
insert into public.conv_contacts (id, phone, name, link_status) values ('00000000-0000-0000-0000-00000000c701', '558800000701', 'Henrique', 'none');
insert into public.conv_conversations (id, kind, contact_id) values ('00000000-0000-0000-0000-00000000d701', 'direct', '00000000-0000-0000-0000-00000000c701');
insert into public.conv_followups (id, conversation_id, due_at, send_body, media_path, media_mime, media_name, media_kind) values
  ('00000000-0000-0000-0000-00000000f701', '00000000-0000-0000-0000-00000000d701', now() - interval '1 minute', 'Segue o comprovante', 'conv/a.jpg', 'image/jpeg', 'pix.jpg', 'image'),
  ('00000000-0000-0000-0000-00000000f702', '00000000-0000-0000-0000-00000000d701', now() - interval '1 minute', null, 'conv/b.pdf', 'application/pdf', 'b.pdf', 'document'),
  ('00000000-0000-0000-0000-00000000f703', '00000000-0000-0000-0000-00000000d701', now() - interval '1 minute', 'Só texto', null, null, null, null),
  ('00000000-0000-0000-0000-00000000f704', '00000000-0000-0000-0000-00000000d701', now() + interval '1 hour', 'Ainda não venceu', 'conv/c.jpg', 'image/jpeg', 'c.jpg', 'image');

-- Mídia sem tipo (ou tipo sem mídia) não entra.
select fab.espera_erro($$insert into public.conv_followups (conversation_id, due_at, media_path) values ('00000000-0000-0000-0000-00000000d701', now(), 'conv/x.jpg')$$, 'conv_followups_media_check');
select fab.espera_erro($$insert into public.conv_followups (conversation_id, due_at, send_body, media_path, media_kind) values ('00000000-0000-0000-0000-00000000d701', now(), 'x', 'conv/x.jpg', 'figurinha')$$, 'conv_followups_media_kind_check');

select fab.como('service_role');
create temp table vencidos as select * from public.conv_svc_claim_due_followups(10);
do $$ begin
  assert (select count(*) from vencidos) = 3, 'os três vencidos saem, o futuro não';
  assert (select media_kind = 'image' and media_path = 'conv/a.jpg' and send_body = 'Segue o comprovante' from vencidos where followup_id = '00000000-0000-0000-0000-00000000f701'), 'texto e imagem';
  assert (select send_body is null and media_kind = 'document' from vencidos where followup_id = '00000000-0000-0000-0000-00000000f702'), 'só o arquivo';
  assert (select media_path is null from vencidos where followup_id = '00000000-0000-0000-0000-00000000f703'), 'só o texto';
end $$;
select fab.dono();
do $$ begin
  assert (select count(*) from public.conv_followups where status = 'sending') = 3, 'separados para envio';
end $$;

-- Ninguém além do servidor separa retornos.
select fab.como('authenticated', fab.usuario('x@x.com'));
select fab.espera_erro($$select * from public.conv_svc_claim_due_followups(10)$$, 'permission denied');
