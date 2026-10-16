-- Conversas · busca de aluno tolerante a grafia
--
-- O assessor do professor manda "Matheus Martins" e "Ronaldo Rezende"; no STC estão "Matheus" e "Ronaldo Resende".
-- A busca parcial exigia que TODA palavra pedida aparecesse no nome cadastrado, então 3 alunos existentes viraram
-- "Não encontrei o aluno". Agora, só para aluno e só quando exata e parcial não acham ninguém, há um terceiro nível:
-- grafia aproximada (`fold_loose`: z/s, y/i, k/c, th/t, ph/f, letras dobradas) e nome cadastrado contido no pedido.
-- Ambiguidade continua virando pergunta. Sócio (Play) e professor seguem como antes.
-- Rollback: recriar `ai_resolve_people` sem o CTE `loose` e dropar `fold_loose`.

create or replace function conv_private.fold_loose(p text) returns text
language sql immutable set search_path = '' as $$
  select trim(regexp_replace(translate(replace(replace(conv_private.fold(coalesce(p, '')), 'th', 't'), 'ph', 'f'), 'zyk', 'sic'), '([a-z])\1+', '\1', 'g'))
$$;
revoke all on function conv_private.fold_loose(text) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION conv_private.ai_resolve_people(p_names text[], p_scope text DEFAULT 'member'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_out jsonb := '[]'::jsonb; v_name text; v_q text; v_match jsonb; v_n integer;
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
            select 1 from regexp_split_to_table(conv_private.fold_loose(v_q), '\s+') w
            where w <> '' and conv_private.fold_loose(name) not like '%' || w || '%')
          or not exists (
            select 1 from regexp_split_to_table(conv_private.fold_loose(name), '\s+') w
            where w <> '' and not (' ' || conv_private.fold_loose(v_q) || ' ') like '% ' || w || ' %')
        )
      order by name limit 6
    ), chosen as (
      select * from exact
      union all
      select * from partial where not exists (select 1 from exact)
      union all
      select * from loose where not exists (select 1 from exact) and not exists (select 1 from partial)
    )
    select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'kind', c.kind, 'hint', c.hint) order by c.name), '[]'::jsonb), count(*)
      into v_match, v_n from chosen c;
    v_out := v_out || jsonb_build_array(jsonb_build_object('query', v_name,
      'status', case when v_n = 1 then 'unique' when v_n = 0 then 'none' else 'ambiguous' end, 'matches', v_match));
  end loop;
  return v_out;
end $function$;
