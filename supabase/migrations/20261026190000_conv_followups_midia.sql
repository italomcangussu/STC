-- Retorno agendado com mídia: além do texto, o retorno pode levar um arquivo (imagem, documento, áudio ou vídeo) que já
-- está no bucket conv-media. O despachante (conversations-dispatch) manda o texto e depois o arquivo, na mesma conversa.
-- Texto sozinho, arquivo sozinho ou os dois. Pedido do Ítalo (26/10), para avisos como o do financeiro com o comprovante.

alter table public.conv_followups add column if not exists media_path text;
alter table public.conv_followups add column if not exists media_mime text;
alter table public.conv_followups add column if not exists media_name text;
alter table public.conv_followups add column if not exists media_kind text;
do $$ begin
  alter table public.conv_followups add constraint conv_followups_media_kind_check
    check (media_kind is null or media_kind in ('image', 'document', 'audio', 'video'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.conv_followups add constraint conv_followups_media_check
    check ((media_path is null) = (media_kind is null) and (media_path is null or length(media_path) between 3 and 500));
exception when duplicate_object then null; end $$;

-- O retorno muda de forma (colunas de mídia): a função precisa ser recriada, e a de serviço que a embrulha também.
drop function if exists public.conv_svc_claim_due_followups(integer);
drop function if exists conv_private.claim_due_followups(integer);

create function conv_private.claim_due_followups(p_limit integer)
returns table(followup_id uuid, conversation_id uuid, send_body text, media_path text, media_mime text, media_name text, media_kind text)
language sql security definer set search_path = '' as $$
  update public.conv_followups f set status = 'sending'
  where f.id in (
    select id from public.conv_followups
    where status = 'pending' and (send_body is not null or media_path is not null) and due_at <= now()
    order by due_at limit greatest(least(coalesce(p_limit, 20), 50), 1) for update skip locked)
  returning f.id, f.conversation_id, f.send_body, f.media_path, f.media_mime, f.media_name, f.media_kind;
$$;
revoke all on function conv_private.claim_due_followups(integer) from public, anon, authenticated;

create function public.conv_svc_claim_due_followups(p_limit integer)
returns table(followup_id uuid, conversation_id uuid, send_body text, media_path text, media_mime text, media_name text, media_kind text)
language sql security definer set search_path = '' as $$ select * from conv_private.claim_due_followups(p_limit) $$;
revoke all on function public.conv_svc_claim_due_followups(integer) from public, anon, authenticated;
grant execute on function public.conv_svc_claim_due_followups(integer) to service_role;
