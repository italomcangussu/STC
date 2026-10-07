-- Conversas · João: memória social em ciclo fechado, resultados recentes e anti-repetição.
--
-- Fecha o ciclo da memória supervisionada: o João SUGERE (conv_ai_memory_candidates), a diretoria APROVA
-- ou recusa pelo painel, e só o aprovado volta ao contexto do João. Também dá a ele (1) os resultados
-- recentes do clube e (2) as próprias falas recentes, para não repetir piada, abertura ou bordão.
-- Tudo entra num único RPC de serviço (`conv_svc_ai_joao_pack`): uma ida ao banco, sem custo de modelo.
--
-- Aditiva: só funções novas. Nenhuma tabela é alterada, nenhum dado é reescrito.

-- ------------------------------------------------------------------
-- 1. Administrador: revisar o que o João aprendeu
-- ------------------------------------------------------------------
create function public.conv_list_ai_memory_candidates(p_status text default 'pending') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform conv_private.require_admin();
  if p_status not in ('pending', 'approved', 'rejected', 'superseded') then raise exception 'INVALID_STATUS'; end if;
  return (
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
    from (
      select c.id, c.subject_name, c.kind, c.content, c.confidence, c.status, c.created_at, c.reviewed_at,
             (select left(m.body, 240) from public.conv_messages m where m.id = c.source_message_id) as source_body
      from public.conv_ai_memory_candidates c
      where c.status = p_status
      order by c.created_at desc
      limit 100
    ) x
  );
end $$;

-- Aprovar (opcionalmente corrigindo o texto) ou recusar. Recusar uma memória já aprovada a retira do João.
create function public.conv_review_ai_memory_candidate(p_id uuid, p_decision text, p_content text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_old public.conv_ai_memory_candidates%rowtype; v_content text;
begin
  perform conv_private.require_admin();
  if p_decision not in ('approved', 'rejected') then raise exception 'INVALID_DECISION'; end if;
  select * into v_old from public.conv_ai_memory_candidates where id = p_id for update;
  if not found then raise exception 'CANDIDATE_NOT_FOUND'; end if;
  v_content := left(coalesce(nullif(trim(p_content), ''), v_old.content), 500);
  if char_length(v_content) < 3 then raise exception 'CONTENT_TOO_SHORT'; end if;
  update public.conv_ai_memory_candidates
     set status = p_decision, content = v_content, reviewed_at = now(), reviewed_by = auth.uid()
   where id = p_id;
  perform conv_private.audit('ai_memory_review', 'conv_ai_memory_candidates', p_id::text,
    jsonb_build_object('status', v_old.status, 'content', v_old.content),
    jsonb_build_object('status', p_decision, 'content', v_content),
    jsonb_build_object('actor', 'admin', 'subject', v_old.subject_name, 'kind', v_old.kind));
  return jsonb_build_object('id', p_id, 'status', p_decision);
end $$;

revoke all on function public.conv_list_ai_memory_candidates(text), public.conv_review_ai_memory_candidate(uuid, text, text) from public, anon;
grant execute on function public.conv_list_ai_memory_candidates(text), public.conv_review_ai_memory_candidate(uuid, text, text) to authenticated;

-- ------------------------------------------------------------------
-- 2. Peças do pacote do João (service_role)
-- ------------------------------------------------------------------

-- Memórias aprovadas pela diretoria. O texto já foi revisado por uma pessoa.
create function conv_private.ai_approved_memories() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('subject_name', x.subject_name, 'kind', x.kind, 'content', x.content)
                            order by x.confidence desc, x.created_at desc), '[]'::jsonb)
  from (select c.subject_name, c.kind, c.content, c.confidence, c.created_at
        from public.conv_ai_memory_candidates c
        where c.status = 'approved'
        order by c.confidence desc, c.created_at desc
        limit 60) x $$;

-- Resultados de partidas já encerradas (campeonato ou desafio) dos últimos dias. O placar vai do ponto de
-- vista de quem ganhou ("6x3 6x4"); W.O. sai sem placar. Só entra partida com vencedor e perdedor conhecidos.
create function conv_private.ai_recent_results(p_days integer default 21) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.played_on desc, r.sort_at desc), '[]'::jsonb)
  from (
    select x.played_on, x.sort_at, x.championship, x.phase, x.walkover,
           case when x.a_wins then x.name_a else x.name_b end as winner,
           case when x.a_wins then x.name_b else x.name_a end as loser,
           case when x.walkover then null else (
             select string_agg(case when x.a_wins then s.a::text || 'x' || s.b::text else s.b::text || 'x' || s.a::text end, ' ' order by s.i)
             from unnest(x.score_a, x.score_b) with ordinality as s(a, b, i)) end as score
    from (
      select coalesce(m.date, (m.result_set_at at time zone 'America/Fortaleza')::date) as played_on,
             coalesce(m.result_set_at, m.updated_at, m.created_at) as sort_at,
             ch.name as championship, m.phase::text as phase, coalesce(m.is_walkover, false) as walkover,
             m.score_a, m.score_b,
             coalesce(pa.name, ra.name, rega.guest_name) as name_a,
             coalesce(pb.name, rb.name, regb.guest_name) as name_b,
             coalesce(m.winner_id = m.player_a_id or m.winner_registration_id = m.registration_a_id, false) as a_wins,
             coalesce(m.winner_id = m.player_b_id or m.winner_registration_id = m.registration_b_id, false) as b_wins
      from public.matches m
      left join public.championships ch on ch.id = m.championship_id
      left join public.profiles pa on pa.id = m.player_a_id
      left join public.profiles pb on pb.id = m.player_b_id
      left join public.championship_registrations rega on rega.id = m.registration_a_id
      left join public.championship_registrations regb on regb.id = m.registration_b_id
      left join public.profiles ra on ra.id = rega.user_id
      left join public.profiles rb on rb.id = regb.user_id
      where m.status::text = 'finished'
    ) x
    where (x.a_wins or x.b_wins)
      and x.name_a is not null and x.name_b is not null and x.name_a <> x.name_b
      and x.played_on >= (now() at time zone 'America/Fortaleza')::date - greatest(p_days, 1)
    order by x.played_on desc, x.sort_at desc
    limit 10
  ) r $$;

-- As últimas falas do João (IA e bom-dia) nesta conversa, da mais antiga à mais recente: serve para ele não se repetir.
create function conv_private.ai_own_lines(p_session uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x.body order by x.created_at), '[]'::jsonb)
  from (
    select left(m.body, 200) as body, m.created_at
    from public.conv_messages m
    where m.conversation_id = (select s.conversation_id from public.conv_ai_sessions s where s.id = p_session)
      and m.direction = 'outbound' and m.origin in ('ai', 'system')
      and m.deleted_at is null and m.kind = 'text' and nullif(trim(m.body), '') is not null
      and m.created_at > now() - interval '3 days'
    order by m.created_at desc
    limit 14
  ) x $$;

create function conv_private.ai_joao_pack(p_session uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'memories', conv_private.ai_approved_memories(),
    'results', conv_private.ai_recent_results(21),
    'own_lines', conv_private.ai_own_lines(p_session)) $$;

revoke all on function conv_private.ai_approved_memories(), conv_private.ai_recent_results(integer), conv_private.ai_own_lines(uuid),
  conv_private.ai_joao_pack(uuid) from public, anon, authenticated;

create function public.conv_svc_ai_joao_pack(p_session uuid) returns jsonb
language sql stable security definer set search_path = '' as $$ select conv_private.ai_joao_pack(p_session) $$;
revoke all on function public.conv_svc_ai_joao_pack(uuid) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_joao_pack(uuid) to service_role;

-- Rollback: drop das funções conv_svc_ai_joao_pack, conv_private.ai_{approved_memories,recent_results,own_lines,joao_pack}
-- e public.conv_{list,review}_ai_memory_candidates. Nenhum dado é alterado por esta migration.
