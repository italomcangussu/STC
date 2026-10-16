-- Assessor de professor: o contato cadastrado em conv_contact_delegates fala com o João COMO o professor,
-- sem nunca herdar poder de administrador e sem vincular o telefone ao cadastro do professor.

create temp table u as select fab.usuario('prof@x.com') as prof, fab.usuario('adm@x.com') as adm;
grant select on u to authenticated;
insert into public.profiles (id, name, role) select prof, 'Professor A', 'socio' from u on conflict (id) do update set name = excluded.name, role = excluded.role;
insert into public.profiles (id, name, role) select adm, 'Admin', 'admin' from u on conflict (id) do update set name = excluded.name, role = excluded.role;
insert into public.professors (id, user_id, name) values ('00000000-0000-0000-0000-0000000000a1', (select prof from u), 'Professor A');

insert into public.conv_contacts (id, phone, name) values
  ('00000000-0000-0000-0000-00000000c001', '558800000001', 'Assessor do Professor A'),
  ('00000000-0000-0000-0000-00000000c002', '558800000002', 'Desconhecido');
insert into public.conv_conversations (id, kind, contact_id) values
  ('00000000-0000-0000-0000-00000000d001', 'direct', '00000000-0000-0000-0000-00000000c001'),
  ('00000000-0000-0000-0000-00000000d002', 'direct', '00000000-0000-0000-0000-00000000c002');
insert into public.conv_ai_sessions (id, conversation_id, requester_contact_id, expires_at) values
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', now() + interval '1 day'),
  ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c002', now() + interval '1 day');

-- 1) sem delegação o contato é um desconhecido
do $$ begin
  assert conv_private.acting_profile_id('00000000-0000-0000-0000-00000000c001') is null, 'sem delegação não há cadastro';
  assert conv_private.ai_context('00000000-0000-0000-0000-00000000e001')->'requester'->'profile' = 'null'::jsonb, 'sem delegação o João não reconhece';
end $$;

-- 2) com a delegação o assessor fala como o professor: perfil do professor, professor_id preenchido, sem admin
insert into public.conv_contact_delegates (contact_id, principal_profile_id) select '00000000-0000-0000-0000-00000000c001', prof from u;
do $$
declare r jsonb := conv_private.ai_context('00000000-0000-0000-0000-00000000e001')->'requester';
begin
  assert r->'profile'->>'name' = 'Professor A', 'o assessor deveria falar como o professor';
  assert r->'profile'->>'professor_id' = '00000000-0000-0000-0000-0000000000a1', 'o professor deveria ser reconhecido como professor';
  assert (r->'profile'->>'is_admin')::boolean = false, 'assessor nunca é administrador';
  assert r->'acting_for'->>'principal_name' = 'Professor A' and r->'acting_for'->>'kind' = 'professor_assistant', 'o contexto deveria dizer de quem é o assessor';
  assert (select profile_id from public.conv_contacts where id = '00000000-0000-0000-0000-00000000c001') is null, 'o telefone não é vinculado ao professor';
end $$;

-- 3) a proposta de reserva sai em nome do professor; o desconhecido continua barrado
do $$ begin
  assert conv_private.ai_propose('00000000-0000-0000-0000-00000000e001', '{"action":"cancel","reservation_id":"00000000-0000-0000-0000-000000000099"}')->>'code' = 'RESERVATION_NOT_FOUND',
    'o assessor deveria passar da identificação';
  assert conv_private.ai_propose('00000000-0000-0000-0000-00000000e002', '{"action":"cancel","reservation_id":"00000000-0000-0000-0000-000000000099"}')->>'code' = 'REQUESTER_NOT_IDENTIFIED',
    'quem não tem cadastro nem delegação segue barrado';
end $$;

-- 4) assessor de professor que é administrador continua SEM poder de administrador
update public.profiles set role = 'admin' where id = (select prof from u);
do $$ begin
  assert (conv_private.ai_context('00000000-0000-0000-0000-00000000e001')->'requester'->'profile'->>'is_admin')::boolean = false, 'assessor não herda admin';
end $$;
update public.profiles set role = 'socio' where id = (select prof from u);

-- 5) professor inativo ou delegação desligada: o assessor deixa de ser reconhecido na hora
update public.professors set is_active = false where id = '00000000-0000-0000-0000-0000000000a1';
do $$ begin assert conv_private.acting_profile_id('00000000-0000-0000-0000-00000000c001') is null, 'professor inativo corta a delegação'; end $$;
update public.professors set is_active = true where id = '00000000-0000-0000-0000-0000000000a1';
update public.conv_contact_delegates set active = false where contact_id = '00000000-0000-0000-0000-00000000c001';
do $$ begin assert conv_private.acting_profile_id('00000000-0000-0000-0000-00000000c001') is null, 'delegação desligada corta'; end $$;

-- 6) a tabela só é lida pela diretoria; ninguém escreve pelo app
update public.conv_contact_delegates set active = true;
select fab.como('authenticated', (select prof from u));
select fab.espera_linhas('select 1 from public.conv_contact_delegates', 0);
select fab.espera_erro($$insert into public.conv_contact_delegates (contact_id, principal_profile_id) values ('00000000-0000-0000-0000-00000000c002', auth.uid())$$, 'permission denied');
select fab.como('authenticated', (select adm from u));
select fab.espera_linhas('select 1 from public.conv_contact_delegates', 1);
