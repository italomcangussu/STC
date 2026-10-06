create table if not exists public.conv_ai_memory_candidates (
  id uuid primary key default gen_random_uuid(),
  subject_name text not null check (char_length(subject_name) between 2 and 120),
  kind text not null check (kind in ('confirmed_fact','recurring_preference','social_relation','inside_joke')),
  content text not null check (char_length(content) between 3 and 500),
  confidence numeric(4,3) not null default 0.500 check (confidence between 0 and 1),
  status text not null default 'pending' check (status in ('pending','approved','rejected','superseded')),
  source_message_id uuid null references public.conv_messages(id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz null,
  reviewed_by uuid null references auth.users(id) on delete set null
);
create index if not exists conv_ai_memory_candidates_status_created_idx on public.conv_ai_memory_candidates(status, created_at desc);
create index if not exists conv_ai_memory_candidates_subject_idx on public.conv_ai_memory_candidates(lower(subject_name), status);
alter table public.conv_ai_memory_candidates enable row level security;
create or replace function public.conv_svc_ai_memory_candidate(p jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_kind text:=nullif(trim(p->>'kind'),''); v_subject text:=nullif(trim(p->>'subject_name'),''); v_content text:=nullif(trim(p->>'content'),''); v_conf numeric:=greatest(0,least(1,coalesce((p->>'confidence')::numeric,0.5))); v_source uuid:=nullif(p->>'source_message_id','')::uuid;
begin
 if v_kind not in ('confirmed_fact','recurring_preference','social_relation','inside_joke') or v_subject is null or v_content is null then return null; end if;
 select id into v_id from public.conv_ai_memory_candidates where lower(subject_name)=lower(v_subject) and lower(content)=lower(v_content) and status in ('pending','approved') order by created_at desc limit 1;
 if v_id is not null then return v_id; end if;
 insert into public.conv_ai_memory_candidates(subject_name,kind,content,confidence,source_message_id) values(v_subject,v_kind,left(v_content,500),v_conf,v_source) returning id into v_id;
 return v_id;
exception when others then return null;
end $$;
revoke all on function public.conv_svc_ai_memory_candidate(jsonb) from public,anon,authenticated;
grant execute on function public.conv_svc_ai_memory_candidate(jsonb) to service_role;