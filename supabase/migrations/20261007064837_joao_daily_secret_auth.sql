-- Dedicated authentication for João's daily greeting Edge Function.
-- The secret value is generated inside Supabase Vault and is never committed.

do $$
begin
  if not exists (
    select 1
    from vault.decrypted_secrets
    where name = 'joao_daily_dispatch_secret'
  ) then
    perform vault.create_secret(
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      'joao_daily_dispatch_secret',
      'Internal secret used only by the João daily greeting cron'
    );
  end if;
end
$$;

create or replace function public.joao_daily_secret_ok(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists(
    select 1
    from vault.decrypted_secrets
    where name = 'joao_daily_dispatch_secret'
      and decrypted_secret = p_secret
  );
$function$;

revoke all on function public.joao_daily_secret_ok(text) from public, anon, authenticated;
grant execute on function public.joao_daily_secret_ok(text) to service_role;
