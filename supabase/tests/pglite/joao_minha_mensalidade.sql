-- Bruno (04/11): "Valor?" depois de "Qual o pix da mensalidade?". O João precisa ver a mensalidade de quem fala.
create temp table u as select fab.usuario('adm-mm@x.com') as adm, fab.usuario('bruno-mm@x.com') as bru, fab.usuario('outro-mm@x.com') as out;
grant select on u to service_role, authenticated;
insert into public.profiles (id, name, role) select adm, 'Henrique Coelho', 'admin' from u on conflict (id) do update set name = excluded.name, role = excluded.role;
insert into public.profiles (id, name, role, is_active) select bru, 'Bruno Vaz', 'socio', true from u on conflict (id) do update set name = excluded.name, role = excluded.role, is_active = true;
insert into public.profiles (id, name, role, is_active) select out, 'Outro Sócio', 'socio', true from u on conflict (id) do update set name = excluded.name, role = excluded.role, is_active = true;
insert into public.fin_settings (id, payee_names) values (true, array['Sobral Tenis Clube']) on conflict (id) do update set payee_names = excluded.payee_names;
update public.fin_settings set finance_admin_profile_id = (select adm from u);
insert into public.conv_contacts (id, phone, name, profile_id, link_status) select '00000000-0000-0000-0000-00000000c701', '558800000701', 'Bruno', bru, 'linked' from u;
insert into public.conv_conversations (id, kind, contact_id) values ('00000000-0000-0000-0000-00000000d701', 'direct', '00000000-0000-0000-0000-00000000c701');
insert into public.conv_ai_sessions (id, conversation_id, requester_contact_id, expires_at) values
  ('00000000-0000-0000-0000-00000000e701', '00000000-0000-0000-0000-00000000d701', '00000000-0000-0000-0000-00000000c701', now() + interval '1 hour');

create temp table mes as select date_trunc('month', now() at time zone 'America/Fortaleza')::date m, (now() at time zone 'America/Fortaleza')::date hoje;
grant select on mes to service_role, authenticated;

select fab.como('authenticated', (select adm from u));
create temp table plano as select public.fin_create_member_plan(gen_random_uuid(), jsonb_build_object('profile_id', (select bru from u), 'start_on', (select m from mes), 'amount_cents', 32000)) r
  union all select public.fin_create_member_plan(gen_random_uuid(), jsonb_build_object('profile_id', (select out from u), 'start_on', (select m from mes), 'amount_cents', 50000));
select public.fin_generate_member_charges(gen_random_uuid(), (r->>'id')::uuid, (select hoje from mes)) from plano;
select fab.dono();

select fab.como('service_role');
do $$
declare r jsonb := public.conv_svc_ai_my_membership('00000000-0000-0000-0000-00000000e701');
begin
  assert jsonb_array_length(r) = 1, 'só a mensalidade do próprio Bruno: ' || r::text;
  assert (r->0->>'to_pay_cents')::bigint = 32000, 'valor a pagar 320';
  assert r->0->>'status' = 'open', 'em aberto';
  assert public.conv_svc_ai_my_membership(gen_random_uuid()) = '[]'::jsonb, 'sessão desconhecida: nada';
end $$;
select fab.dono();

-- Grupo: nada da mensalidade de ninguém.
insert into public.conv_groups (id, group_jid, name, status, ai_enabled, last_seen_at) values
  ('00000000-0000-0000-0000-00000000a702', '120363000000000702@g.us', 'Sócios STC', 'allowed', true, now());
insert into public.conv_conversations (id, kind, group_id, ai_status) values ('00000000-0000-0000-0000-00000000d702', 'group', '00000000-0000-0000-0000-00000000a702', 'ai');
insert into public.conv_ai_sessions (id, conversation_id, requester_contact_id, expires_at) values
  ('00000000-0000-0000-0000-00000000e702', '00000000-0000-0000-0000-00000000d702', '00000000-0000-0000-0000-00000000c701', now() + interval '1 hour');
select fab.como('service_role');
do $$ begin
  assert public.conv_svc_ai_my_membership('00000000-0000-0000-0000-00000000e702') = '[]'::jsonb, 'grupo não expõe mensalidade';
end $$;
select fab.dono();

-- Paga: some das abertas e fica como a última paga, com nada a pagar.
update public.fin_member_charges set status = 'paid' where profile_id = (select bru from u);
select fab.como('service_role');
do $$
declare r jsonb := public.conv_svc_ai_my_membership('00000000-0000-0000-0000-00000000e701');
begin
  assert jsonb_array_length(r) = 1 and r->0->>'status' = 'paid' and (r->0->>'to_pay_cents')::bigint = 0, 'última paga: ' || r::text;
end $$;
select fab.dono();
