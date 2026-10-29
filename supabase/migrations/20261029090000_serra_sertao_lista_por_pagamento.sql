-- Lista do administrador pelo pagamento (Hermeson, 28/10). Quem ele põe direto no painel, sem Pix, saía para o João como
-- "inscrito confirmado" e entrava nas listas como pago (Mario, Davi). Cada inscrito do painel passa a dizer como entrou:
--   paid   = inscrição do WhatsApp confirmada com receita lançada (Pix conferido);
--   exempt = confirmada sem receita (patrocinador/isento, decisão da organização);
--   panel  = só no painel, sem pagamento registrado.
-- O resto da função é o mesmo de 20261026170000.

create or replace function public.conv_svc_ai_championship_context(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_contact uuid; v_phone text; v_pk text; v_admin uuid; fs public.fin_settings%rowtype; c public.championships%rowtype; v_list jsonb := '[]'::jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  select s.requester_contact_id, ct.phone into v_contact, v_phone
  from public.conv_ai_sessions s join public.conv_contacts ct on ct.id = s.requester_contact_id where s.id = p_session;
  if v_contact is null then return null; end if;
  v_pk := conv_private.phone_key(v_phone);
  v_admin := conv_private.ai_admin_requester(p_session);
  select * into fs from public.fin_settings where id;
  for c in select * from public.championships x
           where coalesce((x.joao_info->>'enabled')::boolean, false) and x.status in ('draft', 'ongoing') order by x.start_date loop
    v_list := v_list || jsonb_build_object(
      'id', c.id, 'name', c.name, 'title', coalesce(c.joao_info->'title', '[]'::jsonb), 'start_date', c.start_date, 'end_date', c.end_date, 'status', c.status,
      'info', c.joao_info->>'info', 'price_cents', (c.joao_info->>'price_cents')::bigint, 'shirt_sizes', c.joao_info->'shirt_sizes',
      'max_per_class', coalesce((c.joao_info->>'max_per_class')::int, 16), 'deadline', c.joao_info->>'deadline',
      'registration_open', conv_private.champ_open(c.id), 'shirt_image', case when c.joao_info->'shirt_image'->>'path' is not null then c.joao_info->'shirt_image' end,
      'classes', conv_private.champ_classes(c.id),
      'mine', (select coalesce(jsonb_agg(conv_private.champ_signup_json(s) order by s.created_at), '[]'::jsonb)
               from public.championship_signups s
               where s.championship_id = c.id and s.status <> 'canceled' and (s.registered_by_contact_id = v_contact or s.phone_key = v_pk)),
      'admin', case when v_admin is null then null else jsonb_build_object(
        'signups', (select coalesce(jsonb_agg(conv_private.champ_signup_json(s) order by s.class, s.status, s.created_at), '[]'::jsonb)
                    from public.championship_signups s where s.championship_id = c.id and s.status <> 'canceled'),
        'registered', (select coalesce(jsonb_agg(jsonb_build_object('class', r.class, 'name', coalesce(r.guest_name, p.name), 'seed', r.seed_number,
                           'pay', coalesce((select case when bool_or(s.fin_entry_id is not null) then 'paid' else 'exempt' end
                                   from public.championship_signups s where s.registration_id = r.id and s.status = 'confirmed' having count(*) > 0), 'panel'))
                         order by r.class, r.seed_number nulls last, coalesce(r.guest_name, p.name)), '[]'::jsonb)
                       from public.championship_registrations r left join public.profiles p on p.id = r.user_id where r.championship_id = c.id)) end);
  end loop;
  if jsonb_array_length(v_list) = 0 then return null; end if;
  return jsonb_build_object('requester_phone', conv_private.phone_local(v_phone), 'is_admin', v_admin is not null,
    'pix_key', fs.pix_key, 'payee', coalesce(fs.payee_names[1], 'Sobral Tênis Clube'), 'championships', v_list);
end $$;
revoke all on function public.conv_svc_ai_championship_context(uuid) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_championship_context(uuid) to service_role;

-- Rollback: reaplicar a função de 20261026170000_serra_sertao_cartao.sql.
