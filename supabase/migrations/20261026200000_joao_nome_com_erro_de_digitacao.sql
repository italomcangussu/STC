-- João: nome de pessoa com erro de digitação vira pergunta, não "não encontrei".
-- Caso (26/10): o Thieslley pediu "Avise ao Hermerson, o presidente…"; a busca de sócio não achava "Hermerson Veras"
-- (o cadastro é Hermeson Veras) e o João repetiu "Não encontrei… é convidada sua?" a cada resposta.
-- Agora, sem resultado exato, parcial ou aproximado, palavras quase iguais (1 letra de diferença até 7 letras, 2 a partir
-- de 8) sugerem a pessoa: "No cadastro tem Hermeson Veras: é essa pessoa?". O servidor continua sem escolher sozinho.
-- Rollback: recriar ai_resolve_people da 20261019130000 e dropar name_typo_match e word_distance.

create or replace function conv_private.word_distance(a text, b text) returns integer
language plpgsql immutable set search_path = '' as $$
declare la int := length(a); lb int := length(b); prev int[]; cur int[]; i int; j int;
begin
  if a = b then return 0; end if;
  if la = 0 then return lb; end if;
  if lb = 0 then return la; end if;
  prev := array(select generate_series(0, lb));
  for i in 1..la loop
    cur := array[i];
    for j in 1..lb loop
      cur := cur || least(prev[j + 1] + 1, cur[j] + 1, prev[j] + case when substr(a, i, 1) = substr(b, j, 1) then 0 else 1 end);
    end loop;
    prev := cur;
  end loop;
  return prev[lb + 1];
end $$;

-- Toda palavra do pedido (3+ letras) tem uma palavra do nome (ou apelido) a no máximo 1 letra de distância (2 se a palavra
-- tem 8+ letras). Palavras curtas (de, da) não contam. Pelo menos uma palavra precisa contar.
create or replace function conv_private.name_typo_match(p_query text, p_name text, p_aliases text[] default '{}') returns boolean
language sql immutable set search_path = '' as $$
  with q as (select w from regexp_split_to_table(conv_private.fold(trim(p_query)), '\s+') w where length(w) >= 3),
       n as (select w from regexp_split_to_table(conv_private.fold(p_name || ' ' || array_to_string(coalesce(p_aliases, '{}'), ' ')), '\s+') w where w <> '')
  select exists (select 1 from q)
     and not exists (
       select 1 from q
       where not exists (
         select 1 from n
         where abs(length(n.w) - length(q.w)) <= 2
           and conv_private.word_distance(q.w, n.w) <= case when length(q.w) >= 8 then 2 else 1 end))
$$;

create or replace function conv_private.ai_resolve_people(p_names text[], p_scope text DEFAULT 'member'::text)
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
      -- Dúvida: nada achado acima. Vira PERGUNTA ("é o Hermeson Veras?"), nunca escolha:
      --  · aluno: o primeiro nome bate;
      --  · qualquer pessoa: cada palavra do pedido é quase igual a uma palavra do nome (erro de digitação: Hermerson).
      select * from pool
      where sc = p_scope
        and (
          (p_scope = 'student'
            and split_part(conv_private.fold_loose(name), ' ', 1) = split_part(conv_private.fold_loose(v_name), ' ', 1))
          or conv_private.name_typo_match(v_name, name, aliases)
        )
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
