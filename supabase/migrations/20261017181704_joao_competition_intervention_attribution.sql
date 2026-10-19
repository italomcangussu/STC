create or replace function conv_private.identify_joao_kickoff()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $function$
begin
 if new.status = 'sent' and new.message_id is not null
   and new.id in (
    '9f4a3e12-2026-4017-8c55-abb41167ffff'::uuid,
    'a76c302e-721b-49e2-b515-202610171815'::uuid
   ) then
   update public.conv_messages m set origin='ai'
   where m.id=new.message_id and m.conversation_id=new.conversation_id
      and m.origin='system' and m.direction='outbound';
 end if;
 return new;
end;
$function$;
drop trigger if exists tr_identify_joao_kickoff on public.conv_followups;
create trigger tr_identify_joao_kickoff
after update of status on public.conv_followups
for each row
when (
 new.id in (
 '9f4a3e12-2026-4017-8c55-abb41167ffff'::uuid,
 'a76c302e-721b-49e2-b515-202610171815'::uuid)
 and new.status='sent'
)
execute function conv_private.identify_joao_kickoff();
