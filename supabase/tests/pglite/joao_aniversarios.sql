-- Aniversários: quem faz anos hoje aparece para o João (29/02 vira 28/02 em ano não bissexto), data inválida não entra
-- e só administrador grava pelo WhatsApp.
create temp table u as select fab.usuario('aniver@x.com', '{"nome":"Ana Aniversário"}') as ana;
insert into public.profiles (id, name, role, phone, is_active, birth_day, birth_month)
select ana, 'Ana Aniversário', 'socio', '(88) 99123-4567', true, 29, 2 from u;
grant select on u to service_role, authenticated;
insert into public.conv_ai_memory_candidates (subject_name, kind, content, confidence, status)
values ('Ana Aniversário', 'confirmed_fact', 'É dentista.', 1, 'approved');

select fab.como('service_role');
do $$
declare r jsonb;
begin
  r := public.conv_svc_birthdays_today('2027-02-28');
  assert jsonb_array_length(r) = 1, 'em 2027 o 29/02 é comemorado em 28/02';
  assert r->0->>'name' = 'Ana Aniversário', 'devolve o nome';
  assert r->0->>'phone' = '5588991234567', 'telefone normalizado';
  assert r->0->>'direct_conversation_id' is not null, 'abre a conversa privada';
  assert r->0->'memories' ? 'É dentista.', 'leva as memórias aprovadas';
  assert jsonb_array_length(public.conv_svc_birthdays_today('2028-02-28')) = 0, 'em ano bissexto não antecipa';
  assert jsonb_array_length(public.conv_svc_birthdays_today('2028-02-29')) = 1, 'em ano bissexto é no dia';
  r := public.conv_svc_ai_admin_birthday_set(gen_random_uuid(), jsonb_build_object('profile_id', (select ana from u), 'day', 1, 'month', 3));
  assert (r->>'ok')::boolean is not true, 'sessão sem administrador não grava';
end $$;

select fab.dono();
update public.profiles set is_active = false where id = (select ana from u);
select fab.como('service_role');
do $$ begin
  assert jsonb_array_length(public.conv_svc_birthdays_today('2027-02-28')) = 0, 'sócio inativo não recebe parabéns';
end $$;

select fab.dono();
select fab.espera_erro($$update public.profiles set birth_day = 31, birth_month = 4 where id = (select ana from u)$$, 'profiles_birthday_check');
select fab.espera_erro($$update public.profiles set birth_day = 10, birth_month = null where id = (select ana from u)$$, 'profiles_birthday_check');
select fab.espera_erro($$select public.conv_svc_birthdays_today(current_date)$$, 'permission denied') from (select fab.como('authenticated', (select ana from u))) x;
