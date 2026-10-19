-- A única mensagem programada para iniciar a resenha é uma fala do João (não da equipe).
-- A conversão para origin='ai' só ocorre após envio confirmado; assim "Responder" funciona.
create or replace function conv_private.identify_joao_kickoff()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $function$
begin
  if new.id = '9f4a3e12-2026-4017-8c55-abb41167ffff'::uuid
     and new.status = 'sent' and new.message_id is not null then
    update public.conv_messages m
      set origin = 'ai'
      where m.id = new.message_id
        and m.conversation_id = new.conversation_id
        and m.origin = 'system'
        and m.direction = 'outbound';
  end if;
  return new;
end;
$function$;
drop trigger if exists tr_identify_joao_kickoff on public.conv_followups;
create trigger tr_identify_joao_kickoff
after update of status on public.conv_followups
for each row
when (new.id = '9f4a3e12-2026-4017-8c55-abb41167ffff'::uuid and new.status = 'sent')
execute function conv_private.identify_joao_kickoff();
