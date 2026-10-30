-- Pix de inscrição lançado pelo administrador no caixa confirma a pré-inscrição (Hermeson/Henrique, 30/10).
-- O Henrique lançou "Inscrição AUGE OPEN — Juarez Enderson e Heitor Freitas" (R$ 260) e os dois continuaram "aguardando Pix".

create temp table u as select fab.usuario('henrique@x.com') as adm;
grant select on u to service_role, authenticated;
insert into public.profiles (id, name, role) select adm, 'Henrique Coelho', 'admin' from u on conflict (id) do update set name = excluded.name, role = excluded.role;
insert into public.fin_settings (id, payee_names) values (true, array['Sobral Tenis Clube']) on conflict (id) do update set payee_names = excluded.payee_names;
update public.fin_settings set finance_admin_profile_id = (select adm from u);
insert into public.fin_accounts (id, name, kind, active, is_default_receipts, opening_date) values ('00000000-0000-0000-0000-0000000000a1', 'Cora', 'bank', true, true, '2026-01-01');
insert into public.fin_categories (id, name, kind, dre_line, active, system_key) values
  ('00000000-0000-0000-0000-0000000000b7', 'Receitas do clube', 'revenue', 'revenue', true, 'group.revenue') on conflict do nothing;
insert into public.fin_categories (id, name, kind, dre_line, active, parent_id) values
  ('00000000-0000-0000-0000-0000000000b9', 'AUGE OPEN', 'revenue', 'revenue', true, '00000000-0000-0000-0000-0000000000b7'),
  ('00000000-0000-0000-0000-0000000000ba', 'Aluguel de quadra', 'revenue', 'revenue', true, '00000000-0000-0000-0000-0000000000b7');

insert into public.championships (id, name, status, format, start_date, end_date, slug, edition_year, allow_guests, registration_open, joao_info)
values ('00000000-0000-0000-0000-00000000f001', 'Serra e Sertão 2026', 'draft', 'mata-mata', '2026-11-27', '2026-11-29', 'serra-teste-caixa', 2026, true, true,
  jsonb_build_object('enabled', true, 'price_cents', 13000, 'shirt_sizes', jsonb_build_array('P', 'M', 'G', 'GG'), 'max_per_class', 16,
    'deadline', '2099-12-31', 'category_name', 'Inscrição Serra e Sertão', 'title', jsonb_build_array('AUGE OPEN', '3ª Etapa do Circuito')));
insert into public.championship_signups (championship_id, class, full_name, name_key, phone, phone_key, shirt_size, status, amount_cents) values
  ('00000000-0000-0000-0000-00000000f001', '5ª Classe', 'Juarez Enderson Magalhães Amaral', 'juarez enderson magalhaes amaral', '5588900000001', '88900000001', 'M', 'pre', 13000),
  ('00000000-0000-0000-0000-00000000f001', '5ª Classe', 'Heitor Freitas Portela', 'heitor freitas portela', '5588900000002', '88900000002', 'M', 'pre', 13000),
  ('00000000-0000-0000-0000-00000000f001', '4ª Classe', 'Philippe Ramos de Aguiar', 'philippe ramos de aguiar', '5588900000003', '88900000003', 'M', 'pre', 13000),
  ('00000000-0000-0000-0000-00000000f001', '4ª Classe', 'Heitor Lima Souza', 'heitor lima souza', '5588900000004', '88900000004', 'G', 'pre', 13000);

insert into public.conv_contacts (id, phone, name, profile_id, link_status) select '00000000-0000-0000-0000-00000000c901', '558800000901', 'Henrique', adm, 'linked' from u;
insert into public.conv_conversations (id, kind, contact_id) values ('00000000-0000-0000-0000-00000000d901', 'direct', '00000000-0000-0000-0000-00000000c901');
insert into public.conv_ai_sessions (id, conversation_id, requester_contact_id, expires_at) values
  ('00000000-0000-0000-0000-00000000e901', '00000000-0000-0000-0000-00000000d901', '00000000-0000-0000-0000-00000000c901', now() + interval '1 day');

-- Propõe e confirma uma receita paga, como o João faz quando o Henrique diz "confirmo".
create function pg_temp.lancar_e_confirmar(p_desc text, p_cents bigint, p_cat text, p_msg uuid) returns jsonb language plpgsql as $$
declare r jsonb; begin
  perform fab.como('service_role');
  r := public.conv_svc_ai_admin_finance_propose('00000000-0000-0000-0000-00000000e901', jsonb_build_object('action', 'fin_entry_create',
    'entry_kind', 'revenue', 'entry_status', 'paid', 'description', p_desc, 'amount_cents', p_cents, 'category_name', p_cat, 'account_name', 'Cora'));
  if not coalesce((r->>'ok')::boolean, false) then return r; end if;
  perform fab.dono();
  update public.conv_booking_proposals set created_at = now() - interval '1 minute' where id = (r->>'proposal_id')::uuid;
  insert into public.conv_messages (id, conversation_id, direction, kind, status, origin, sender_contact_id, body)
  values (p_msg, '00000000-0000-0000-0000-00000000d901', 'inbound', 'text', 'received', 'customer', '00000000-0000-0000-0000-00000000c901', 'confirmo');
  perform fab.como('service_role');
  return public.conv_svc_ai_confirm((r->>'proposal_id')::uuid, p_msg);
end $$;
grant execute on function pg_temp.lancar_e_confirmar(text, bigint, text, uuid) to service_role;

-- 1) Dois atletas num Pix só, nomes curtos (sem o sobrenome todo): os dois ficam pagos e entram na chave.
do $$ declare r jsonb := pg_temp.lancar_e_confirmar('Inscrição AUGE OPEN — Juarez Enderson e Heitor Freitas', 26000, 'AUGE OPEN', '00000000-0000-0000-0000-0000000009a1'); begin
  assert (r->>'ok')::boolean, 'lançou: ' || r::text;
  assert r->'summary'->'championship'->'confirmed' = '["Juarez Enderson Magalhães Amaral", "Heitor Freitas Portela"]'::jsonb, 'confirmados: ' || r::text;
end $$;
select fab.dono();
do $$ begin
  assert (select count(*) from public.championship_signups where status = 'confirmed' and fin_entry_id is not null and registration_id is not null and paid_at is not null) = 2, 'pagos, com lançamento e na chave';
  assert (select shirt_size from public.championship_registrations where guest_name = 'Heitor Freitas Portela') = 'M', 'camisa vai para o painel';
  assert (select status from public.championship_signups where full_name = 'Heitor Lima Souza') = 'pre', 'o outro Heitor segue esperando';
end $$;

-- 2) Valor que não fecha com o número de atletas: lança no caixa, mas não confirma ninguém e avisa.
do $$ declare r jsonb := pg_temp.lancar_e_confirmar('Inscrição AUGE OPEN — Philippe Ramos', 26000, 'AUGE OPEN', '00000000-0000-0000-0000-0000000009a2'); begin
  assert (r->>'ok')::boolean, 'lançou: ' || r::text;
  assert r->'summary'->'championship'->>'reason' = 'AMOUNT' and r->'summary'->'championship'->'names' = '["Philippe Ramos de Aguiar"]'::jsonb, 'valor diferente: ' || r::text;
end $$;
select fab.dono();
do $$ begin assert (select status from public.championship_signups where full_name = 'Philippe Ramos de Aguiar') = 'pre', 'não confirmou'; end $$;

-- 3) Pix de quem não tem pré-inscrição: lança e avisa que não achou.
do $$ declare r jsonb := pg_temp.lancar_e_confirmar('Inscrição AUGE OPEN — Tiago Ferreira Gomes', 13000, 'AUGE OPEN', '00000000-0000-0000-0000-0000000009a3'); begin
  assert (r->>'ok')::boolean and r->'summary'->'championship'->>'reason' = 'NO_MATCH', 'sem pré-inscrição: ' || r::text;
end $$;

-- 4) Receita que não é do campeonato: nada muda (nem com nome de atleta na descrição).
do $$ declare r jsonb := pg_temp.lancar_e_confirmar('Aluguel da quadra — Philippe Ramos', 13000, 'Aluguel de quadra', '00000000-0000-0000-0000-0000000009a4'); begin
  assert (r->>'ok')::boolean and r->'summary'->'championship' is null, 'fora do campeonato: ' || r::text;
end $$;
select fab.dono();
do $$ begin assert (select status from public.championship_signups where full_name = 'Philippe Ramos de Aguiar') = 'pre', 'aluguel não confirma inscrição'; end $$;

-- 5) Pela categoria do campeonato também casa (sem o nome do evento na descrição).
do $$ declare r jsonb; begin
  perform fab.dono();
  insert into public.fin_categories (id, name, kind, dre_line, active, parent_id) values
    ('00000000-0000-0000-0000-0000000000bb', 'Inscrição Serra e Sertão', 'revenue', 'revenue', true, '00000000-0000-0000-0000-0000000000b7');
  r := pg_temp.lancar_e_confirmar('Philippe Ramos de Aguiar', 13000, 'Inscrição Serra e Sertão', '00000000-0000-0000-0000-0000000009a5');
  assert r->'summary'->'championship'->'confirmed' = '["Philippe Ramos de Aguiar"]'::jsonb, 'pela categoria: ' || r::text;
end $$;
