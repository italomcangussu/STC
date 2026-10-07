-- Onda 4 do assessor: resumo da manhã (08h00 de Fortaleza) para administradores escolhidos. Dados lidos COMO o
-- administrador (mesmas funções do painel), texto montado no servidor (`_shared/adminBriefing.ts`), enviado na
-- conversa direta dele com o João (a resposta dele cai no mesmo fio). Só quem está na tabela e segue sendo
-- administrador ativo recebe; opt-out do contato é respeitado.
create table if not exists public.conv_admin_briefing_recipients (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.conv_admin_briefing_recipients enable row level security;
revoke all on public.conv_admin_briefing_recipients from public, anon, authenticated;
grant all on public.conv_admin_briefing_recipients to service_role;
drop policy if exists briefing_recipients_admin on public.conv_admin_briefing_recipients;

-- Hermeson e Henrique (decisão do clube, 2026-10-07). Só entram se existirem como administradores ativos.
insert into public.conv_admin_briefing_recipients(profile_id)
select p.id from public.profiles p
where p.role::text = 'admin' and coalesce(p.is_active, true)
  and (fin_private.fold_text(p.name) like 'hermeson veras%' or fin_private.fold_text(p.name) like 'henrique coelho%')
on conflict do nothing;

create or replace function conv_private.admin_briefing_targets() returns table(profile_id uuid, name text, conversation_id uuid)
language sql stable security definer set search_path = '' as $$
  select r.profile_id, p.name, cv.id
  from public.conv_admin_briefing_recipients r
  join public.profiles p on p.id = r.profile_id and p.role::text = 'admin' and coalesce(p.is_active, true)
  join public.conv_contacts c on c.profile_id = r.profile_id and c.merged_into is null and c.link_status in ('linked', 'manual') and not c.opt_out
  join lateral (select v.id from public.conv_conversations v where v.contact_id = c.id and v.kind = 'direct' and v.merged_into is null
                order by v.last_message_at desc nulls last limit 1) cv on true
  where r.enabled
$$;

create or replace function public.conv_svc_admin_briefing_targets() returns table(profile_id uuid, name text, conversation_id uuid)
language sql stable security definer set search_path = '' as $$ select * from conv_private.admin_briefing_targets() $$;

create or replace function conv_private.admin_briefing_data(p_profile uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_prev_claims text; v_prev_sub text; v_err text; v_out jsonb;
  v_today date := (now() at time zone 'America/Fortaleza')::date;
begin
  if not exists (select 1 from conv_private.admin_briefing_targets() t where t.profile_id = p_profile) then
    return conv_private.vfail('NOT_A_RECIPIENT', 'Esse administrador não recebe o resumo.');
  end if;
  v_prev_claims := current_setting('request.jwt.claims', true);
  v_prev_sub := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_profile, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_profile::text, true);
  begin
    select jsonb_build_object(
      'today', v_today,
      'accounts', coalesce((select jsonb_agg(jsonb_build_object('name', b.name, 'balance_cents', b.balance_cents) order by b.name)
                            from public.fin_account_balances(v_today) b where b.active), '[]'::jsonb),
      'total_cents', coalesce((select sum(b.balance_cents) from public.fin_account_balances(v_today) b where b.active), 0),
      'yesterday', (select jsonb_build_object('inflow_cents', coalesce(sum(inflow_cents), 0), 'outflow_cents', coalesce(sum(outflow_cents), 0))
                    from public.fin_cash_flow(v_today - 1, v_today - 1, 'day', null)),
      'month', (select jsonb_build_object('inflow_cents', coalesce(sum(inflow_cents), 0), 'outflow_cents', coalesce(sum(outflow_cents), 0), 'net_cents', coalesce(sum(net_cents), 0))
                from public.fin_cash_flow(date_trunc('month', v_today)::date, v_today, 'month', null)),
      'receivables', (select to_jsonb(r) from public.fin_receivables_summary(v_today) r),
      'payables', (select to_jsonb(p) from public.fin_payables_summary(v_today) p),
      'receipts', (select jsonb_build_object('total', coalesce(max(total_count), 0), 'oldest_at', min(created_at)) from public.fin_receipt_queue('pending', 100, 0)),
      'access', (select jsonb_build_object('total', count(*)) from public.access_requests where status = 'pending'),
      'signatures', coalesce((select jsonb_agg(jsonb_build_object('title', title, 'recipients', recipients, 'signed', signed, 'due_at', due_at) order by published_at desc)
                              from public.sig_documents_overview where status = 'published' and signed < recipients), '[]'::jsonb),
      'reservations', (select jsonb_build_object('total', coalesce(sum(n), 0), 'by_type', coalesce(jsonb_object_agg(t, n) filter (where t is not null), '{}'::jsonb))
                       from (select r.type t, count(*) n from public.reservations r
                             where r.date = v_today and coalesce(r.status::text, 'active') = 'active' group by r.type) x))
    into v_out;
  exception when others then
    v_err := sqlerrm;
  end;
  perform set_config('request.jwt.claims', coalesce(v_prev_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_prev_sub, ''), true);
  if v_err is not null then return conv_private.vfail('BRIEFING_FAILED', 'Não consegui montar o resumo agora.'); end if;
  return jsonb_build_object('ok', true, 'data', v_out);
end $$;

create or replace function public.conv_svc_admin_briefing_data(p_profile uuid) returns jsonb
language sql security definer set search_path = '' as $$ select conv_private.admin_briefing_data(p_profile) $$;

revoke all on function conv_private.admin_briefing_targets() from public, anon, authenticated;
revoke all on function conv_private.admin_briefing_data(uuid) from public, anon, authenticated;
revoke all on function public.conv_svc_admin_briefing_targets() from public, anon, authenticated;
revoke all on function public.conv_svc_admin_briefing_data(uuid) from public, anon, authenticated;
grant execute on function public.conv_svc_admin_briefing_targets() to service_role;
grant execute on function public.conv_svc_admin_briefing_data(uuid) to service_role;
