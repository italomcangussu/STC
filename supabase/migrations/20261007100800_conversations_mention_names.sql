-- Conversas · conciliar quem foi marcado numa mensagem (v1)
--
-- No WhatsApp a marcação chega como número ("@61809058967781", um LID), não como nome. Esta função concilia cada identificador com o
-- sócio do cadastro, na ordem: (1) o contato do WhatsApp com esse LID (já ligado a um sócio); (2) o TELEFONE (o do próprio
-- identificador, se parecer telefone, ou o que a UazAPI informou para esse LID no grupo), comparado ao telefone dos sócios com a mesma
-- normalização do resto do módulo (`phone_key`: DDD + últimos 8 dígitos, ignora DDI e nono dígito). Só devolve nome quando o sócio é ÚNICO e ativo;
-- ambíguo ou desconhecido volta sem nome (o agente pergunta). Também diz se o identificador é o da própria conta institucional.
--
-- Entrada: [{"id": "61809058967781", "phone": null | "5585988880077"}]. Saída: [{id, is_bot, name, profile_id, via}].
-- Só leitura; não cria contato nem altera nada. Rollback: drop das duas funções.

create function conv_private.ai_resolve_mentions(p_items jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_item jsonb; v_id text; v_phone text; v_out jsonb := '[]'::jsonb; v_bot boolean; v_ch public.conv_channel%rowtype;
  v_profiles uuid[]; v_name text; v_via text; v_contact public.conv_contacts%rowtype; v_key text;
begin
  select * into v_ch from public.conv_channel where id;
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_id := conv_private.norm_lid(v_item->>'id');
    continue when v_id is null;
    v_phone := nullif(v_item->>'phone', '');
    v_bot := v_id = any (coalesce(v_ch.bot_lids, '{}'))
             or (v_ch.bot_phone is not null and length(v_id) <= 13 and conv_private.phone_key(v_id) is not null
                 and conv_private.phone_key(v_id) = conv_private.phone_key(v_ch.bot_phone))
             or (v_ch.bot_phone is not null and v_phone is not null and conv_private.phone_key(v_phone) = conv_private.phone_key(v_ch.bot_phone));
    v_profiles := '{}'; v_name := null; v_via := null;
    if not v_bot then
      -- (1) contato do WhatsApp com esse LID, já ligado a um sócio
      select * into v_contact from public.conv_contacts where lid = v_id limit 1;
      if found and v_contact.profile_id is not null then
        select array[p.id] into v_profiles from public.profiles p
          where p.id = v_contact.profile_id and coalesce(p.is_active, true) and p.role::text in ('socio', 'admin');
        if v_profiles is not null then v_via := 'lid'; end if;
      end if;
      -- (2) telefone: o informado, o do contato com esse LID, ou o próprio identificador (se for telefone)
      if v_profiles is null or cardinality(v_profiles) = 0 then
        v_key := coalesce(conv_private.phone_key(v_phone), conv_private.phone_key(v_contact.phone),
                          case when length(v_id) <= 13 then conv_private.phone_key(v_id) end);
        if v_key is not null then
          select coalesce(array_agg(p.id), '{}') into v_profiles from public.profiles p
            where p.phone is not null and conv_private.phone_key(p.phone) = v_key and coalesce(p.is_active, true) and p.role::text in ('socio', 'admin');
          if cardinality(v_profiles) > 0 then v_via := 'phone'; end if;
        end if;
      end if;
      if v_profiles is not null and cardinality(v_profiles) = 1 then
        select p.name::text into v_name from public.profiles p where p.id = v_profiles[1];
      end if;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_id, 'is_bot', v_bot,
      'name', v_name, 'profile_id', case when v_name is not null then v_profiles[1] end, 'via', case when v_name is not null then v_via end));
  end loop;
  return v_out;
end $$;

revoke all on function conv_private.ai_resolve_mentions(jsonb) from public, anon, authenticated;
create function public.conv_svc_ai_resolve_mentions(p_items jsonb) returns jsonb
language sql stable security definer set search_path = '' as $f$ select conv_private.ai_resolve_mentions(p_items) $f$;
revoke all on function public.conv_svc_ai_resolve_mentions(jsonb) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_resolve_mentions(jsonb) to service_role;
