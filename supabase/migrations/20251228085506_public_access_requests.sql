
alter table "public"."access_requests" enable row level security;

create policy "Enable read access for all users"
on "public"."access_requests"
as permissive
for select
to public
using (true);
;
