-- Despachante das Conversas (retornos agendados, automações, mensagens do João que esperam a vez) a cada 1 minuto.
-- O job foi criado direto no remoto (com o segredo no comando): aqui só muda o intervalo, pelo nome, sem tocar no comando.
do $$
declare v_job bigint;
begin
  if to_regclass('cron.job') is null or to_regprocedure('cron.alter_job(bigint,text,text,text,text,boolean)') is null then return; end if;
  select jobid into v_job from cron.job where jobname = 'conversations-dispatch';
  if v_job is not null then
    perform cron.alter_job(job_id := v_job, schedule := '* * * * *');
  end if;
end $$;
