-- Motor de humor STC: ampliar historico de falas usadas pelo Joao de 3 para 30 dias.
-- Executado no Supabase de producao em 2026-10-10.
-- O retorno e mais recente -> mais antigo, para priorizar a deteccao de temas saturados.
create or replace function conv_private.ai_own_lines(p_session uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x.body order by x.created_at desc), '[]'::jsonb)
  from (
    select left(m.body, 400) as body, m.created_at
    from public.conv_messages m
    where m.conversation_id = (select s.conversation_id from public.conv_ai_sessions s where s.id = p_session)
      and m.direction = 'outbound' and m.origin in ('ai', 'system')
      and m.deleted_at is null and m.kind = 'text'
      and nullif(trim(m.body), '') is not null
      and m.created_at > now() - interval '30 days'
    order by m.created_at desc
    limit 70
  ) x $$;
revoke all on function conv_private.ai_own_lines(uuid) from public, anon, authenticated;
