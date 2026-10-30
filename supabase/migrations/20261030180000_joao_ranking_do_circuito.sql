-- Ranking do circuito no grupo do campeonato (Italo, 30/10). No grupo do AUGE OPEN o Hermeson perguntou "quem é melhor,
-- Bruno ou Tiago?" falando dos atletas do circuito, e o João respondeu com o ranking INTERNO do STC (outros Bruno e Tiago).
-- O circuito Serra & Sertão reúne Sobral, Tianguá, Nova Russas, Crateús e Boa Viagem e tem ranking próprio.
-- O ranking OFICIAL do circuito (pontos por etapa: Sobral, Finals, Nova Russas, Tianguá; imagem atualizada que o Hermeson
-- mandou) fica em championships.joao_info->'circuit_ranking' e entra no pacote do grupo do campeonato. A soma das etapas
-- de cada linha foi conferida com o total da imagem. Atleta pode aparecer nas duas classes (mudou de classe no circuito).
-- O código deixa de mostrar o ranking do STC nesse grupo (prompts.ts).

update public.championships set joao_info = joao_info || jsonb_build_object('circuit_ranking', '{"title": "Ranking oficial do circuito Serra & Sertão 2026 (atualizado, enviado pela organização em 30/10)", "stages": ["Sobral", "Finals", "Nova Russas", "Tianguá"], "clubs": ["Sobral (STC)", "Tianguá", "Nova Russas", "Crateús", "Boa Viagem"], "classes": [{"class": "4ª Classe", "rows": [{"pos": 1, "name": "Thieslley", "stages": {"Sobral": 500, "Finals": 700, "Nova Russas": 500, "Tianguá": 200}, "total": 1900}, {"pos": 2, "name": "Josiel", "stages": {"Sobral": 350, "Finals": 1000, "Nova Russas": 50, "Tianguá": 200}, "total": 1600}, {"pos": 3, "name": "Rafael", "stages": {"Sobral": 200, "Finals": 400, "Nova Russas": 200, "Tianguá": 100}, "total": 900}, {"pos": 4, "name": "André", "stages": {"Sobral": 50, "Finals": 200, "Tianguá": 500}, "total": 750}, {"pos": 5, "name": "Gustavo", "stages": {"Sobral": 100, "Finals": 400, "Nova Russas": 50, "Tianguá": 100}, "total": 650}, {"pos": 6, "name": "Daniel", "stages": {"Nova Russas": 100, "Tianguá": 350}, "total": 450}, {"pos": 7, "name": "Marcelo", "stages": {"Sobral": 50, "Nova Russas": 350}, "total": 400}, {"pos": 8, "name": "Bruno", "stages": {"Sobral": 100, "Finals": 200, "Nova Russas": 100}, "total": 400}, {"pos": 9, "name": "Mário", "stages": {"Sobral": 50, "Finals": 200, "Nova Russas": 50, "Tianguá": 50}, "total": 350}, {"pos": 10, "name": "Henrique", "stages": {"Sobral": 50, "Finals": 200, "Tianguá": 100}, "total": 350}, {"pos": 11, "name": "Miguel", "stages": {"Sobral": 50, "Nova Russas": 200, "Tianguá": 50}, "total": 300}, {"pos": 12, "name": "Ednaldo", "stages": {"Sobral": 100, "Nova Russas": 50, "Tianguá": 50}, "total": 200}, {"pos": 13, "name": "Philippe", "stages": {"Nova Russas": 100, "Tianguá": 100}, "total": 200}, {"pos": 14, "name": "Tiago", "stages": {"Sobral": 200}, "total": 200}, {"pos": 15, "name": "Diego", "stages": {"Sobral": 100, "Tianguá": 50}, "total": 150}, {"pos": 16, "name": "Francielton", "stages": {"Sobral": 50, "Nova Russas": 50}, "total": 100}, {"pos": 17, "name": "Joaquim", "stages": {"Sobral": 50, "Nova Russas": 50}, "total": 100}, {"pos": 18, "name": "Hernandes", "stages": {"Nova Russas": 100}, "total": 100}, {"pos": 19, "name": "Mardes", "stages": {"Tianguá": 50}, "total": 50}, {"pos": 20, "name": "Ismael", "stages": {"Nova Russas": 50}, "total": 50}, {"pos": 21, "name": "Claudio", "stages": {"Nova Russas": 50}, "total": 50}, {"pos": 22, "name": "Wilton", "stages": {"Sobral": 50}, "total": 50}, {"pos": 23, "name": "Italo", "stages": {"Tianguá": 50}, "total": 50}, {"pos": 24, "name": "Anisio", "stages": {"Tianguá": 50}, "total": 50}, {"pos": 25, "name": "Jair", "stages": {"Nova Russas": 25}, "total": 25}, {"pos": 26, "name": "Lucas Aragão", "stages": {"Nova Russas": 25}, "total": 25}, {"pos": 27, "name": "Mercio", "stages": {"Nova Russas": 25}, "total": 25}]}, {"class": "5ª Classe", "rows": [{"pos": 1, "name": "Diego", "stages": {"Sobral": 500, "Finals": 700}, "total": 1200}, {"pos": 2, "name": "Francielton", "stages": {"Sobral": 200, "Finals": 1000}, "total": 1200}, {"pos": 3, "name": "Marciano", "stages": {"Sobral": 350, "Finals": 400}, "total": 750}, {"pos": 4, "name": "Helder", "stages": {"Tianguá": 500}, "total": 500}, {"pos": 5, "name": "Cristhian", "stages": {"Nova Russas": 500}, "total": 500}, {"pos": 6, "name": "Philippe", "stages": {"Sobral": 100, "Finals": 400}, "total": 500}, {"pos": 7, "name": "Joaquim", "stages": {"Sobral": 100, "Finals": 200, "Nova Russas": 100, "Tianguá": 50}, "total": 450}, {"pos": 8, "name": "Ealber", "stages": {"Sobral": 200, "Finals": 200}, "total": 400}, {"pos": 9, "name": "Marcos Lima", "stages": {"Nova Russas": 350}, "total": 350}, {"pos": 10, "name": "Mardes", "stages": {"Tianguá": 350}, "total": 350}, {"pos": 11, "name": "Hermerson", "stages": {"Tianguá": 200}, "total": 200}, {"pos": 12, "name": "Ebelardo", "stages": {"Nova Russas": 200}, "total": 200}, {"pos": 13, "name": "Thiago Lima", "stages": {"Nova Russas": 200}, "total": 200}, {"pos": 14, "name": "Vitor", "stages": {"Tianguá": 200}, "total": 200}, {"pos": 15, "name": "Jorge Daniel", "stages": {"Tianguá": 200}, "total": 200}, {"pos": 16, "name": "Gervazio", "stages": {"Tianguá": 200}, "total": 200}, {"pos": 17, "name": "Frederico", "stages": {"Nova Russas": 100, "Tianguá": 50}, "total": 150}, {"pos": 18, "name": "Mailson", "stages": {"Sobral": 50, "Tianguá": 50}, "total": 100}, {"pos": 19, "name": "Davi", "stages": {"Sobral": 50, "Tianguá": 50}, "total": 100}, {"pos": 20, "name": "Emanuel Lourenço", "stages": {"Tianguá": 100}, "total": 100}, {"pos": 21, "name": "Romario", "stages": {"Nova Russas": 50, "Tianguá": 50}, "total": 100}, {"pos": 22, "name": "Lucas Aragão", "stages": {"Tianguá": 100}, "total": 100}]}]}'::jsonb)
where name = 'Serra e Sertão 2026';

create or replace function conv_private.group_championship_pack(p_championship uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with atletas as (
    select r.class, coalesce(r.guest_name, p.name) as name,
           (r.user_id is not null or s.profile_id is not null) as socio, s.city
    from public.championship_registrations r
    left join public.profiles p on p.id = r.user_id
    left join lateral (select x.profile_id, x.city from public.championship_signups x
                       where x.registration_id = r.id and x.status <> 'canceled' order by x.created_at desc limit 1) s on true
    where r.championship_id = p_championship
    union all
    select s.class, s.full_name, s.profile_id is not null, s.city
    from public.championship_signups s
    where s.championship_id = p_championship and s.registration_id is null and s.status in ('pre', 'confirmed')
  ), por_classe as (
    select a.class, jsonb_agg(jsonb_build_object('name', a.name, 'socio', a.socio, 'city', nullif(trim(a.city), ''))
                              order by a.socio desc, a.name) as athletes
    from atletas a where a.name is not null group by a.class
  )
  select jsonb_build_object(
    'name', c.name, 'title', coalesce(c.joao_info->'title', '[]'::jsonb), 'start_date', c.start_date, 'end_date', c.end_date,
    'status', c.status, 'info', c.joao_info->>'info', 'circuit_ranking', c.joao_info->'circuit_ranking',
    'classes', coalesce((select jsonb_agg(jsonb_build_object('class', pc.class, 'athletes', pc.athletes) order by pc.class) from por_classe pc), '[]'::jsonb),
    'total', (select count(*) from atletas a where a.name is not null),
    'socios', (select count(*) from atletas a where a.name is not null and a.socio))
  from public.championships c where c.id = p_championship $$;

-- Rollback: reaplicar group_championship_pack de 20261030170000 e `joao_info - 'circuit_ranking'`.
