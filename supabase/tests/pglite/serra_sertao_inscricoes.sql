-- Serra e Sertão 2026: o João inscreve sem duplicar, confirma pelo Pix, respeita vagas e prazo, e o admin sorteia a chave.
-- O campeonato, as rodadas e a categoria como as migrations deixaram no remoto (a base de teste só tem a estrutura).
insert into public.fin_categories (name, kind, dre_line, system_key) select 'Inscrição Serra e Sertão', 'revenue', 'revenue', 'championship_serra_sertao'
where not exists (select 1 from public.fin_categories where system_key = 'championship_serra_sertao');
insert into public.championships (name, status, format, start_date, end_date, slug, edition_year, allow_guests, registration_open, format_config, joao_info)
select 'Serra e Sertão 2026', 'draft', 'mata-mata', '2026-11-27', '2026-11-29', 'serra-e-sertao-2026', 2026, true, true,
  '{"4ª Classe":{"format":"mata-mata","seeded":true,"qualifying":null,"mainDrawStartPhase":"round_of_16"},"5ª Classe":{"format":"mata-mata","seeded":true,"qualifying":null,"mainDrawStartPhase":"round_of_16"}}',
  jsonb_build_object('enabled', true, 'price_cents', 13000, 'shirt_sizes', jsonb_build_array('P', 'M', 'G', 'GG'), 'max_per_class', 16,
    'deadline', '2099-12-31', 'category_name', 'Inscrição Serra e Sertão', 'shirt_image', null,
    'info', 'Jogos em melhor de 3 sets. Se houver 3º set, ele é decidido num tie-break de 7 pontos.')
where not exists (select 1 from public.championships where slug = 'serra-e-sertao-2026');
insert into public.championship_rounds (championship_id, class, round_number, name, phase, start_date, end_date, status)
select c.id, k.classe, r.n, r.nome, r.fase, r.dia, r.dia, 'pending' from public.championships c
cross join (values ('4ª Classe'), ('5ª Classe')) as k(classe)
cross join (values (1, 'Oitavas de Final', 'oitavas', date '2026-11-27'), (2, 'Quartas de Final', 'quartas', date '2026-11-28'),
                   (3, 'Semifinais', 'semifinal', date '2026-11-29'), (4, 'Final', 'final', date '2026-11-29')) as r(n, nome, fase, dia)
where c.slug = 'serra-e-sertao-2026' on conflict (championship_id, class, round_number) do nothing;
-- A foto da camisa: o mesmo update da migration 20261026150000.
update public.championships
set joao_info = joao_info
  || jsonb_build_object('shirt_image', jsonb_build_object(
       'path', 'championships/serra-e-sertao-2026/camisa-atleta.jpg', 'mime', 'image/jpeg', 'name', 'camisa-atleta-serra-e-sertao.jpg'))
  || jsonb_build_object('info', (joao_info->>'info') || E'\n' ||
       'Camisa do atleta: branca com detalhes em vermelho, "Auge Open" na frente, "Circuito de Tênis Serra Sertão - 3ª etapa" na manga e "ATLETA" nas costas. A camisa vermelha é da organização, não do atleta.')
where slug = 'serra-e-sertao-2026' and joao_info->'shirt_image' is distinct from jsonb_build_object(
  'path', 'championships/serra-e-sertao-2026/camisa-atleta.jpg', 'mime', 'image/jpeg', 'name', 'camisa-atleta-serra-e-sertao.jpg');
-- O título do evento: o mesmo update da migration 20261026170000.
update public.championships
set joao_info = joao_info
  || jsonb_build_object('title', jsonb_build_array('AUGE OPEN', '3ª Etapa do Circuito Serra e Sertão de Tênis'))
  || jsonb_build_object('info', (joao_info->>'info') || E'\n' ||
       'Nome do evento: AUGE OPEN, a 3ª Etapa do Circuito Serra e Sertão de Tênis (Serra e Sertão 2026 é o mesmo campeonato).')
where slug = 'serra-e-sertao-2026' and joao_info->'title' is null;

create temp table u as select fab.usuario('henrique@x.com') as adm, fab.usuario('socio@x.com') as soc;
grant select on u to service_role, authenticated;
insert into public.profiles (id, name, role) select adm, 'Henrique Coelho', 'admin' from u on conflict (id) do update set name = excluded.name, role = excluded.role;
insert into public.profiles (id, name, role, is_active, phone) select soc, 'Tiago Sócio', 'socio', true, '88999990777' from u
  on conflict (id) do update set name = excluded.name, role = excluded.role, is_active = true, phone = excluded.phone;
insert into public.fin_settings (id, payee_names, pix_key) values (true, array['Sobral Tenis Clube'], '52.393.541/0001-20')
  on conflict (id) do update set payee_names = excluded.payee_names, pix_key = excluded.pix_key;
update public.fin_settings set finance_admin_profile_id = (select adm from u);
insert into public.fin_accounts (id, name, kind, active, is_default_receipts, opening_date) values ('00000000-0000-0000-0000-0000000000c1', 'Cora', 'bank', true, true, '2026-01-01');

-- Henrique (admin), um atleta de Tianguá sem cadastro e o Tiago (sócio), cada um no privado com o João.
insert into public.conv_contacts (id, phone, name, profile_id, link_status) select '00000000-0000-0000-0000-00000000c601', '558800000601', 'Henrique', adm, 'linked' from u;
insert into public.conv_contacts (id, phone, name, link_status) values ('00000000-0000-0000-0000-00000000c602', '5588999991001', 'Caio Tianguá', 'none');
insert into public.conv_conversations (id, kind, contact_id) values
  ('00000000-0000-0000-0000-00000000d601', 'direct', '00000000-0000-0000-0000-00000000c601'),
  ('00000000-0000-0000-0000-00000000d602', 'direct', '00000000-0000-0000-0000-00000000c602');
insert into public.conv_ai_sessions (id, conversation_id, requester_contact_id, expires_at) values
  ('00000000-0000-0000-0000-00000000e601', '00000000-0000-0000-0000-00000000d601', '00000000-0000-0000-0000-00000000c601', now() + interval '1 day'),
  ('00000000-0000-0000-0000-00000000e602', '00000000-0000-0000-0000-00000000d602', '00000000-0000-0000-0000-00000000c602', now() + interval '1 day');

create function pg_temp.inscrever(p_session text, p jsonb) returns jsonb language sql as $$
  select public.conv_svc_ai_championship_signup(p_session::uuid, p) $$;

-- O que o João sabe: o campeonato aberto, as duas classes com 16 vagas, sem inscrição do atleta ainda.
select fab.como('service_role');
do $$ declare r jsonb := public.conv_svc_ai_championship_context('00000000-0000-0000-0000-00000000e602'); c jsonb; begin
  c := r->'championships'->0;
  assert c->>'name' = 'Serra e Sertão 2026', 'campeonato no contexto: ' || r::text;
  assert (c->>'registration_open')::boolean and (c->>'price_cents')::int = 13000, 'aberto e com preço';
  assert jsonb_array_length(c->'classes') = 2 and (c->'classes'->0->>'spots_left')::int = 16, 'duas classes com 16 vagas';
  assert jsonb_array_length(c->'mine') = 0 and not (r->>'is_admin')::boolean and c->'admin' = 'null'::jsonb, 'atleta não vê a lista do admin';
  assert r->>'requester_phone' = '88999991001' and r->>'pix_key' = '52.393.541/0001-20', 'telefone de quem fala e a chave Pix';
  assert c->>'info' like '%tie-break de 7 pontos%', 'informações do campeonato';
  assert c->'shirt_image'->>'path' = 'championships/serra-e-sertao-2026/camisa-atleta.jpg' and c->>'info' like '%Camisa do atleta: branca%', 'foto da camisa do atleta';
end $$;

-- Pré-inscrição do próprio atleta: classe "4", camisa em minúscula, telefone com máscara.
do $$ declare r jsonb := pg_temp.inscrever('00000000-0000-0000-0000-00000000e602',
  '{"full_name":"  Caio   Albuquerque ","phone":"(88) 99999-1001","class":"quarta","shirt_size":"m","city":"Tianguá"}'); begin
  assert (r->>'ok')::boolean, 'pré-inscrição: ' || r::text;
  assert r->'signup'->>'full_name' = 'Caio Albuquerque' and r->'signup'->>'class' = '4ª Classe' and r->'signup'->>'shirt_size' = 'M', 'dados normalizados';
  assert r->'signup'->>'status' = 'pre' and not (r->>'waitlist')::boolean and not (r->>'is_member')::boolean, 'pré-inscrito, convidado';
  assert (r->>'my_pending_total_cents')::int = 13000, 'falta pagar uma inscrição';
  assert r->'title'->>0 = 'AUGE OPEN' and r->'title'->>1 like '3ª Etapa%', 'título do evento: ' || r::text;
end $$;

-- Sem duplicar: mesmo telefone com outro nome, e o mesmo nome sem acento e com outro telefone.
do $$ declare r jsonb; begin
  r := pg_temp.inscrever('00000000-0000-0000-0000-00000000e602', '{"full_name":"Outro Nome","phone":"88 999991001","class":"4","shirt_size":"G"}');
  assert r->>'code' = 'DUPLICATE' and (r->>'same_phone')::boolean, 'mesmo telefone: ' || r::text;
  r := pg_temp.inscrever('00000000-0000-0000-0000-00000000e602', '{"full_name":"CAIO ALBUQUERQUE","phone":"88988887777","class":"5","shirt_size":"G"}');
  assert r->>'code' = 'DUPLICATE' and not (r->>'same_phone')::boolean, 'mesmo nome: ' || r::text;
end $$;

-- Dados que não servem.
do $$ declare r jsonb; begin
  r := pg_temp.inscrever('00000000-0000-0000-0000-00000000e602', '{"full_name":"Caio","phone":"88988880001","class":"4","shirt_size":"M"}');
  assert r->>'code' = 'NAME_INCOMPLETE', 'nome sem sobrenome: ' || r::text;
  r := pg_temp.inscrever('00000000-0000-0000-0000-00000000e602', '{"full_name":"Davi Torres","phone":"88988880001","class":"4","shirt_size":"XGG"}');
  assert r->>'code' = 'INVALID_SIZE' and r->>'message' like '%P, M, G, GG%', 'tamanho fora da lista: ' || r::text;
  r := pg_temp.inscrever('00000000-0000-0000-0000-00000000e602', '{"full_name":"Davi Torres","phone":"88988880001","class":"6","shirt_size":"M"}');
  assert r->>'code' = 'INVALID_CLASS', 'classe que não existe: ' || r::text;
  r := pg_temp.inscrever('00000000-0000-0000-0000-00000000e602', '{"full_name":"Davi Torres","phone":"123","class":"4","shirt_size":"M"}');
  assert r->>'code' = 'INVALID_PHONE', 'telefone inválido: ' || r::text;
end $$;

-- Inscrevendo um amigo (outro telefone) e um sócio do STC (reconhecido pelo telefone do cadastro).
do $$ declare r jsonb; begin
  r := pg_temp.inscrever('00000000-0000-0000-0000-00000000e602', '{"full_name":"Davi Torres","phone":"88988880001","class":"5ª","shirt_size":"GG","city":"Tianguá"}');
  assert (r->>'ok')::boolean and (r->>'my_pending_total_cents')::int = 26000 and jsonb_array_length(r->'my_pending') = 2, 'duas pendentes: ' || r::text;
  r := pg_temp.inscrever('00000000-0000-0000-0000-00000000e601', '{"full_name":"Tiago Sócio","phone":"88 9 9999-0777","class":"5","shirt_size":"M"}');
  assert (r->>'ok')::boolean and (r->>'is_member')::boolean, 'sócio reconhecido: ' || r::text;
end $$;

-- Comprovante do Pix.
select fab.dono();
create function pg_temp.comprovante(p_id uuid, p_amount bigint, p_payee text, p_hash text) returns void language sql as $$
  insert into public.conv_messages (id, conversation_id, direction, kind, status, origin, sender_contact_id)
  values (p_id, '00000000-0000-0000-0000-00000000d602', 'inbound', 'image', 'received', 'customer', '00000000-0000-0000-0000-00000000c602');
  insert into fin_private.whatsapp_receipt_intents (id, source_message_id, conversation_id, profile_id, contact_id, original_data)
  values (p_id, p_id, '00000000-0000-0000-0000-00000000d602', null, '00000000-0000-0000-0000-00000000c602',
    jsonb_build_object('storage_path', 'whatsapp/' || p_id || '.jpg', 'file_name', 'pix.jpg', 'content_type', 'image/jpeg', 'size_bytes', 700,
      'content_sha256', p_hash, 'declared_amount_cents', p_amount, 'declared_paid_on', (now() at time zone 'America/Fortaleza')::date::text,
      'ocr_status', 'ok', 'ocr', jsonb_build_object('payee', p_payee)));
$$;

-- R$ 130 com duas pendentes: não adivinha qual atleta pagou.
select pg_temp.comprovante('00000000-0000-0000-0000-00000000f001', 13000, 'Sobral Tenis Clube', repeat('1', 64));
select fab.como('service_role');
do $$ declare r jsonb := public.conv_svc_receipt_championship_auto('00000000-0000-0000-0000-00000000f001'); begin
  assert not (r->>'applied')::boolean and r->>'reason' = 'AMBIGUOUS' and (r->>'total_cents')::int = 26000, 'valor parcial: ' || r::text;
  assert jsonb_array_length(r->'pending') = 2, 'devolve quem está pendente';
end $$;

-- Pix para outra pessoa: não confirma.
select fab.dono();
select pg_temp.comprovante('00000000-0000-0000-0000-00000000f002', 26000, 'Fulano de Tal', repeat('2', 64));
select fab.como('service_role');
do $$ declare r jsonb := public.conv_svc_receipt_championship_auto('00000000-0000-0000-0000-00000000f002'); begin
  assert r->>'reason' = 'PAYEE', 'favorecido errado: ' || r::text;
end $$;

-- R$ 260 para o clube: as duas confirmadas, receita lançada com o comprovante, atletas na chave.
select fab.dono();
select pg_temp.comprovante('00000000-0000-0000-0000-00000000f003', 26000, 'SOBRAL TENIS CLUBE', repeat('3', 64));
select fab.como('service_role');
do $$ declare r jsonb := public.conv_svc_receipt_championship_auto('00000000-0000-0000-0000-00000000f003'); begin
  assert (r->>'applied')::boolean, 'confirma: ' || r::text;
  assert jsonb_array_length(r->'confirmed') = 2 and jsonb_array_length(r->'waitlist') = 0, 'dois inscritos';
  assert jsonb_array_length(r->'athletes') = 2 and r->'athletes'->0->>'class' = '4ª Classe' and r->'athletes'->0->>'shirt_size' = 'M'
     and r->'athletes'->0->>'status' = 'confirmed' and r->'athletes'->0->>'phone' = '88999991001', 'cartão de cada atleta: ' || r::text;
  assert r->>'payee' = 'SOBRAL TENIS CLUBE' and r->>'paid_on' is not null and r->'title'->>0 = 'AUGE OPEN', 'o que o comprovante mostrou e o título';
  assert r->>'admin_name' = 'Henrique' and r->>'admin_conversation_id' is not null, 'avisa o financeiro';
end $$;
select fab.dono();
do $$ declare v_entry uuid; begin
  select fin_entry_id into v_entry from public.championship_signups where full_name = 'Caio Albuquerque';
  assert (select count(*) from public.championship_signups where status = 'confirmed' and registration_id is not null) = 2, 'pré-inscrições confirmadas';
  assert (select count(*) from public.championship_registrations r join public.championships c on c.id = r.championship_id
          where c.slug = 'serra-e-sertao-2026' and r.participant_type = 'guest' and r.guest_cidade = 'Tianguá') = 2, 'na tabela oficial, como convidados';
  assert (select e.kind = 'revenue' and e.status = 'paid' and e.amount_cents = 26000 and k.name = 'Inscrição Serra e Sertão'
          from public.fin_entries e join public.fin_categories k on k.id = e.category_id where e.id = v_entry), 'receita paga na categoria';
  assert (select count(*) from public.fin_attachments where entry_id = v_entry and bucket = 'fin-receipts') = 1, 'comprovante anexado';
  assert (select status from fin_private.whatsapp_receipt_intents where id = '00000000-0000-0000-0000-00000000f003') = 'confirmed', 'comprovante encerrado';
end $$;

-- O mesmo arquivo de novo não confirma outra vez (e não há mais pendente desse contato).
select pg_temp.comprovante('00000000-0000-0000-0000-00000000f004', 26000, 'Sobral Tenis Clube', repeat('3', 64));
select fab.como('service_role');
do $$ declare r jsonb := public.conv_svc_receipt_championship_auto('00000000-0000-0000-0000-00000000f004'); begin
  assert r->>'reason' = 'NO_SIGNUP', 'nada pendente: ' || r::text;
end $$;

-- Classe cheia: quem chega entra na lista de espera.
select fab.dono();
insert into public.championship_registrations (championship_id, participant_type, guest_name, class)
select c.id, 'guest', 'Atleta Cinco ' || g, '5ª Classe' from public.championships c cross join generate_series(1, 15) g where c.slug = 'serra-e-sertao-2026';
select fab.como('service_role');
do $$ declare r jsonb := pg_temp.inscrever('00000000-0000-0000-0000-00000000e602', '{"full_name":"Enzo Lima","phone":"88988880002","class":"5","shirt_size":"P"}'); begin
  assert (r->>'ok')::boolean and (r->>'waitlist')::boolean and r->'signup'->>'status' = 'waitlist' and (r->>'spots_left')::int = 0, 'lista de espera: ' || r::text;
end $$;

-- Cabeças de chave e sorteio: só o administrador.
select fab.dono();
insert into public.championship_registrations (championship_id, participant_type, guest_name, class)
select c.id, 'guest', 'Atleta Quatro ' || g, '4ª Classe' from public.championships c cross join generate_series(1, 11) g where c.slug = 'serra-e-sertao-2026';
select fab.como('service_role');
do $$ declare r jsonb; begin
  r := public.conv_svc_ai_championship_seeds('00000000-0000-0000-0000-00000000e602', '{"class":"4","names":["Caio Albuquerque"]}');
  assert r->>'code' = 'FORBIDDEN', 'atleta não define cabeça: ' || r::text;
  r := public.conv_svc_ai_championship_draw('00000000-0000-0000-0000-00000000e602', '{"class":"4"}');
  assert r->>'code' = 'FORBIDDEN', 'atleta não sorteia: ' || r::text;
  r := public.conv_svc_ai_championship_seeds('00000000-0000-0000-0000-00000000e601', '{"class":"4","names":["Atleta Quatro 3"]}');
  assert (r->>'ok')::boolean, 'nome exato: ' || r::text;
  r := public.conv_svc_ai_championship_seeds('00000000-0000-0000-0000-00000000e601', '{"class":"4","names":["Atleta Quatro"]}');
  assert r->>'code' = 'AMBIGUOUS', 'nome que serve para vários: ' || r::text;
  r := public.conv_svc_ai_championship_seeds('00000000-0000-0000-0000-00000000e601', '{"class":"4","names":["Fulano Ninguém"]}');
  assert r->>'code' = 'NOT_FOUND', 'quem não está inscrito: ' || r::text;
  r := public.conv_svc_ai_championship_seeds('00000000-0000-0000-0000-00000000e601', '{"class":"4","names":["caio albuquerque","Atleta Quatro 7"]}');
  assert (r->>'ok')::boolean and r->'seeds'->>0 = 'Caio Albuquerque' and r->'seeds'->>1 = 'Atleta Quatro 7', 'dois cabeças na ordem: ' || r::text;
end $$;
select fab.dono();
do $$ begin
  assert (select count(*) from public.championship_registrations where class = '4ª Classe' and cabeca_de_chave) = 2, 'só os dois novos são cabeças';
  assert (select seed_number from public.championship_registrations where guest_name = 'Atleta Quatro 3') is null, 'o cabeça anterior saiu';
end $$;

-- Sorteio da 4ª: 12 inscritos → 8 jogos de oitavas, 4 passam direto, e a chave até a final.
select fab.como('service_role');
do $$ declare r jsonb := public.conv_svc_ai_championship_draw('00000000-0000-0000-0000-00000000e601', '{"class":"4"}'); begin
  assert (r->>'ok')::boolean and (r->>'count')::int = 12 and jsonb_array_length(r->'matches') = 8, 'sorteio: ' || r::text;
  assert (select count(*) from jsonb_array_elements(r->'matches') m where (m->>'bye')::boolean) = 4, 'quatro passam direto';
  assert r->'matches'->0->>'a' = 'Caio Albuquerque', 'cabeça 1 no topo';
  assert r->'matches'->7->>'b' = 'Atleta Quatro 7', 'cabeça 2 na base';
end $$;
select fab.dono();
do $$ declare v_champ uuid := (select id from public.championships where slug = 'serra-e-sertao-2026'); begin
  assert (select count(*) from public.matches m join public.championship_rounds r on r.id = m.round_id where r.championship_id = v_champ and r.class = '4ª Classe') = 15, '15 jogos';
  assert (select count(*) from public.matches m join public.championship_rounds r on r.id = m.round_id
          where r.championship_id = v_champ and r.class = '4ª Classe' and r.phase = 'oitavas' and m.status = 'finished' and m.result_type = 'walkover') = 4, 'WO dos que passam direto';
  -- Quem passou direto já está nas quartas.
  assert (select count(*) from public.matches m join public.championship_rounds r on r.id = m.round_id
          where r.championship_id = v_champ and r.class = '4ª Classe' and r.phase = 'quartas'
          and (m.registration_a_id is not null or m.registration_b_id is not null)) >= 2, 'avançaram para as quartas';
  assert (select count(*) from public.matches m join public.championship_rounds r on r.id = m.round_id
          where r.championship_id = v_champ and r.phase = 'final' and m.player_a_source_match_id is not null and m.player_b_source_match_id is not null) = 1, 'final ligada às semis';
  assert (select status from public.championships where id = v_champ) = 'ongoing', 'campeonato em andamento';
  assert (select status from public.championship_rounds where championship_id = v_champ and class = '4ª Classe' and phase = 'oitavas') = 'active', 'oitavas publicadas';
end $$;

-- Depois do sorteio: não sorteia de novo, a 4ª fecha para inscrição e a 5ª segue aberta.
select fab.como('service_role');
do $$ declare r jsonb; begin
  r := public.conv_svc_ai_championship_draw('00000000-0000-0000-0000-00000000e601', '{"class":"4"}');
  assert r->>'code' = 'DRAWN', 'não repete: ' || r::text;
  r := pg_temp.inscrever('00000000-0000-0000-0000-00000000e602', '{"full_name":"Fabio Reis","phone":"88988880003","class":"4","shirt_size":"P"}');
  assert r->>'code' = 'CLOSED', '4ª fechada depois do sorteio: ' || r::text;
end $$;

-- Prazo vencido: inscrição encerrada.
select fab.dono();
update public.championships set joao_info = joao_info || '{"deadline":"2020-01-01"}' where slug = 'serra-e-sertao-2026';
select fab.como('service_role');
do $$ declare r jsonb := pg_temp.inscrever('00000000-0000-0000-0000-00000000e602', '{"full_name":"Gabriel Reis","phone":"88988880004","class":"5","shirt_size":"P"}'); begin
  assert r->>'code' = 'CLOSED', 'prazo vencido: ' || r::text;
end $$;

-- Ninguém de fora lê as pré-inscrições.
select fab.como('anon');
select fab.espera_erro($$select * from public.championship_signups$$, 'permission denied');
select fab.dono();
select fab.como('authenticated', (select soc from u));
select fab.espera_linhas($$select * from public.championship_signups$$, 0);
select fab.espera_erro($$select public.conv_svc_ai_championship_signup('00000000-0000-0000-0000-00000000e602', '{}')$$, 'permission denied');
