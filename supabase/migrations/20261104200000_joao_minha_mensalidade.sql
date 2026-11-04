-- Bruno (04/11): "Qual o pix da mensalidade?" → "Valor?" e o João respondeu "Ainda não registrei nada", porque o contexto
-- do financeiro só trazia pendências avulsas, nunca a mensalidade de quem fala. Esta leitura devolve as mensalidades do
-- próprio solicitante no privado (em aberto e a última paga), com o valor a pagar já com o abatimento, quando houver.
-- Só leitura; no grupo e no assessor de professor não devolve nada.

create or replace function public.conv_svc_ai_my_membership(p_session uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with quem as (
    select c.profile_id
    from public.conv_ai_sessions s
    join public.conv_conversations cv on cv.id = s.conversation_id and cv.kind = 'direct'
    join public.conv_contacts c on c.id = s.requester_contact_id and c.link_status in ('linked', 'manual')
    join public.profiles p on p.id = c.profile_id and p.role::text in ('socio', 'admin') and coalesce(p.is_active, true)
    where s.id = p_session and conv_private.contact_delegation(c.id) is null
  ), hoje as (select (now() at time zone 'America/Fortaleza')::date d),
  cobrancas as (
    select c.id, c.competence_month, c.due_date, c.status, st.total_due, fin_private.member_offset_cents(c.id) as offset_cents,
      row_number() over (partition by c.status = 'paid' order by c.competence_month desc) as n
    from public.fin_member_charges c
    join quem q on q.profile_id = c.profile_id
    cross join hoje h
    cross join lateral fin_private.charge_statement(c.id, h.d) st
    where c.charge_type = 'membership' and c.status in ('open', 'partial', 'paid')
      and c.competence_month <= date_trunc('month', h.d)::date
  )
  select coalesce(jsonb_agg(jsonb_build_object('competence_month', x.competence_month, 'due_date', x.due_date, 'status', x.status,
    'total_due_cents', x.total_due, 'offset_cents', x.offset_cents,
    'to_pay_cents', case when x.status = 'paid' then 0 else greatest(x.total_due - x.offset_cents, 0) end)
    order by x.competence_month desc), '[]'::jsonb)
  from cobrancas x where x.status <> 'paid' or x.n = 1
$$;
revoke all on function public.conv_svc_ai_my_membership(uuid) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_my_membership(uuid) to service_role;
