-- Sugestão de categoria (ajuste de 20261022050000): "Conta de energia ENEL" virava Contabilidade porque "conta"
-- casava com "Contador". Palavras genéricas (conta, serviço, taxa…) saem da comparação e vence quem tem mais
-- palavras em comum, contando também o nome da categoria ("energia" → Energia).

create or replace function fin_private.word_stems(p_text text) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(distinct left(w, 4)), '{}'::text[])
  from regexp_split_to_table(fin_private.fold_text(p_text), '[^a-z0-9]+') w
  where length(w) >= 4 and w not in ('para', 'pelo', 'pela', 'como', 'mais', 'esse', 'essa', 'este', 'esta', 'valor',
    'despesa', 'despesas', 'gasto', 'gastos', 'compra', 'compras', 'pagamento', 'pago', 'paga', 'referente', 'clube', 'lancar', 'favor',
    'conta', 'contas', 'servico', 'servicos', 'taxa', 'mensal', 'nota')
$$;

create or replace function conv_private.entry_category_pick(p_kind text, p_name text, p_desc text)
returns table(id uuid, name text, how text)
language plpgsql stable security definer set search_path = '' as $$
declare v_name text := nullif(trim(coalesce(p_name, '')), ''); v_n int;
begin
  if v_name is not null then
    return query select c.id, c.name, 'nome'::text from conv_private.entry_categories(p_kind) c
      where fin_private.fold_text(c.name) = fin_private.fold_text(v_name) order by c.position limit 1;
    if found then return; end if;
    select count(*) into v_n from conv_private.entry_categories(p_kind) c
      where fin_private.fold_text(c.name) like '%' || fin_private.fold_text(v_name) || '%'
         or fin_private.fold_text(v_name) like '%' || fin_private.fold_text(c.name) || '%';
    if v_n = 1 then
      return query select c.id, c.name, 'nome'::text from conv_private.entry_categories(p_kind) c
        where fin_private.fold_text(c.name) like '%' || fin_private.fold_text(v_name) || '%'
           or fin_private.fold_text(v_name) like '%' || fin_private.fold_text(c.name) || '%';
      return;
    end if;
    return query with s as (
      -- todas as palavras ditas estão no nome da categoria ("material esportivo" não vira "Material de limpeza")
      select c.id, c.name, cardinality(array(select unnest(fin_private.word_stems(c.name)) intersect select unnest(fin_private.word_stems(v_name)))) sc
      from conv_private.entry_categories(p_kind) c)
      select s.id, s.name, 'nome'::text from s
      where s.sc > 0 and s.sc = cardinality(fin_private.word_stems(v_name))
        and (select count(*) from s s2 where s2.sc = s.sc) = 1;
    if found then return; end if;
  end if;
  -- Lançamentos parecidos (palavras em comum) dos últimos 18 meses: a categoria mais usada; "Outras" só se não houver outra.
  -- Vence quem tem mais palavras em comum (no lançamento antigo ou no nome da categoria); depois, o mais usado.
  return query with h as (
    select e.category_id cid, count(*) n,
      max(cardinality(array(select unnest(fin_private.word_stems(e.description)) intersect select unnest(fin_private.word_stems(p_desc))))) sc
    from public.fin_entries e
    where e.kind = p_kind and e.status <> 'canceled' and e.category_id is not null and e.created_at > now() - interval '18 months'
      and fin_private.word_stems(e.description) && fin_private.word_stems(p_desc)
    group by e.category_id)
    select c.id, c.name, 'historico'::text from h join conv_private.entry_categories(p_kind) c on c.id = h.cid
    order by h.sc + cardinality(array(select unnest(fin_private.word_stems(c.name)) intersect select unnest(fin_private.word_stems(p_desc)))) desc,
      (fin_private.fold_text(c.name) like 'outr%'), h.n desc, c.name limit 1;
  if found then return; end if;
  return query with s as (
    select c.id, c.name, cardinality(array(select unnest(fin_private.word_stems(c.name)) intersect select unnest(fin_private.word_stems(p_desc)))) sc
    from conv_private.entry_categories(p_kind) c)
    select s.id, s.name, 'palavra'::text from s
    where s.sc > 0 and s.sc = (select max(sc) from s) and (select count(*) from s s2 where s2.sc = s.sc) = 1;
end $$;

revoke all on function fin_private.word_stems(text) from public, anon, authenticated;
revoke all on function conv_private.entry_category_pick(text, text, text) from public, anon, authenticated;
