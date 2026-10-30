-- Resenha do "golpe do Pix" (Italo, 30/10, autorizado por ele): o João brinca no grupo do campeonato com quem ele custou
-- a reconhecer o Pix da inscrição. Casos tirados do histórico (comprovante ilegível, favorecido no CNPJ do clube,
-- confirmação que não saiu, "em análise"), só de quem conversou com o João sobre o PRÓPRIO Pix e hoje está confirmado.
-- Fora: conversas em que alguém inscreveu outros, o financeiro e quem falou por um responsável. A piada é sempre contra
-- o João; nada de valor, banco ou documento.
-- Também o "fiscal das vagas" (pedido do Italo): entre os convidados, quem mais perguntou coisas ao João foi o Bruno
-- Farias, de Crateús (25 mensagens, 9 perguntas, quase todas "quantas vagas / quantos inscritos", uma à 1h15). Ficou de
-- fora ele ter perguntado quem pagou (financeiro). Tudo em joao_info->'banter', com o tipo de cada resenha.

update public.championships set joao_info = joao_info || jsonb_build_object('banter', '[{"name": "Gustavo Morais", "kind": "golpe_do_pix", "story": "mandou o comprovante e o João não conseguia ler o valor de jeito nenhum: pediu foto mais nítida umas cinco vezes"}, {"name": "Francielton Miranda Rosa", "kind": "golpe_do_pix", "story": "o João achou que ele só estava conferindo a chave Pix e depois ainda não conseguiu ler o valor do comprovante"}, {"name": "Bruno Farias Cavalcante", "kind": "golpe_do_pix", "story": "o Pix caiu no CNPJ do clube e o João não reconheceu o favorecido: desconfiou do comprovante certinho"}, {"name": "Carlos Carneiro", "kind": "golpe_do_pix", "story": "o Pix caiu no CNPJ do clube e o João não reconheceu o favorecido: desconfiou do comprovante certinho"}, {"name": "Marcelo Sampieri", "kind": "golpe_do_pix", "story": "o Pix caiu no CNPJ do clube e o João não reconheceu o favorecido: desconfiou do comprovante certinho"}, {"name": "Romário Pontes Soares", "kind": "golpe_do_pix", "story": "o João conferiu o comprovante, a confirmação não saiu e ele ainda teve que voltar pedindo desculpa pela confusão"}, {"name": "Thieslley Soares", "kind": "golpe_do_pix", "story": "o João deixou o comprovante dele \"em análise\" de tanto desconfiar"}, {"name": "José Helder Hortencio Dantas filho", "kind": "golpe_do_pix", "story": "o João recebeu o comprovante e mandou \"a equipe vai conferir\" em vez de confirmar na hora"}, {"name": "Bruno Farias Cavalcante", "kind": "fiscal_das_vagas", "story": "de Crateús, foi quem mais perguntou ao João: quis saber quantas vagas e quantos inscritos tinha na 4ª umas sete vezes em 24 horas, uma delas à 1h15 da madrugada, e pediu para pôr o nome dele na lista antes de tudo \"pra não perder minha vaga\""}]'::jsonb)
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
    'status', c.status, 'info', c.joao_info->>'info', 'circuit_ranking', c.joao_info->'circuit_ranking', 'banter', c.joao_info->'banter',
    'classes', coalesce((select jsonb_agg(jsonb_build_object('class', pc.class, 'athletes', pc.athletes) order by pc.class) from por_classe pc), '[]'::jsonb),
    'total', (select count(*) from atletas a where a.name is not null),
    'socios', (select count(*) from atletas a where a.name is not null and a.socio))
  from public.championships c where c.id = p_championship $$;


-- Rollback: reaplicar group_championship_pack de 20261030180000 e `joao_info - 'banter'`.
