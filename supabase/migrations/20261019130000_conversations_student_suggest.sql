-- Conversas · nome de aluno com dúvida vira pergunta, e o lote de aulas espera o professor
--
-- Conversa real (19/10): "Ítalo Canguço" (no STC: Ítalo Cangussú) e "Lucas Martins" (no STC só há Lucas Rodrigues)
-- voltaram como "não cadastrado". E um "Confirmo" que chegou 29 min depois do resumo encontrou a proposta vencida (20 min).
-- 1) `fold_loose`: ç/ss/s, "ce/ci"/"se/si" e vogal final átona o/u, e/i soam igual (Canguço = Cangussú).
-- 2) `ai_resolve_people` (aluno): se exata, parcial e aproximada não acham ninguém mas o primeiro nome bate, devolve
--    status 'suggest' com até 3 candidatos. O servidor NÃO escolhe: pergunta ao assessor/professor se é aquela pessoa.
-- 3) Proposta de aulas em lote vale 24 h (o assessor consulta o professor antes de aceitar); o aceite revalida cada aula.
-- Rollback: recriar as três a partir de 20261016200000 / 20261016190000.

create or replace function conv_private.fold_loose(p text) returns text
language sql immutable set search_path = '' as $$
  -- vogal final átona soa "u"/"i" (Canguço = Cangussú, Resende = Resendi); letras dobradas viram uma
  select trim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    regexp_replace(translate(replace(replace(conv_private.fold(replace(lower(coalesce(p, '')), 'ç', 's')), 'th', 't'), 'ph', 'f'), 'zyk', 'sic'), 'c([ei])', 's\1', 'g'),
    '([a-z])\1+', '\1', 'g'), 'o(\s|$)', 'u\1', 'g'), 'e(\s|$)', 'i\1', 'g'), '\s+', ' ', 'g'))
$$;
revoke all on function conv_private.fold_loose(text) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION conv_private.ai_resolve_people(p_names text[], p_scope text DEFAULT 'member'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_out jsonb := '[]'::jsonb; v_name text; v_q text; v_match jsonb; v_n integer; v_suggest boolean;
begin
  if p_scope not in ('member', 'student', 'professor') then raise exception 'INVALID_SCOPE'; end if;
  foreach v_name in array coalesce(p_names, '{}') loop
    v_q := conv_private.fold(trim(v_name));
    continue when length(v_q) < 2;
    with pool as (
      select p.id, p.name::text as name, 'member'::text as kind, p.category::text as hint, 'member'::text as sc,
             coalesce(mc.aliases, '{}'::text[]) as aliases
        from public.profiles p
        left join public.conv_ai_member_context mc on mc.profile_id = p.id
        where coalesce(p.is_active, true) and p.role::text in ('socio', 'admin')
      union all
      select p.id, p.name::text, 'socio', p.category::text, 'student',
             coalesce(mc.aliases, '{}'::text[])
        from public.profiles p
        join public.student_profiles sp on sp.profile_id = p.id
        left join public.conv_ai_member_context mc on mc.profile_id = p.id
        where sp.student_status = 'active' and coalesce(p.is_active, true) and p.role::text in ('socio', 'admin')
      union all
      select s.id, s.name::text, 'non_socio', s.plan_type::text, 'student', '{}'::text[]
        from public.non_socio_students s where coalesce(s.is_active, true)
      union all
      select pf.id, pf.name::text, 'professor', null, 'professor', '{}'::text[]
        from public.professors pf where coalesce(pf.is_active, true)
    ), exact as (
      select * from pool
      where sc = p_scope
        and (
          conv_private.fold(name) = v_q
          or exists (select 1 from unnest(aliases) a where conv_private.fold(a) = v_q)
        )
      order by name limit 6
    ), partial as (
      select * from pool
      where sc = p_scope
        and not exists (
          select 1 from regexp_split_to_table(v_q, '\s+') w
          where w <> ''
            and not (
              conv_private.fold(name) like '%' || w || '%'
              or exists (select 1 from unnest(aliases) a where conv_private.fold(a) like '%' || w || '%')
            )
        )
      order by name limit 6
    ), loose as (
      -- Só aluno e só sem resultado acima: grafia aproximada (Rezende = Resende) e nome cadastrado curto
      -- contido no pedido ("Matheus" para "Matheus Martins"). Mais de um candidato continua sendo pergunta.
      select * from pool
      where sc = p_scope and p_scope = 'student'
        and (
          not exists (
            select 1 from regexp_split_to_table(conv_private.fold_loose(v_name), '\s+') w
            where w <> '' and conv_private.fold_loose(name) not like '%' || w || '%')
          or not exists (
            select 1 from regexp_split_to_table(conv_private.fold_loose(name), '\s+') w
            where w <> '' and not (' ' || conv_private.fold_loose(v_name) || ' ') like '% ' || w || ' %')
        )
      order by name limit 6
    ), suggest as (
      -- Dúvida: nada achado acima, mas o primeiro nome bate. Vira PERGUNTA ("é o Lucas Rodrigues?"), nunca escolha.
      select * from pool
      where sc = p_scope and p_scope = 'student'
        and split_part(conv_private.fold_loose(name), ' ', 1) = split_part(conv_private.fold_loose(v_name), ' ', 1)
      order by name limit 3
    ), chosen as (
      select *, 'match'::text as tier from exact
      union all
      select *, 'match' from partial where not exists (select 1 from exact)
      union all
      select *, 'match' from loose where not exists (select 1 from exact) and not exists (select 1 from partial)
      union all
      select *, 'suggest' from suggest where not exists (select 1 from exact) and not exists (select 1 from partial) and not exists (select 1 from loose)
    )
    select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'kind', c.kind, 'hint', c.hint) order by c.name), '[]'::jsonb), count(*),
           bool_or(c.tier = 'suggest')
      into v_match, v_n, v_suggest from chosen c;
    v_out := v_out || jsonb_build_array(jsonb_build_object('query', v_name,
      'status', case when coalesce(v_suggest, false) then 'suggest' when v_n = 1 then 'unique' when v_n = 0 then 'none' else 'ambiguous' end, 'matches', v_match));
  end loop;
  return v_out;
end $function$;

create or replace function conv_private.ai_propose(p_session uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare sess public.conv_ai_sessions%rowtype; s public.conv_ai_settings%rowtype; v_req uuid; v_chk jsonb; v_id uuid; v_n integer;
begin
  if coalesce(p->>'action', '') <> 'lessons_batch' then return conv_private.ai_propose_pre_lessons(p_session, p); end if;
  select * into sess from public.conv_ai_sessions where id = p_session and status = 'open' for update;
  if not found then return conv_private.vfail('SESSION_CLOSED', 'Atendimento encerrado.'); end if;
  v_req := conv_private.acting_profile_id(sess.requester_contact_id);
  if v_req is null then return conv_private.vfail('REQUESTER_NOT_IDENTIFIED', 'Não consegui identificar seu cadastro de sócio por este telefone.'); end if;
  v_n := jsonb_array_length(coalesce(p->'items', '[]'::jsonb));
  if v_n = 0 or v_n > 30 then return conv_private.vfail('INVALID_BATCH', 'Mande de 1 a 30 aulas por vez.'); end if;
  v_chk := conv_private.ai_lessons_check(v_req, p->'items');
  if jsonb_array_length(v_chk->'accepted') = 0 then
    return conv_private.vfail('NOTHING_TO_BOOK', 'Nenhuma aula da lista pode ser marcada.') || jsonb_build_object('rejected', v_chk->'rejected');
  end if;
  select * into s from public.conv_ai_settings where active order by version desc limit 1;
  update public.conv_booking_proposals set status = 'canceled' where session_id = p_session and status = 'open';
  insert into public.conv_booking_proposals(conversation_id, session_id, requester_contact_id, requester_profile_id, action, payload, expires_at)
  values (sess.conversation_id, p_session, sess.requester_contact_id, v_req, 'lessons_batch', v_chk, now() + greatest(make_interval(mins => coalesce(s.proposal_ttl_minutes, 20)), interval '24 hours'))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'proposal_id', v_id, 'action', 'lessons_batch', 'summary', v_chk);
end $$;
