-- 4ª Classe com 20 atletas e quali (Hermeson no grupo do AUGE OPEN e imagem oficial, 30/10). A chave principal segue com
-- 16: cabeças 1–8, classificados diretos 9–12 e 4 vagas da quali (13º–20º, 4 jogos; o 1º em Nova Russas, os outros em
-- Sobral). O João passa a saber disso pelas INFORMAÇÕES OFICIAIS (privado e grupo); os cabeças de chave vão para o painel
-- (os 7 que já estão nele; Daniel Rodrigues ainda é só pré-inscrição); e o sorteio pelo João fica travado nas classes com
-- formato oficial (joao_info->'class_formats').
-- NÃO mexe em inscrição: Daniel Rodrigues (sem Pix), Thiago Gomes, Diego Memória e Anísio Queiroz (sem inscrição) e
-- Hermeson Veras (pago na 5ª, na quali da 4ª pela imagem) dependem de decisão da organização.

update public.championships
set joao_info = joao_info
  || jsonb_build_object('class_formats', '{"4ª Classe": {"inscritos": 20, "chave_principal": 16, "quali_jogos": 4, "fonte": "imagem da organização, 30/10"}}'::jsonb)
  || jsonb_build_object('info', replace(replace(joao_info->>'info',
       'Classes: 4ª Classe e 5ª Classe, com 16 atletas em cada.',
       'Classes: 4ª Classe (20 inscritos, com quali; 16 na chave principal) e 5ª Classe (até 16 atletas).'),
       'MUDANÇA NA 4ª CLASSE', 'MUDANÇA NA 4ª CLASSE (antiga)') || '

MUDANÇA NA 4ª CLASSE (confirmada pela organização em 30/10): a 4ª tem 20 inscritos e passa a ter QUALI. A chave principal continua com 16 atletas, a partir das oitavas. Para a 4ª vale esta lista oficial, mesmo que outra lista do sistema ainda não esteja atualizada.
Cabeças de chave (1º ao 8º): 1 Thieslley Soares (STC), 2 Josiel Simplício (MTC), 3 Rafael Anderson Teixeira Fernandes (MTC), 4 Gustavo Morais (MTC), 5 Daniel Rodrigues (BVTC), 6 Marcelo Sampieri (STC), 7 Bruno Farias Cavalcante (CTC), 8 Mario Rego (STC).
Classificados direto para a chave principal (9º ao 12º): Henrique Coelho (STC), Miguel Pereira de Sousa Júnior (CTC), Ednaldo Soares Barbosa (CTC), Philippe Ramos de Aguiar (MTC).
Quali (13º ao 20º): 4 jogos, e quem vence cada jogo ganha uma das 4 vagas na chave principal.
Jogo 1, em Nova Russas: Francielton Miranda Rosa (NRTC) x Joaquim Brandão (NRTC).
Jogo 2, em Sobral: Cristhian Pinheiro Aurélio (CTC) x Anísio Queiroz (MTC).
Jogo 3, em Sobral: Thiago Gomes (STC) x Carlos Carneiro (STC).
Jogo 4, em Sobral: Diego Memória (STC) x Hermerson Veras (STC).
Data e horário dos jogos da quali: a organização confirma.
Siglas dos clubes: STC = Sobral Tênis Clube (Sobral); MTC = clube de Tianguá; CTC = Crateús; BVTC = Boa Viagem; NRTC = Nova Russas.
A 5ª Classe não muda: até 16 atletas, mata-mata direto, sem quali.')
where name = 'Serra e Sertão 2026' and position('MUDANÇA NA 4ª CLASSE' in coalesce(joao_info->>'info', '')) = 0;

-- Cabeças de chave no painel (os que já estão inscritos na 4ª).
update public.championship_registrations r set seed_number = s.n
from (values (1, 'Thieslley'), (2, 'Josiel'), (3, 'Rafael Anderson'), (4, 'Gustavo Morais'), (6, 'Marcelo Sampieri'),
             (7, 'Bruno Farias'), (8, 'Mario Rego')) s(n, nome)
where r.class = '4ª Classe'
  and r.championship_id = (select c.id from public.championships c where c.name = 'Serra e Sertão 2026' order by c.created_at desc limit 1)
  and coalesce(r.guest_name, (select p.name from public.profiles p where p.id = r.user_id)) ilike s.nome || '%';

-- Sorteio pelo João: igual ao de produção, com a trava do formato oficial.
CREATE OR REPLACE FUNCTION public.conv_svc_ai_championship_draw(p_session uuid, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_admin uuid; v_champ uuid; v_class text; v_n int; v_order int[] := array[1,16,9,8,5,12,13,4,3,14,11,6,7,10,15,2];
  v_by_number uuid[] := array_fill(null::uuid, array[16]); v_slot uuid[] := array_fill(null::uuid, array[16]);
  v_round jsonb; v_m uuid[] := array_fill(null::uuid, array[15]); r record; i int; v_a uuid; v_b uuid; v_win uuid; v_out jsonb := '[]'::jsonb;
  v_name_a text; v_name_b text; v_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  v_admin := conv_private.ai_admin_requester(p_session);
  if v_admin is null then return conv_private.vfail('FORBIDDEN', 'Só a administração pode pedir o sorteio.'); end if;
  v_champ := conv_private.champ_pick(nullif(p->>'championship_id', '')::uuid);
  if v_champ is null then return conv_private.vfail('NO_CHAMPIONSHIP', 'Não achei o campeonato.'); end if;
  v_class := conv_private.champ_class(v_champ, p->>'class');
  if v_class is null then return conv_private.vfail('INVALID_CLASS', 'Qual classe eu sorteio?'); end if;
  perform pg_advisory_xact_lock(hashtext(v_champ::text || v_class));
  if conv_private.champ_drawn(v_champ, v_class) then return conv_private.vfail('DRAWN', 'A chave da ' || v_class || ' já foi sorteada.'); end if;
  -- Chave definida pela organização (cabeças, classificados diretos e quali): o João não sorteia por cima.
  if exists (select 1 from public.championships x where x.id = v_champ and x.joao_info->'class_formats' ? v_class) then
    return conv_private.vfail('OFFICIAL_FORMAT', 'A chave da ' || v_class || ' já foi definida pela organização (cabeças de chave, classificados diretos e quali). Não faço sorteio por cima dela.');
  end if;

  select jsonb_object_agg(x.phase, x.id) into v_round from public.championship_rounds x where x.championship_id = v_champ and x.class = v_class;
  if v_round is null or not (v_round ?& array['oitavas', 'quartas', 'semifinal', 'final']) then
    return conv_private.vfail('NO_ROUNDS', 'A ' || v_class || ' não tem as rodadas de oitavas até a final.');
  end if;
  v_n := conv_private.champ_confirmed(v_champ, v_class);
  if v_n < 9 or v_n > 16 then
    return conv_private.vfail('COUNT', 'A ' || v_class || ' tem ' || v_n || ' inscritos confirmados; o sorteio automático das oitavas precisa de 9 a 16. Com outro número, monte a chave pelo Criador no painel.');
  end if;

  -- Números: cabeças na ordem (1, 2, 3…), os demais embaralhados nos números seguintes.
  i := 0;
  for r in select x.id from public.championship_registrations x where x.championship_id = v_champ and x.class = v_class
           order by x.seed_number nulls last, case when x.seed_number is null then random() end loop
    i := i + 1;
    v_by_number[i] := r.id;
  end loop;
  for i in 1..16 loop v_slot[i] := v_by_number[v_order[i]]; end loop;

  for i in 1..8 loop
    insert into public.matches (championship_id, round_id, type, status, match_number, registration_a_id, registration_b_id, player_a_id, player_b_id, scheduled_date)
    select v_champ, (v_round->>'oitavas')::uuid, 'Campeonato', 'pending', i, v_slot[2*i-1], v_slot[2*i],
      (select user_id from public.championship_registrations where id = v_slot[2*i-1]),
      (select user_id from public.championship_registrations where id = v_slot[2*i]),
      (select x.start_date from public.championship_rounds x where x.id = (v_round->>'oitavas')::uuid)
    returning id into v_id;
    v_m[i] := v_id;
  end loop;
  for i in 1..4 loop
    insert into public.matches (championship_id, round_id, type, status, match_number, player_a_source_match_id, player_b_source_match_id)
    values (v_champ, (v_round->>'quartas')::uuid, 'Campeonato', 'pending', 8 + i, v_m[2*i-1], v_m[2*i]) returning id into v_id;
    v_m[8 + i] := v_id;
  end loop;
  for i in 1..2 loop
    insert into public.matches (championship_id, round_id, type, status, match_number, player_a_source_match_id, player_b_source_match_id)
    values (v_champ, (v_round->>'semifinal')::uuid, 'Campeonato', 'pending', 12 + i, v_m[7 + 2*i], v_m[8 + 2*i]) returning id into v_id;
    v_m[12 + i] := v_id;
  end loop;
  insert into public.matches (championship_id, round_id, type, status, match_number, player_a_source_match_id, player_b_source_match_id)
  values (v_champ, (v_round->>'final')::uuid, 'Campeonato', 'pending', 15, v_m[13], v_m[14]) returning id into v_id;
    v_m[15] := v_id;

  -- Sem adversário: passa direto (WO). O gatilho propagate_bracket_winner coloca o atleta nas quartas.
  for i in 1..8 loop
    v_a := v_slot[2*i-1]; v_b := v_slot[2*i];
    select coalesce(x.guest_name, pr.name) into v_name_a from public.championship_registrations x left join public.profiles pr on pr.id = x.user_id where x.id = v_a;
    select coalesce(x.guest_name, pr.name) into v_name_b from public.championship_registrations x left join public.profiles pr on pr.id = x.user_id where x.id = v_b;
    if (v_a is null) <> (v_b is null) then
      v_win := coalesce(v_a, v_b);
      update public.matches set status = 'finished', result_type = 'walkover', is_walkover = true,
        walkover_winner_registration_id = v_win, winner_registration_id = v_win,
        walkover_winner_id = (select user_id from public.championship_registrations where id = v_win),
        winner_id = (select user_id from public.championship_registrations where id = v_win),
        admin_notes = 'Sem adversário no sorteio: passa direto', result_set_by = v_admin, result_set_at = now()
      where id = v_m[i];
    end if;
    v_out := v_out || jsonb_build_object('match', i, 'a', v_name_a, 'b', v_name_b, 'bye', (v_a is null) <> (v_b is null));
  end loop;

  update public.championship_rounds set status = 'active' where id = (v_round->>'oitavas')::uuid and status = 'pending';
  update public.championships set status = 'ongoing' where id = v_champ and status = 'draft';
  return jsonb_build_object('ok', true, 'class', v_class, 'count', v_n, 'matches', v_out);
end $function$;

-- Rollback: reaplicar conv_svc_ai_championship_draw anterior, `joao_info - 'class_formats'` e o texto de info anterior; seed_number = null na 4ª.
