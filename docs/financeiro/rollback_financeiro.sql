-- ======================================================================
-- ROLLBACK DO MÓDULO FINANCEIRO (DESTRUTIVO)
--
-- NÃO é uma migration (não está em supabase/migrations) e NUNCA roda sozinho.
-- Apaga TODAS as tabelas fin_*, o schema fin_private, as funções públicas fin_*,
-- os gatilhos que o financeiro colocou em profiles e student_payments e as
-- políticas de Storage fin_*. Os dados financeiros (mensalidades, pagamentos,
-- comprovantes, lançamentos, anexos, auditoria própria) são PERDIDOS.
--
-- Use somente em homologação / ambiente sem dados que importem, ou depois de
-- backup completo. Os arquivos dos buckets `fin-receipts` e `fin-docs` NÃO são
-- apagados por SQL: baixe o que precisar e remova pelo painel do Storage.
-- Registros em `admin_audit_logs` (source = 'finance') permanecem — são trilha
-- de auditoria e não devem ser apagados.
--
-- Trava: o script só executa se a sessão declarar a confirmação:
--     set fin.confirm_drop = 'DROP_FINANCE';
-- ======================================================================

do $$
begin
  if coalesce(current_setting('fin.confirm_drop', true), '') <> 'DROP_FINANCE' then
    raise exception 'Rollback financeiro bloqueado. Leia o cabeçalho e use: set fin.confirm_drop = ''DROP_FINANCE'';';
  end if;
end $$;

-- 1) Gatilhos colocados em tabelas que já existiam
drop trigger if exists fin_profile_membership_end on public.profiles;
drop trigger if exists fin_student_payments_audit on public.student_payments;

-- 2) Políticas de Storage do financeiro (os buckets ficam; esvazie-os pelo painel)
drop policy if exists fin_docs_admin_read on storage.objects;
drop policy if exists fin_docs_admin_upload on storage.objects;
drop policy if exists fin_receipts_member_upload on storage.objects;
drop policy if exists fin_receipts_member_read on storage.objects;
drop policy if exists fin_receipts_admin_read on storage.objects;

-- 3) Visões e funções públicas fin_*
drop view if exists public.fin_entries_v cascade;
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'fin\_%'
  loop
    execute format('drop function if exists %s cascade', f.sig);
  end loop;
end $$;

-- 4) Tabelas (ordem independente: CASCADE resolve as FKs entre elas)
drop table if exists
  public.fin_receipt_charges, public.fin_receipt_submissions,
  public.fin_charge_payments, public.fin_member_credits, public.fin_charge_adjustments,
  public.fin_member_charges, public.fin_member_plan_prices, public.fin_member_plans,
  public.fin_attachments, public.fin_entry_payments, public.fin_entries, public.fin_recurrences,
  public.fin_categories, public.fin_accounts, public.fin_holidays, public.fin_settings, public.fin_requests
cascade;

-- 5) Schema privado (funções de apoio, visões internas, gatilhos auxiliares)
drop schema if exists fin_private cascade;
