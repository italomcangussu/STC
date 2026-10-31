-- Grupo do campeonato (30/10): o João conhece os inscritos (sócio × convidado) sem pagamento nem telefone; a resenha da
-- diretoria e as boas-vindas a sócio novo continuam só no grupo de sócios; a risada do grupo do campeonato é deixa.

create temp table u as select fab.usuario('carlos@x.com') as carlos;
grant select on u to service_role, authenticated;
insert into public.profiles (id, name) select carlos, 'Carlos Carneiro' from u on conflict (id) do update set name = excluded.name;

insert into public.championships (id, name, status, format, start_date, end_date, slug, edition_year, allow_guests, registration_open, joao_info)
values ('00000000-0000-0000-0000-00000000f101', 'Serra e Sertão 2026', 'draft', 'mata-mata', '2026-11-27', '2026-11-29', 'serra-grupo-teste', 2026, true, true,
  jsonb_build_object('enabled', true, 'title', jsonb_build_array('AUGE OPEN', '3ª Etapa')));
insert into public.championship_registrations (id, championship_id, participant_type, user_id, class)
  select '00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-00000000f101', 'socio', carlos, '4ª Classe' from u;
insert into public.championship_registrations (id, championship_id, participant_type, guest_name, class) values
  ('00000000-0000-0000-0000-00000000a102', '00000000-0000-0000-0000-00000000f101', 'guest', 'Bruno Farias', '4ª Classe');
insert into public.championship_signups (championship_id, class, full_name, name_key, phone, phone_key, city, shirt_size, status, amount_cents, registration_id) values
  ('00000000-0000-0000-0000-00000000f101', '4ª Classe', 'Bruno Farias', 'bruno farias', '5588900000011', '88900000011', 'Tianguá', 'M', 'confirmed', 13000, '00000000-0000-0000-0000-00000000a102');
insert into public.championship_signups (championship_id, class, full_name, name_key, phone, phone_key, city, shirt_size, status, amount_cents) values
  ('00000000-0000-0000-0000-00000000f101', '5ª Classe', 'Maria Eduarda', 'maria eduarda', '5588900000012', '88900000012', 'Ubajara', 'P', 'pre', 13000),
  ('00000000-0000-0000-0000-00000000f101', '5ª Classe', 'Fulano Espera', 'fulano espera', '5588900000013', '88900000013', null, 'G', 'waitlist', 13000);

insert into public.conv_channel (id, ai_group_enabled, mention_verified_at) values (true, true, now())
  on conflict (id) do update set ai_group_enabled = true, mention_verified_at = now();
update public.conv_ai_settings set active = false;
insert into public.conv_ai_settings (version, active, daily_turn_budget, model) values (999, true, 1000, 'openai/gpt-6-luna');

insert into public.conv_groups (id, group_jid, name, status, ai_enabled, last_seen_at) values
  ('00000000-0000-0000-0000-0000000060a1', '120363000000000001@g.us', 'Sócios Sobral Tênis Clube', 'allowed', true, now() - interval '1 hour'),
  ('00000000-0000-0000-0000-0000000060a2', '120363000000000002@g.us', 'AUGE OPEN - 3ª Etapa Serra & Sertão', 'allowed', true, now());
update public.conv_groups set championship_id = '00000000-0000-0000-0000-00000000f101' where id = '00000000-0000-0000-0000-0000000060a2';
insert into public.conv_conversations (id, kind, group_id, ai_status) values
  ('00000000-0000-0000-0000-0000000061a1', 'group', '00000000-0000-0000-0000-0000000060a1', 'ai'),
  ('00000000-0000-0000-0000-0000000061a2', 'group', '00000000-0000-0000-0000-0000000060a2', 'ai');
insert into public.conv_contacts (id, phone, name) values ('00000000-0000-0000-0000-0000000062a1', '558800000555', 'Bruno'),
  ('00000000-0000-0000-0000-0000000062a2', '558800000556', 'Gustavo');
insert into conv_private.joao_spontaneous_window (group_id, active_until, max_triggers, cooldown_minutes) values
  ('00000000-0000-0000-0000-0000000060a1', now() + interval '1 day', 50, 5),
  ('00000000-0000-0000-0000-0000000060a2', now() + interval '1 day', 50, 5);
insert into public.conv_ai_sessions (id, conversation_id, requester_contact_id, expires_at) values
  ('00000000-0000-0000-0000-0000000063a1', '00000000-0000-0000-0000-0000000061a2', '00000000-0000-0000-0000-0000000062a1', now() + interval '1 hour'),
  ('00000000-0000-0000-0000-0000000063a2', '00000000-0000-0000-0000-0000000061a1', '00000000-0000-0000-0000-0000000062a1', now() + interval '1 hour');

do $$ begin
  assert conv_private.members_group_conversation() = '00000000-0000-0000-0000-0000000061a1', 'resenha da diretoria vai para o grupo de sócios, mesmo com o do campeonato mais recente';
  assert (select count(*) from public.conv_svc_welcome_groups()) = 1, 'boas-vindas a sócio novo não vão para o grupo do campeonato';
end $$;

select fab.como('service_role');
do $$ declare p jsonb := public.conv_svc_ai_group_championship('00000000-0000-0000-0000-0000000063a1'); t text := p::text; begin
  assert p->>'name' = 'Serra e Sertão 2026', 'grupo do campeonato traz o campeonato';
  assert (p->>'total')::int = 3 and (p->>'socios')::int = 1, 'painel + pré-inscrito; lista de espera fora: ' || t;
  assert t like '%"name": "Carlos Carneiro", "socio": true%', 'sócio marcado: ' || t;
  assert t like '%"city": "Tianguá", "name": "Bruno Farias", "socio": false%', 'convidado com a cidade da inscrição: ' || t;
  assert t not like '%Fulano Espera%' and t not like '%8890000%' and t not like '%13000%', 'sem espera, telefone ou valor';
  assert public.conv_svc_ai_group_championship('00000000-0000-0000-0000-0000000063a2') is null, 'grupo de sócios não é de campeonato';
end $$;

select fab.dono();
update public.championships set joao_info = joao_info || '{"circuit_ranking": {"classes": [{"class": "4ª Classe", "rows": [{"pos": 8, "name": "Bruno", "total": 400}]}]}}'::jsonb
where id = '00000000-0000-0000-0000-00000000f101';
select fab.como('service_role');
do $$ begin
  assert public.conv_svc_ai_group_championship('00000000-0000-0000-0000-0000000063a1') #>> '{circuit_ranking,classes,0,rows,0,name}' = 'Bruno',
    'ranking do circuito chega ao grupo do campeonato';
  assert jsonb_typeof(public.conv_svc_ai_group_championship('00000000-0000-0000-0000-0000000063a1')->'banter') = 'null',
    'campeonato sem resenha não traz nada';
end $$;

do $$ declare r jsonb := public.conv_svc_group_intro_context('00000000-0000-0000-0000-0000000060a2'); begin
  assert (r->>'ok')::boolean and r->>'conversation_id' = '00000000-0000-0000-0000-0000000061a2', 'contexto da apresentação: ' || r::text;
  assert r->'intro_sent_at' = 'null'::jsonb, 'apresentação ainda não saiu';
  perform public.conv_svc_group_intro_done('00000000-0000-0000-0000-0000000060a2');
  assert (public.conv_svc_group_intro_context('00000000-0000-0000-0000-0000000060a2')->>'intro_sent_at') is not null, 'apresentação marcada';
end $$;

select fab.dono();
-- Risada: deixa no grupo do campeonato, não no de sócios.
insert into public.conv_messages (id, conversation_id, direction, origin, sender_contact_id, kind, body) values
  ('00000000-0000-0000-0000-0000000064a1', '00000000-0000-0000-0000-0000000061a2', 'inbound', 'customer', '00000000-0000-0000-0000-0000000062a2', 'text', 'kkkkkk o Bruno de novo'),
  ('00000000-0000-0000-0000-0000000064a2', '00000000-0000-0000-0000-0000000061a1', 'inbound', 'customer', '00000000-0000-0000-0000-0000000062a2', 'text', 'kkkkkk o Bruno de novo');
do $$ begin
  assert conv_private.ai_trigger('00000000-0000-0000-0000-0000000064a1')->>'reason' = 'spontaneous_tennis', 'risada no grupo do campeonato chama o João';
  assert conv_private.ai_trigger('00000000-0000-0000-0000-0000000064a2')->>'reason' = 'no_trigger', 'no grupo de sócios, só papo de jogo';
end $$;

-- A brincadeira do golpe de estado (30/10): 😆 e o nome do João sem @ também chamam, no grupo do campeonato; no de sócios, não.
update conv_private.joao_spontaneous_window set last_trigger_at = null;
update public.conv_ai_sessions set started_at = now() - interval '5 minutes';   -- sem "rajada" do mesmo solicitante
insert into public.conv_messages (id, conversation_id, direction, origin, sender_contact_id, kind, body) values
  ('00000000-0000-0000-0000-0000000064b1', '00000000-0000-0000-0000-0000000061a2', 'inbound', 'customer', '00000000-0000-0000-0000-0000000062a1', 'text', 'dei um golpe de estado e assumi o posto😆😆'),
  ('00000000-0000-0000-0000-0000000064b2', '00000000-0000-0000-0000-0000000061a2', 'inbound', 'customer', '00000000-0000-0000-0000-0000000062a2', 'text', 'e o João, apoia a nova administração?'),
  ('00000000-0000-0000-0000-0000000064b3', '00000000-0000-0000-0000-0000000061a1', 'inbound', 'customer', '00000000-0000-0000-0000-0000000062a2', 'text', 'golpe de estado 😆😆'),
  ('00000000-0000-0000-0000-0000000064b4', '00000000-0000-0000-0000-0000000061a2', 'inbound', 'customer', '00000000-0000-0000-0000-0000000062a2', 'text', 'joaozinho de deus, vou dormir');
do $$ begin
  assert conv_private.ai_trigger('00000000-0000-0000-0000-0000000064b1')->>'reason' = 'spontaneous_tennis', '😆 no grupo do campeonato chama o João';
  update conv_private.joao_spontaneous_window set last_trigger_at = null;
  assert conv_private.ai_trigger('00000000-0000-0000-0000-0000000064b2')->>'reason' = 'spontaneous_tennis', 'o nome dele sem @ chama o João';
  update conv_private.joao_spontaneous_window set last_trigger_at = null;
  assert conv_private.ai_trigger('00000000-0000-0000-0000-0000000064b3')->>'reason' = 'no_trigger', 'no grupo de sócios, 😆 não é deixa';
  assert conv_private.ai_trigger('00000000-0000-0000-0000-0000000064b4')->>'reason' = 'no_trigger', '"joaozinho" não é o nome dele';
end $$;

-- O papo da piada (30/10): hora, a quem respondeu e o tipo da mídia; no grupo do campeonato vai além das 12 mensagens.
insert into public.conv_messages (conversation_id, direction, origin, sender_contact_id, kind, body, reply_preview, created_at)
select '00000000-0000-0000-0000-0000000061a2', 'inbound', 'customer', '00000000-0000-0000-0000-0000000062a2', 'text', 'papo ' || i, null, now() - make_interval(mins => 100 - i)
from generate_series(1, 20) i;
insert into public.conv_messages (conversation_id, direction, origin, sender_contact_id, kind, body, reply_preview) values
  ('00000000-0000-0000-0000-0000000061a2', 'inbound', 'customer', '00000000-0000-0000-0000-0000000062a1', 'image', 'Só rapazes', null),
  ('00000000-0000-0000-0000-0000000061a2', 'inbound', 'customer', '00000000-0000-0000-0000-0000000062a1', 'sticker', null, null),
  ('00000000-0000-0000-0000-0000000061a2', 'inbound', 'customer', '00000000-0000-0000-0000-0000000062a2', 'text', 'dei um golpe de estado', 'K-Sauna?');
select fab.como('service_role');
do $$ declare g jsonb := public.conv_svc_ai_group_context('00000000-0000-0000-0000-0000000063a1'); t text := g::text; begin
  assert jsonb_array_length(g) > 12, 'grupo do campeonato lê mais que 12 mensagens: ' || jsonb_array_length(g);
  assert t like '%"body": "[foto] Só rapazes"%', 'foto com legenda: ' || t;
  assert t like '%"body": "[figurinha]"%', 'figurinha sem legenda não chega vazia';
  assert t like '%"reply_to": "K-Sauna?"%', 'a quem respondeu';
  assert (g->-1->>'at') ~ '^\d{2}:\d{2}$', 'hora da mensagem: ' || (g->-1)::text;
  assert t not like '%created_at%', 'sem carimbo cru';
  assert jsonb_array_length(public.conv_svc_ai_group_context('00000000-0000-0000-0000-0000000063a2')) <= 12, 'grupo de sócios segue com 12';
end $$;
select fab.dono();

select fab.espera_erro($$select public.conv_svc_ai_group_championship(gen_random_uuid())$$, 'permission denied') from (select fab.como('authenticated', (select carlos from u))) x;
