-- O admin edita um placar já publicado e a chave acompanha: o vencedor novo toma a vaga do antigo
-- no jogo seguinte; reabrir esvazia a vaga; com o jogo seguinte já jogado, a troca é recusada.
create temp table u as select fab.usuario('admin-chave@x.com') as adm, fab.usuario('socio-chave@x.com') as soc;
grant select on u to authenticated;
insert into public.profiles (id, name, role) select adm, 'Admin Chave', 'admin' from u
  on conflict (id) do update set role = excluded.role;
insert into public.profiles (id, name, role) select soc, 'Sócio Chave', 'socio' from u
  on conflict (id) do update set role = excluded.role;

insert into public.championships (id, name, status, format, start_date, end_date)
values ('00000000-0000-0000-0000-0000000c4a00', 'Teste da chave', 'ongoing', 'mata-mata', '2026-11-27', '2026-11-29');
insert into public.championship_registrations (id, championship_id, participant_type, guest_name, class) values
  ('00000000-0000-0000-0000-0000000c4a01', '00000000-0000-0000-0000-0000000c4a00', 'guest', 'Ana', '4ª Classe'),
  ('00000000-0000-0000-0000-0000000c4a02', '00000000-0000-0000-0000-0000000c4a00', 'guest', 'Bia', '4ª Classe'),
  ('00000000-0000-0000-0000-0000000c4a03', '00000000-0000-0000-0000-0000000c4a00', 'guest', 'Cris', '4ª Classe');
-- J1 Ana x Bia; o vencedor vai para a vaga A do J2, contra a Cris.
insert into public.matches (id, championship_id, phase, registration_a_id, registration_b_id, status, match_number) values
  ('00000000-0000-0000-0000-0000000c4a11', '00000000-0000-0000-0000-0000000c4a00', 'quarterfinal',
   '00000000-0000-0000-0000-0000000c4a01', '00000000-0000-0000-0000-0000000c4a02', 'pending', 1);
insert into public.matches (id, championship_id, phase, registration_b_id, player_a_source_match_id, status, match_number) values
  ('00000000-0000-0000-0000-0000000c4a12', '00000000-0000-0000-0000-0000000c4a00', 'semifinal',
   '00000000-0000-0000-0000-0000000c4a03', '00000000-0000-0000-0000-0000000c4a11', 'pending', 2);

select fab.como('authenticated', (select adm from u));

-- Dado o J1 publicado com vitória da Ana, quando o admin edita o placar dando a vitória à Bia,
-- então a Bia toma a vaga da Ana no J2.
update public.matches set score_a = '{6,6}', score_b = '{2,3}', status = 'finished',
  winner_registration_id = '00000000-0000-0000-0000-0000000c4a01'
where id = '00000000-0000-0000-0000-0000000c4a11';
select fab.espera_linhas($$select 1 from public.matches where id = '00000000-0000-0000-0000-0000000c4a12'
  and registration_a_id = '00000000-0000-0000-0000-0000000c4a01'$$, 1);

select fab.espera_afetadas($$update public.matches set score_a = '{2,3}', score_b = '{6,6}',
  winner_registration_id = '00000000-0000-0000-0000-0000000c4a02'
  where id = '00000000-0000-0000-0000-0000000c4a11'$$, 1);
select fab.espera_linhas($$select 1 from public.matches where id = '00000000-0000-0000-0000-0000000c4a12'
  and registration_a_id = '00000000-0000-0000-0000-0000000c4a02'
  and registration_b_id = '00000000-0000-0000-0000-0000000c4a03'$$, 1);

-- Editar só o placar, sem trocar o vencedor, não mexe na chave.
update public.matches set score_a = '{4,3}', score_b = '{6,6}' where id = '00000000-0000-0000-0000-0000000c4a11';
select fab.espera_linhas($$select 1 from public.matches where id = '00000000-0000-0000-0000-0000000c4a11'
  and score_a = '{4,3}'$$, 1);
select fab.espera_linhas($$select 1 from public.matches where id = '00000000-0000-0000-0000-0000000c4a12'
  and registration_a_id = '00000000-0000-0000-0000-0000000c4a02'$$, 1);

-- Reabrir o J1 esvazia a vaga do J2.
update public.matches set status = 'pending', winner_registration_id = null where id = '00000000-0000-0000-0000-0000000c4a11';
select fab.espera_linhas($$select 1 from public.matches where id = '00000000-0000-0000-0000-0000000c4a12'
  and registration_a_id is null and registration_b_id = '00000000-0000-0000-0000-0000000c4a03'$$, 1);

-- Com o J2 já jogado pela Bia, trocar o vencedor do J1 é recusado.
update public.matches set score_a = '{2,3}', score_b = '{6,6}', status = 'finished',
  winner_registration_id = '00000000-0000-0000-0000-0000000c4a02'
where id = '00000000-0000-0000-0000-0000000c4a11';
update public.matches set score_a = '{6,6}', score_b = '{1,1}', status = 'finished',
  winner_registration_id = '00000000-0000-0000-0000-0000000c4a02'
where id = '00000000-0000-0000-0000-0000000c4a12';
select fab.espera_erro($$update public.matches set score_a = '{6,6}', score_b = '{2,3}',
  winner_registration_id = '00000000-0000-0000-0000-0000000c4a01'
  where id = '00000000-0000-0000-0000-0000000c4a11'$$, 'jogo seguinte');

-- Sócio não edita placar publicado (só o admin).
select fab.como('authenticated', (select soc from u));
select fab.espera_afetadas($$update public.matches set score_a = '{0,0}' where id = '00000000-0000-0000-0000-0000000c4a11'$$, 0);
