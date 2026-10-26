-- Nome de sócio com erro de digitação vira pergunta ("é o Hermeson Veras?"); nome distante continua "não encontrei".
create temp table nd as select fab.usuario('hermeson@x.com') as h, fab.usuario('henrique@x.com') as k;
insert into public.profiles (id, name, role) select h, 'Hermeson Veras', 'admin' from nd on conflict (id) do update set name = excluded.name, role = excluded.role;
insert into public.profiles (id, name, role) select k, 'Henrique Souza', 'socio' from nd on conflict (id) do update set name = excluded.name, role = excluded.role;
do $$
declare r jsonb := conv_private.ai_resolve_people(array['Hermerson Veras', 'Hermerson', 'Hermeson', 'Roberto Carlos', 'Henrique Sousa'], 'member');
begin
  assert r->0->>'status' = 'suggest' and r->0->'matches'->0->>'name' = 'Hermeson Veras', 'Hermerson Veras sugere Hermeson Veras: ' || (r->0)::text;
  assert r->1->>'status' = 'suggest' and r->1->'matches'->0->>'name' = 'Hermeson Veras', 'só o primeiro nome com erro também sugere: ' || (r->1)::text;
  assert r->2->>'status' = 'unique', 'nome certo continua achando direto: ' || (r->2)::text;
  assert r->3->>'status' = 'none', 'nome distante não sugere ninguém: ' || (r->3)::text;
  assert r->4->>'status' in ('unique', 'suggest') and r->4->'matches'->0->>'name' = 'Henrique Souza', 'Sousa/Souza: ' || (r->4)::text;
  assert conv_private.word_distance('hermerson', 'hermeson') = 1, 'distância 1';
  assert not conv_private.name_typo_match('Ana', 'Hermeson Veras'), 'palavra curta não casa com nome distante';
  assert not conv_private.name_typo_match('de', 'Hermeson Veras'), 'sem palavra de 3+ letras não sugere';
end $$;
