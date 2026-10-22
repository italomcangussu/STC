-- Mensalista Kids paga metade do mensalista; o preço vem do financeiro e qualquer usuário logado lê a tabela de preços.
create temp table u as select fab.usuario('prof@x.com') as prof;
grant select on u to authenticated;
insert into public.fin_settings (id, card_mensal_price_cents) values (true, 20000) on conflict (id) do update set card_mensal_price_cents = 20000;

select fab.como('authenticated', (select prof from u));
do $$ declare p jsonb := public.student_card_prices(); begin
  assert (p->>'regular_cents')::bigint = 20000 and (p->>'kids_cents')::bigint = 10000, 'mensalista 200, kids 100: ' || p::text;
end $$;

select fab.dono();
update public.fin_settings set card_mensal_price_cents = 25001;
do $$ begin
  assert fin_private.card_price_cents('kids') = 12501, 'metade arredondada para o centavo';
  assert fin_private.card_price_cents('regular') = 25001, 'mensalista segue o financeiro';
end $$;

insert into public.non_socio_students (id, name, plan_type, plan_status, student_type) values
  ('00000000-0000-0000-0000-0000000007a1', 'Filho do Henrique', 'Card Mensal', 'active', 'regular');
do $$ begin
  assert (select card_tier from public.non_socio_students where id = '00000000-0000-0000-0000-0000000007a1') = 'regular', 'aluno nasce na faixa regular';
end $$;
update public.non_socio_students set card_tier = 'kids' where id = '00000000-0000-0000-0000-0000000007a1';
select fab.espera_erro($$update public.non_socio_students set card_tier = 'bebe' where id = '00000000-0000-0000-0000-0000000007a1'$$, 'card_tier_check');

select fab.como('anon');
select fab.espera_erro($$select public.student_card_prices()$$, 'permission denied');
