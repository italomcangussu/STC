-- Pix de inscrição lançado no caixa também paga quem foi inscrito direto pelo painel (Henrique, 30/10).
-- Mario Rego e Davi Arcelino foram inscritos no AUGE OPEN pelo painel em 28/10, sem pré-inscrição do João. O Henrique
-- lançou "Inscrições AUGE OPEN de Mario Rego e Davi Arcelino" (R$ 260), mas a confirmação só procurava pré-inscrições
-- (championship_signups 'pre'): deu NO_MATCH e os dois seguiram "aguardando Pix", sem lugar nenhum para marcar o pagamento.
-- Agora a inscrição do painel que ainda não tem pagamento entra na mesma conta (nome na descrição, valor = preço × atletas)
-- e ganha uma linha confirmada em championship_signups ligada ao lançamento, que é o que a lista lê como "pago".
-- Inscrição do painel sem telefone válido (convidado sem cadastro) não tem como virar linha: segue como antes.

create or replace function conv_private.champ_confirm_from_entry(p_entry uuid, p_admin uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  e public.fin_entries%rowtype; v_cat text; v_text text; c public.championships%rowtype; x public.championship_signups%rowtype;
  v_ids uuid[]; v_names jsonb; v_price bigint; v_reg uuid; v_ok text[] := '{}'; v_wait text[] := '{}';
  v_panel jsonb; p jsonb; v_count int;
begin
  select * into e from public.fin_entries where id = p_entry;
  if not found or e.kind <> 'revenue' or e.status <> 'paid' then return null; end if;
  select k.name into v_cat from public.fin_categories k where k.id = e.category_id;
  v_text := conv_private.champ_name_key(coalesce(v_cat, '') || ' ' || coalesce(e.description, ''));
  select * into c from public.championships ch
   where coalesce((ch.joao_info->>'enabled')::boolean, false) and ch.status in ('draft', 'ongoing')
     and (conv_private.champ_name_key(v_cat) = conv_private.champ_name_key(ch.joao_info->>'category_name')
          or (v_text like '%inscri%' and (position(conv_private.champ_name_key(ch.name) in v_text) > 0
              or (nullif(ch.joao_info->'title'->>0, '') is not null and position(conv_private.champ_name_key(ch.joao_info->'title'->>0) in v_text) > 0))))
   order by ch.start_date limit 1;
  if not found then return null; end if;
  if exists (select 1 from public.championship_signups s where s.fin_entry_id = e.id) then
    return jsonb_build_object('championship', c.name, 'reason', 'ALREADY');
  end if;

  select array_agg(s.id order by s.created_at), jsonb_agg(s.full_name order by s.created_at) into v_ids, v_names
  from public.championship_signups s
  where s.championship_id = c.id and s.status = 'pre' and conv_private.champ_name_in_text(s.full_name, e.description);

  -- Inscritos pelo painel, ainda sem pagamento: já estão na chave, só falta ligar ao Pix.
  select jsonb_agg(jsonb_build_object('reg', r.id, 'class', r.class, 'name', coalesce(r.guest_name, pr.name), 'profile', r.user_id,
           'phone', pr.phone, 'size', coalesce(r.shirt_size, 'G'), 'city', r.guest_cidade) order by r.created_at)
    into v_panel
  from public.championship_registrations r left join public.profiles pr on pr.id = r.user_id
  where r.championship_id = c.id
    and not exists (select 1 from public.championship_signups s where s.registration_id = r.id and s.status <> 'canceled')
    and conv_private.phone_key(pr.phone) is not null and pr.phone ~ '^[1-9][0-9]{9,14}$'
    and length(trim(coalesce(r.guest_name, pr.name))) between 5 and 120
    and conv_private.champ_name_in_text(coalesce(r.guest_name, pr.name), e.description);

  v_count := coalesce(cardinality(v_ids), 0) + coalesce(jsonb_array_length(v_panel), 0);
  if v_count = 0 then return jsonb_build_object('championship', c.name, 'reason', 'NO_MATCH'); end if;
  v_names := coalesce(v_names, '[]'::jsonb) || coalesce((select jsonb_agg(q->'name') from jsonb_array_elements(v_panel) q), '[]'::jsonb);
  v_price := coalesce((c.joao_info->>'price_cents')::bigint, 0);
  if e.amount_cents <> v_price * v_count then
    return jsonb_build_object('championship', c.name, 'reason', 'AMOUNT', 'names', v_names, 'amount_cents', e.amount_cents,
      'expected_cents', v_price * v_count);
  end if;

  -- Como no comprovante do atleta: entra na classe; com a classe cheia, fica pago na lista de espera.
  for x in select * from public.championship_signups s where s.id = any(coalesce(v_ids, '{}')) order by s.created_at for update loop
    perform pg_advisory_xact_lock(hashtext(x.championship_id::text || x.class));
    if conv_private.champ_confirmed(x.championship_id, x.class) < coalesce((c.joao_info->>'max_per_class')::int, 16) then
      insert into public.championship_registrations (championship_id, participant_type, user_id, guest_name, class, shirt_size, registered_by, guest_cidade)
      values (x.championship_id, case when x.profile_id is null then 'guest' else 'socio' end, x.profile_id,
        case when x.profile_id is null then x.full_name end, x.class, x.shirt_size, p_admin, x.city)
      returning id into v_reg;
      update public.championship_signups set status = 'confirmed', registration_id = v_reg, paid_at = now(), fin_entry_id = e.id, updated_at = now() where id = x.id;
      v_ok := v_ok || x.full_name;
    else
      update public.championship_signups set status = 'waitlist', paid_at = now(), fin_entry_id = e.id, updated_at = now() where id = x.id;
      v_wait := v_wait || x.full_name;
    end if;
  end loop;

  -- Do painel: a vaga já é dele; a linha confirmada só registra o pagamento.
  for p in select * from jsonb_array_elements(coalesce(v_panel, '[]'::jsonb)) loop
    begin
      insert into public.championship_signups (championship_id, class, full_name, name_key, phone, phone_key, city, shirt_size, profile_id,
        status, amount_cents, paid_at, fin_entry_id, registration_id)
      values (c.id, p->>'class', trim(p->>'name'), conv_private.champ_name_key(p->>'name'), p->>'phone', conv_private.phone_key(p->>'phone'),
        nullif(trim(coalesce(p->>'city', '')), ''), p->>'size', (p->>'profile')::uuid, 'confirmed', v_price, now(), e.id, (p->>'reg')::uuid);
      v_ok := v_ok || (p->>'name');
    exception when unique_violation then
      -- Já há outra pré-inscrição com o mesmo nome ou telefone: não adivinha, fica de fora.
      null;
    end;
  end loop;
  if cardinality(v_ok) + cardinality(v_wait) = 0 then return jsonb_build_object('championship', c.name, 'reason', 'NO_MATCH'); end if;
  return jsonb_build_object('championship', c.name, 'confirmed', to_jsonb(v_ok), 'waitlist', to_jsonb(v_wait));
end $$;
revoke all on function conv_private.champ_confirm_from_entry(uuid, uuid) from public, anon, authenticated;

-- Receitas de inscrição já lançadas desde a abertura do campeonato que não pagaram ninguém (o Pix de Mario e Davi).
do $$ declare e record; v_admin uuid := (select finance_admin_profile_id from public.fin_settings where id); begin
  for e in select f.id from public.fin_entries f
           where f.kind = 'revenue' and f.status = 'paid' and f.created_at >= '2026-10-26'
             and not exists (select 1 from public.championship_signups s where s.fin_entry_id = f.id)
           order by f.created_at loop
    perform conv_private.champ_confirm_from_entry(e.id, v_admin);
  end loop;
end $$;

-- Rollback: reaplicar conv_private.champ_confirm_from_entry de 20261030160000_joao_inscricao_pelo_caixa.sql
-- (as linhas criadas aqui têm registration_id de inscrição do painel e fin_entry_id; apagar só se quiser desfazer o pago).
