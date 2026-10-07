-- Saldo das contas do clube para o João assessor (administrador no privado).
-- Só leitura; o prompt só mostra o resultado quando o solicitante é administrador.
CREATE OR REPLACE FUNCTION public.conv_svc_ai_club_balances()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'as_of', to_char(now() at time zone 'America/Fortaleza','YYYY-MM-DD"T"HH24:MI'),
    'accounts', coalesce(jsonb_agg(jsonb_build_object('name',b.name,'kind',b.kind,'balance_cents',b.balance_cents) order by b.name),'[]'::jsonb),
    'total_cents', coalesce(sum(b.balance_cents),0)
  )
  from fin_private.account_balances((now() at time zone 'America/Fortaleza')::date) b
$function$;

revoke all on function public.conv_svc_ai_club_balances() from public, anon, authenticated;
grant execute on function public.conv_svc_ai_club_balances() to service_role;
