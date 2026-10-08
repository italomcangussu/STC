-- Aniversário dos sócios: o João dá parabéns sozinho, no grupo (com menção) e no privado, às 08h de Fortaleza.
-- A data vive no perfil só como dia e mês (a diretoria passa "Derlan 14/01", sem ano). Quem grava é um administrador
-- falando com o João no privado (conv_svc_ai_admin_birthday_set); o envio é da edge function joao-birthdays, que lê
-- quem faz aniversário hoje em conv_svc_birthdays_today. 29/02 é comemorado em 28/02 nos anos não bissextos.
alter table public.profiles
  add column if not exists birth_day smallint,
  add column if not exists birth_month smallint;

alter table public.profiles drop constraint if exists profiles_birthday_check;
alter table public.profiles add constraint profiles_birthday_check check (
  (birth_day is null and birth_month is null)
  or (birth_month is not null and birth_day is not null and birth_month between 1 and 12 and birth_day between 1 and
      case when birth_month = 2 then 29 when birth_month in (4, 6, 9, 11) then 30 else 31 end));

-- O administrador diz "o aniversário do Lucas é 08/10": grava na hora (dado de baixo risco, auditado), sem proposta.
create or replace function conv_private.ai_admin_birthday_set(p_session uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := conv_private.ai_admin_requester(p_session);
  v_profile uuid := nullif(p->>'profile_id', '')::uuid;
  v_day int := nullif(p->>'day', '')::int;
  v_month int := nullif(p->>'month', '')::int;
  pr public.profiles%rowtype;
begin
  if v_admin is null then
    return conv_private.vfail('ADMIN_ONLY_PRIVATE', 'Isso só um administrador faz, e só na conversa privada comigo.');
  end if;
  select * into pr from public.profiles where id = v_profile;
  if pr.id is null then return conv_private.vfail('MEMBER_NOT_FOUND', 'Não achei esse sócio.'); end if;
  if v_month is null or v_month < 1 or v_month > 12 or v_day is null or v_day < 1
     or v_day > (case when v_month = 2 then 29 when v_month in (4, 6, 9, 11) then 30 else 31 end) then
    return conv_private.vfail('INVALID_BIRTHDAY', 'Qual o dia e o mês do aniversário? Ex.: 14/01.');
  end if;
  update public.profiles set birth_day = v_day, birth_month = v_month where id = pr.id;
  perform conv_private.audit('ai_admin_action', 'profiles', pr.id::text,
    jsonb_build_object('birth_day', pr.birth_day, 'birth_month', pr.birth_month),
    jsonb_build_object('birth_day', v_day, 'birth_month', v_month),
    jsonb_build_object('actor', 'ai', 'source', 'whatsapp', 'action', 'adm_birthday_set'), v_admin);
  return jsonb_build_object('ok', true, 'member_name', pr.name, 'day', v_day, 'month', v_month);
end $$;

create or replace function public.conv_svc_ai_admin_birthday_set(p_session uuid, p jsonb) returns jsonb
language sql security definer set search_path = '' as $$ select conv_private.ai_admin_birthday_set(p_session, p) $$;

-- Aniversariantes ativos do dia, com a conversa privada já aberta (quem pediu opt-out fica sem o privado)
-- e as memórias aprovadas da pessoa, para o João personalizar a mensagem.
create or replace function conv_private.birthdays_today(p_today date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_out jsonb := '[]'::jsonb; pr record; v_phone text; v_contact uuid; v_conv uuid; v_opt boolean;
  v_leap boolean := (extract(year from p_today)::int % 4 = 0 and extract(year from p_today)::int % 100 <> 0)
                    or extract(year from p_today)::int % 400 = 0;
begin
  for pr in
    select p.id, p.name, p.phone from public.profiles p
    where coalesce(p.is_active, true)
      and p.birth_month = extract(month from p_today)::int
      and (p.birth_day = extract(day from p_today)::int
           or (not v_leap and p.birth_month = 2 and p.birth_day = 29 and extract(day from p_today)::int = 28))
    order by p.name
  loop
    v_phone := conv_private.phone_e164(pr.phone);
    v_conv := null; v_opt := false;
    if v_phone is not null and length(v_phone) >= 12 then
      select coalesce(bool_or(c.opt_out), false) into v_opt from public.conv_contacts c where c.phone = v_phone;
      if not v_opt then
        v_contact := conv_private.upsert_contact(v_phone, null, pr.name, true);
        v_conv := conv_private.open_direct(v_contact);
      end if;
    end if;
    v_out := v_out || jsonb_build_object(
      'profile_id', pr.id, 'name', pr.name, 'phone', case when v_phone is not null and length(v_phone) >= 12 then v_phone end,
      'direct_conversation_id', v_conv,
      'memories', coalesce((select jsonb_agg(m.content order by m.created_at)
                            from public.conv_ai_memory_candidates m
                            where m.status = 'approved' and lower(m.subject_name) = lower(pr.name)), '[]'::jsonb));
  end loop;
  return v_out;
end $$;

create or replace function public.conv_svc_birthdays_today(p_today date) returns jsonb
language sql security definer set search_path = '' as $$ select conv_private.birthdays_today(p_today) $$;

revoke all on function conv_private.ai_admin_birthday_set(uuid, jsonb), conv_private.birthdays_today(date) from public, anon, authenticated;
revoke all on function public.conv_svc_ai_admin_birthday_set(uuid, jsonb), public.conv_svc_birthdays_today(date) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_admin_birthday_set(uuid, jsonb), public.conv_svc_birthdays_today(date) to service_role;

-- 08:00 de Fortaleza (11:00 UTC), com o mesmo segredo do bom-dia. Sem pg_cron (banco de teste), não agenda.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'joao-birthdays';
    perform cron.schedule('joao-birthdays', '0 11 * * *', $cmd$
      select net.http_post(
        url := 'https://smztsayzldjmkzmufqcz.supabase.co/functions/v1/joao-birthdays',
        headers := jsonb_build_object(
          'x-joao-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'joao_daily_dispatch_secret'),
          'content-type', 'application/json'),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000);
    $cmd$);
  end if;
end $$;
