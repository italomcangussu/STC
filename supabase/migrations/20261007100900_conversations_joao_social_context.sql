-- Conversas · João Fonseca/STC: contexto social, ranking dinâmico e contexto recente do grupo.
--
-- Mantém a IA com uma chamada de modelo por turno. O banco fornece dados compactos:
-- (1) ranking/classe atuais, (2) contexto social aprovado de membros e (3) conversa recente do grupo.
-- O contexto social é privado ao serviço da IA/admin e nunca inclui telefone.

create table public.conv_ai_member_context (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  aliases text[] not null default '{}'::text[],
  social_context text not null default '' check (length(social_context) <= 1200),
  updated_at timestamptz not null default now()
);

alter table public.conv_ai_member_context enable row level security;
revoke all on public.conv_ai_member_context from public, anon, authenticated;
create policy conv_ai_member_context_admin_read on public.conv_ai_member_context
  for select to authenticated using (public.is_admin());
grant select on public.conv_ai_member_context to authenticated;

with seed(name, aliases, social_context) as (
  values
    ('Hermeson Veras', array['Emerson','Emerson Veras','Hermeson']::text[],
      'Atual presidente do clube, recém-eleito. Professor de redação muito conceituado. Tratar com proximidade e respeito, sem formalidade excessiva.'),
    ('Mario Rego', array['Mário','Mario','Tio']::text[],
      'Conhecido como Tio. Jogador de tênis muito antigo e figura tradicional do clube. Pai de Davi Arcelino, que é dependente dele no clube. É dono do Divino Fogão no shopping e da sorveteria Frosch. O apelido Tio pode ser usado com carinho e naturalidade.'),
    ('Marcelo Sampieri', array['Marcelo','Sampieri']::text[],
      'Um dos melhores jogadores do clube. Dentista e professor universitário. Pode receber referência leve ao nível forte de jogo, sem exagerar.'),
    ('Thieslley Soares', array['Thieslley','Thiesley']::text[],
      'Atual vice-presidente do clube. Perfil sério, ex-militar, gerente de uma grande loja de motos da cidade e jogador de tênis de longa data. Brincadeiras devem ser mais moderadas e respeitosas.'),
    ('Daniel Leão', array['Daniel']::text[],
      'Médico. Em quadra é conhecido por ter uma esquerda muito forte. Esse detalhe pode aparecer em brincadeiras de tênis quando fizer sentido.'),
    ('Tiago Gomes', array['Tiago','Thiago Gomes','Thiago']::text[],
      'Dono de laboratório ótico e de ótica. Jogador antigo, da 4ª Classe. Tem rivalidade saudável com Mário Rego: às vezes um ganha, às vezes o outro. Tem um gato preto que, na brincadeira do grupo, dá azar para quem vai jogar contra ele.'),
    ('Mailson Freitas', array['Mailson','Rei das Bets']::text[],
      'Conhecido na brincadeira como Rei das Bets. Tem uma empresa de bet. Usar o apelido apenas de forma leve e contextual.'),
    ('Davi Arcelino', array['Davi']::text[],
      'Filho de Mário Rego e dependente dele no clube.'),
    ('Henrique Coelho', array['Henrique']::text[],
      'Atual tesoureiro do clube, o dono do dinheiro na brincadeira interna. É mais velho e conhecido como atleta fogoso: muita vontade e intensidade em quadra.'),
    ('Derlan', array['Derlan']::text[],
      'Ex-presidente e atual administrador do clube. Pratica CrossFit além do tênis. Costuma fiscalizar a marcação correta dos plays no aplicativo, porque jogar sem registrar é um problema do clube e não deve acontecer. Kim Jong-un era uma brincadeira antiga da época em que era presidente; não usar como apelido padrão agora.'),
    ('Diego Memória', array['Diego Memória','Memória']::text[],
      'Professor de Educação Física, personal trainer e atual professor de tênis do clube. Pode marcar Play para si, mas quando falar de alunos/aula pelo WhatsApp, interpretar naturalmente como Aula se o contexto indicar ensino.'),
    ('Diego Parente', array['Diego Parente']::text[],
      'Advogado e sócio do clube.'),
    ('Bruno Vaz Carvalho', array['Bruno','Bruno Vaz']::text[],
      'Advogado e sócio do clube.'),
    ('Ítalo Cangussú', array['Ítalo','Italo','Italo Cangussu','Ítalo Cangussu']::text[],
      'Jovem empresário e programador, dono do Hospital dos iPhones. Participa ativamente das evoluções tecnológicas do clube e do próprio João. Pode receber brincadeiras leves sobre ter colocado o João para trabalhar no STC.')
)
insert into public.conv_ai_member_context(profile_id, aliases, social_context)
select p.id, s.aliases, s.social_context
from seed s
join public.profiles p on p.name = s.name
where coalesce(p.is_active, true)
on conflict (profile_id) do update
set aliases = excluded.aliases,
    social_context = excluded.social_context,
    updated_at = now();

-- Resolve nomes também por apelidos/aliases aprovados, sem escolher por aproximação quando houver ambiguidade.
create or replace function conv_private.ai_resolve_people(p_names text[], p_scope text default 'member') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_out jsonb := '[]'::jsonb; v_name text; v_q text; v_match jsonb; v_n integer;
begin
  if p_scope not in ('member', 'student', 'professor') then raise exception 'INVALID_SCOPE'; end if;
  foreach v_name in array coalesce(p_names, '{}') loop
    v_q := conv_private.fold(trim(v_name));
    continue when length(v_q) < 2;
    with pool as (
      select p.id, p.name::text as name, 'member'::text as kind, p.category::text as hint, 'member'::text as sc,
             coalesce(mc.aliases, '{}'::text[]) as aliases
        from public.profiles p
        left join public.conv_ai_member_context mc on mc.profile_id = p.id
        where coalesce(p.is_active, true) and p.role::text in ('socio', 'admin')
      union all
      select p.id, p.name::text, 'socio', p.category::text, 'student',
             coalesce(mc.aliases, '{}'::text[])
        from public.profiles p
        join public.student_profiles sp on sp.profile_id = p.id
        left join public.conv_ai_member_context mc on mc.profile_id = p.id
        where sp.student_status = 'active' and coalesce(p.is_active, true) and p.role::text in ('socio', 'admin')
      union all
      select s.id, s.name::text, 'non_socio', s.plan_type::text, 'student', '{}'::text[]
        from public.non_socio_students s where coalesce(s.is_active, true)
      union all
      select pf.id, pf.name::text, 'professor', null, 'professor', '{}'::text[]
        from public.professors pf where coalesce(pf.is_active, true)
    ), exact as (
      select * from pool
      where sc = p_scope
        and (
          conv_private.fold(name) = v_q
          or exists (select 1 from unnest(aliases) a where conv_private.fold(a) = v_q)
        )
      order by name limit 6
    ), partial as (
      select * from pool
      where sc = p_scope
        and not exists (
          select 1 from regexp_split_to_table(v_q, '\s+') w
          where w <> ''
            and not (
              conv_private.fold(name) like '%' || w || '%'
              or exists (select 1 from unnest(aliases) a where conv_private.fold(a) like '%' || w || '%')
            )
        )
      order by name limit 6
    ), chosen as (
      select * from exact
      union all
      select * from partial where not exists (select 1 from exact)
    )
    select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'kind', c.kind, 'hint', c.hint) order by c.name), '[]'::jsonb), count(*)
      into v_match, v_n from chosen c;
    v_out := v_out || jsonb_build_array(jsonb_build_object('query', v_name,
      'status', case when v_n = 1 then 'unique' when v_n = 0 then 'none' else 'ambiguous' end, 'matches', v_match));
  end loop;
  return v_out;
end $$;

-- Ranking compacto, calculado com a mesma ordem cognitiva do app:
-- classe (4ª > 5ª > 6ª), pontos, vitórias e sets vencidos.
create function conv_private.ai_club_roster() returns jsonb
language sql stable security definer set search_path = '' as $$
with cycle as (
  select public.get_ranking_cycle_start() as starts_at
), eligible_matches as (
  select m.*
  from public.matches m cross join cycle c
  where m.type in ('Desafio', 'Desafio Ranking', 'SuperSet')
    and m.status::text = 'finished'
    and (
      c.starts_at is null
      or coalesce(m.updated_at, m.created_at, (m.date::timestamp at time zone 'America/Fortaleza')) >= c.starts_at
    )
), match_players as (
  select m.player_a_id as profile_id,
         case when m.winner_id = m.player_a_id then 1 else 0 end as wins,
         coalesce((
           select count(*)::int
           from generate_subscripts(coalesce(m.score_a, '{}'::integer[]), 1) i
           where m.score_a[i] > coalesce(m.score_b[i], -1)
         ), 0) as sets_won
  from eligible_matches m
  where m.player_a_id is not null
  union all
  select m.player_b_id as profile_id,
         case when m.winner_id = m.player_b_id then 1 else 0 end as wins,
         coalesce((
           select count(*)::int
           from generate_subscripts(coalesce(m.score_b, '{}'::integer[]), 1) i
           where m.score_b[i] > coalesce(m.score_a[i], -1)
         ), 0) as sets_won
  from eligible_matches m
  where m.player_b_id is not null
), current_stats as (
  select profile_id, coalesce(sum(wins),0)::int as wins, coalesce(sum(sets_won),0)::int as sets_won
  from match_players
  group by profile_id
), base as (
  select p.id, p.name, p.category,
         coalesce(p.legacy_points,0)::int as points,
         (coalesce(p.legacy_wins,0) + coalesce(cs.wins,0))::int as total_wins,
         (coalesce(p.legacy_sets_won,0) + coalesce(cs.sets_won,0))::int as total_sets_won,
         coalesce(p.is_professor,false) as is_professor,
         coalesce(mc.aliases, '{}'::text[]) as aliases,
         nullif(mc.social_context, '') as social_context
  from public.profiles p
  left join current_stats cs on cs.profile_id = p.id
  left join public.conv_ai_member_context mc on mc.profile_id = p.id
  where coalesce(p.is_active, true) and p.role::text in ('socio','admin')
), ranked as (
  select b.*,
         row_number() over (
           partition by coalesce(b.category, 'Sem Classe')
           order by b.points desc, b.total_wins desc, b.total_sets_won desc, b.name
         )::int as category_position,
         row_number() over (
           order by
             case b.category when '4ª Classe' then 1 when '5ª Classe' then 2 when '6ª Classe' then 3 else 9 end,
             b.points desc, b.total_wins desc, b.total_sets_won desc, b.name
         )::int as global_position
  from base b
)
select coalesce(jsonb_agg(
  jsonb_build_object(
    'name', r.name,
    'category', coalesce(r.category, 'Sem Classe'),
    'points', r.points,
    'category_position', r.category_position,
    'global_position', r.global_position,
    'is_professor', r.is_professor,
    'aliases', to_jsonb(r.aliases),
    'social_context', r.social_context
  )
  order by r.global_position
), '[]'::jsonb)
from ranked r
$$;

-- Conversa recente de TODO o grupo (janela curta), para entender "ele", "esse horário",
-- combinações feitas antes da marcação etc. Não autoriza ação sozinho: o pedido atual continua mandando.
create function conv_private.ai_group_context(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_conv uuid; v_kind text; v_persona text;
begin
  select s.conversation_id, c.kind into v_conv, v_kind
  from public.conv_ai_sessions s
  join public.conv_conversations c on c.id = s.conversation_id
  where s.id = p_session;
  if v_conv is null then raise exception 'SESSION_NOT_FOUND'; end if;
  if v_kind <> 'group' then return '[]'::jsonb; end if;

  select coalesce(a.persona_name, 'João Fonseca') into v_persona
  from public.conv_ai_settings a where a.active order by a.version desc limit 1;

  return (
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb)
    from (
      select m.created_at,
             case
               when m.direction = 'inbound' then coalesce(p.name, cc.name, 'Participante')
               when m.origin = 'ai' then v_persona
               when m.origin = 'automation' then 'Clube'
               else 'Equipe'
             end as sender,
             left(coalesce(m.body, case when m.kind <> 'text' then '[' || m.kind || ']' else '' end), 600) as body
      from public.conv_messages m
      left join public.conv_contacts cc on cc.id = m.sender_contact_id
      left join public.profiles p on p.id = cc.profile_id
      where m.conversation_id = v_conv
        and m.deleted_at is null
        and m.created_at > now() - interval '90 minutes'
      order by m.created_at desc
      limit 18
    ) x
  );
end $$;

revoke all on function conv_private.ai_club_roster(), conv_private.ai_group_context(uuid) from public, anon, authenticated;

create function public.conv_svc_ai_club_roster() returns jsonb
language sql stable security definer set search_path = '' as $f$
  select conv_private.ai_club_roster()
$f$;
revoke all on function public.conv_svc_ai_club_roster() from public, anon, authenticated;
grant execute on function public.conv_svc_ai_club_roster() to service_role;

create function public.conv_svc_ai_group_context(p_session uuid) returns jsonb
language sql stable security definer set search_path = '' as $f$
  select conv_private.ai_group_context(p_session)
$f$;
revoke all on function public.conv_svc_ai_group_context(uuid) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_group_context(uuid) to service_role;
