-- Memória de cargos: o João guarda o cargo de cada pessoa do clube ("Presidente", "Vice-presidente", "Administrador") e passa a tratá-la por ele.
-- Quando o próprio administrador informa ou corrige o cargo no privado, o fato já entra aprovado (a diretoria é quem sabe); vindo de qualquer outra
-- pessoa continua como sugestão para a diretoria revisar. Um cargo novo substitui o anterior da mesma pessoa.
do $$
declare v_name text;
begin
  select conname into v_name from pg_constraint
  where conrelid = 'public.conv_ai_memory_candidates'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%confirmed_fact%';
  if v_name is not null then execute format('alter table public.conv_ai_memory_candidates drop constraint %I', v_name); end if;
  alter table public.conv_ai_memory_candidates add constraint conv_ai_memory_candidates_kind_check
    check (kind in ('confirmed_fact', 'recurring_preference', 'social_relation', 'inside_joke', 'role_title'));
end $$;

create or replace function public.conv_svc_ai_memory_candidate(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_kind text := nullif(trim(p->>'kind'), ''); v_subject text := nullif(trim(p->>'subject_name'), ''); v_content text := nullif(trim(p->>'content'), '');
  v_conf numeric := greatest(0, least(1, coalesce((p->>'confidence')::numeric, 0.5))); v_source uuid := nullif(p->>'source_message_id', '')::uuid;
  v_approve boolean := coalesce((p->>'approve')::boolean, false) and v_kind = 'role_title';
begin
  if v_kind not in ('confirmed_fact', 'recurring_preference', 'social_relation', 'inside_joke', 'role_title') or v_subject is null or v_content is null then return null; end if;
  select id into v_id from public.conv_ai_memory_candidates
   where lower(subject_name) = lower(v_subject) and lower(content) = lower(v_content) and status in ('pending', 'approved') order by created_at desc limit 1;
  if v_id is not null then
    if v_approve then update public.conv_ai_memory_candidates set status = 'approved', reviewed_at = coalesce(reviewed_at, now()) where id = v_id and status = 'pending'; end if;
    return v_id;
  end if;
  if v_approve then
    update public.conv_ai_memory_candidates set status = 'superseded'
     where kind = 'role_title' and status in ('approved', 'pending') and lower(subject_name) = lower(v_subject);
  end if;
  insert into public.conv_ai_memory_candidates(subject_name, kind, content, confidence, source_message_id, status, reviewed_at)
  values (v_subject, v_kind, left(v_content, 500), v_conf, v_source, case when v_approve then 'approved' else 'pending' end, case when v_approve then now() end)
  returning id into v_id;
  return v_id;
exception when others then return null;
end $$;

-- Cargo aprovado de quem está falando com o João (casa o nome do cadastro com o nome guardado: igual ou pelo primeiro nome).
create function conv_private.ai_requester_title(p_session uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.content
  from public.conv_ai_sessions s
  join public.conv_contacts c on c.id = s.requester_contact_id
  join public.profiles p on p.id = c.profile_id
  join public.conv_ai_memory_candidates m on m.kind = 'role_title' and m.status = 'approved'
    and (lower(m.subject_name) = lower(p.name) or lower(split_part(p.name, ' ', 1)) = lower(split_part(m.subject_name, ' ', 1)) and length(m.subject_name) <= length(split_part(p.name, ' ', 1)))
  where s.id = p_session
  order by m.reviewed_at desc nulls last, m.created_at desc
  limit 1 $$;
create function public.conv_svc_ai_requester_title(p_session uuid) returns text
language sql stable security definer set search_path = '' as $$ select conv_private.ai_requester_title(p_session) $$;
revoke all on function conv_private.ai_requester_title(uuid) from public, anon, authenticated;
revoke all on function public.conv_svc_ai_requester_title(uuid) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_requester_title(uuid) to service_role;

-- Cargos já conhecidos (informados pelo Hermeson e pelo Ítalo em 08/10/2026).
insert into public.conv_ai_memory_candidates(subject_name, kind, content, confidence, status, reviewed_at)
select v.n, 'role_title', v.t, 1, 'approved', now()
from (values ('Hermeson Veras', 'Presidente do clube'), ('Thieslley Soares', 'Vice-presidente do clube'), ('Derlan', 'Administrador do clube')) v(n, t)
where not exists (select 1 from public.conv_ai_memory_candidates x where x.kind = 'role_title' and lower(x.subject_name) = lower(v.n) and x.status = 'approved');

-- Cargos chegam ao João pelo SOLICITANTE (conv_svc_ai_requester_title), não pela memória social do grupo.
create or replace function conv_private.ai_approved_memories() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('subject_name', x.subject_name, 'kind', x.kind, 'content', x.content)
                            order by x.confidence desc, x.created_at desc), '[]'::jsonb)
  from (select c.subject_name, c.kind, c.content, c.confidence, c.created_at
        from public.conv_ai_memory_candidates c
        where c.status = 'approved' and c.kind <> 'role_title'
        order by c.confidence desc, c.created_at desc
        limit 60) x $$;
