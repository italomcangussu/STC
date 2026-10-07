// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { ID, j, key, q, rpc, rpcError, svc, U, world } from './harness';

type W = Awaited<ReturnType<typeof world>>;

const save = (w: W, p: Record<string, unknown>) => rpc<{ id: string; problems: string[] }>(w.db, U.admin, `public.conv_save_automation('${key()}', null, ${j(p)})`);
const status = (w: W, id: string, s: string) => rpc<any>(w.db, U.admin, `public.conv_automation_set_status('${key()}', '${id}', '${s}')`);
const preview = (w: W, id: string) => rpc<any>(w.db, U.admin, `public.conv_automation_preview('${id}', null)`);
const recipients = (w: W, where = 'true') => q<any>(w.db, `select * from public.conv_automation_recipients where ${where} order by created_at, id`);
const claim = (w: W, n = 10) => svc<any[]>(w.db, `(select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.conv_svc_automation_claim(${n}) x)`);
const tickAt = async (db: PGlite, iso: string) => (await q<{ r: any }>(db, `select conv_private.automation_tick('${iso}'::timestamptz) r`))[0].r;
const openWindow = (w: W) => rpc(w.db, U.admin, `public.conv_save_automation_settings('${key()}', ${j({ window_start: '00:00', window_end: '23:59:59', days: [0, 1, 2, 3, 4, 5, 6], min_hours_between: 0, daily_cap: 10, weekly_cap: 30 })})`);
const members = (over: Record<string, unknown> = {}) => ({ name: 'Aviso aos sócios', source: 'audience', trigger_type: 'scheduled',
  definition: { audience: 'members' }, schedule: { time: '09:00', dates: ['2026-10-12'] }, message_body: 'Olá, {{nome}}! Aviso do {{clube}}.', ...over });

describe('agendamento: horário e fuso configurados', () => {
  it('dispara uma vez, no horário de Fortaleza (UTC−3), e não antes nem de novo', async () => {
    const w = await world();
    const a = await save(w, members());
    await status(w, a.id, 'active');
    expect((await tickAt(w.db, '2026-10-12T11:59:00Z')).runs).toBe(0);     // 08:59 em Fortaleza
    expect((await tickAt(w.db, '2026-10-12T09:00:00Z')).runs).toBe(0);
    const t = await tickAt(w.db, '2026-10-12T12:00:30Z');                  // 09:00 em Fortaleza
    expect([t.runs, t.recipients]).toEqual([1, 4]);                          // admin, 2 sócios e o professor têm telefone; lanchonete não é sócio
    expect((await tickAt(w.db, '2026-10-12T12:30:00Z')).runs).toBe(0);     // já rodou
    expect((await tickAt(w.db, '2026-10-13T12:30:00Z')).runs).toBe(0);     // outro dia: não está na lista
    const [run] = await q<any>(w.db, `select to_char(planned_for at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') p from public.conv_automation_runs`);
    expect(run.p).toBe('2026-10-12T12:00:00Z');
  }, 90000);

  it('recorrência semanal respeita os dias; data final encerra a regra e cancela o que faltava', async () => {
    const w = await world();
    const a = await save(w, members({ schedule: { time: '09:00', weekdays: [1], end_date: '2026-10-19' } }));   // segundas
    await status(w, a.id, 'active');
    expect((await tickAt(w.db, '2026-10-13T13:00:00Z')).runs).toBe(0);     // terça
    expect((await tickAt(w.db, '2026-10-12T13:00:00Z')).runs).toBe(1);     // segunda
    expect((await tickAt(w.db, '2026-10-19T13:00:00Z')).runs).toBe(1);     // segunda seguinte (a última)
    expect((await q<any>(w.db, `select count(*)::int n from public.conv_automation_recipients`))[0].n).toBe(8);   // 4 por execução, janelas diferentes
    await tickAt(w.db, '2026-10-20T13:00:00Z');                            // passou da data final
    expect((await q<any>(w.db, `select status from public.conv_automations where id = '${a.id}'`))[0].status).toBe('ended');
    expect((await recipients(w, `status = 'pending'`)).length).toBe(0);
  }, 90000);
});

describe('públicos e dedupe', () => {
  it('sócios, alunos, dependentes, professores e Card são públicos distintos; a pessoa aparece uma vez por público', async () => {
    const w = await world();
    await w.db.exec(`insert into public.student_profiles(profile_id, student_status) values ('${U.socioA}', 'active'), ('${U.socioB}', 'paused');
      insert into public.non_socio_students(id, name, phone, plan_type, plan_status, student_type, responsible_socio_id, is_active) values
        ('${ID(760)}', 'Filho da Ana', null, 'Dependente', 'active', 'dependent', '${U.socioA}', true),
        ('${ID(761)}', 'Outro Filho da Ana', null, 'Dependente', 'active', 'dependent', '${U.socioA}', true),
        ('${ID(762)}', 'Aluno Avulso', '85911112222', 'Card Mensal', 'active', 'regular', null, true)`);
    const count = async (audience: string) => (await preview(w, (await save(w, members({ name: `Público ${audience}`, trigger_type: 'manual', schedule: {}, definition: { audience } }))).id));
    expect((await count('members')).estimated_recipients).toBe(4);
    const students = await count('students');
    expect(students.estimated_recipients).toBe(2);   // Ana (ativa) + Aluno Avulso; Beto está pausado
    expect(students.excluded_by_reason).toMatchObject({ ALUNO_PAUSADO_OU_ENCERRADO: 1 });
    expect((await count('dependents')).estimated_recipients).toBe(1);   // dois dependentes, UM responsável: uma mensagem
    expect((await count('professors')).estimated_recipients).toBe(1);
    expect((await count('card_holders')).estimated_recipients).toBe(1);
  }, 120000);

  it('anti-spam entre automações: a mesma pessoa em dois públicos recebe no máximo o teto diário', async () => {
    const w = await world();
    await openWindow(w);
    await rpc(w.db, U.admin, `public.conv_save_automation_settings('${key()}', ${j({ daily_cap: 1 })})`);
    await w.db.exec(`insert into public.student_profiles(profile_id, student_status) values ('${U.socioA}', 'active')`);
    const m = await save(w, members({ name: 'Todos os sócios', definition: { audience: 'members' }, schedule: { time: '00:00', dates: ['2026-10-12'] } }));
    const s = await save(w, members({ name: 'Alunos', definition: { audience: 'students' }, schedule: { time: '00:00', dates: ['2026-10-12'] }, message_body: 'Olá, {{nome}}! Aviso aos alunos.' }));
    await status(w, m.id, 'active'); await status(w, s.id, 'active');
    await tickAt(w.db, '2026-10-12T12:00:00Z');
    const anaRecipients = await recipients(w, `profile_id = '${U.socioA}'`);
    expect(anaRecipients.length).toBe(2);   // um por público (finalidades diferentes)
    // Mesmo reservados no MESMO lote, só um sai agora: o que está em envio já conta para o teto (diário = 1).
    const first = await claim(w, 50);
    const mine = first.filter((x) => anaRecipients.some((r) => r.id === x.recipient_id));
    expect(mine.length).toBe(1);
    const other = anaRecipients.find((r) => r.id !== mine[0].recipient_id)!;
    const [reagendado] = await recipients(w, `id = '${other.id}'`);
    expect(reagendado.status).toBe('pending');
    expect(new Date(reagendado.due_at).getTime()).toBeGreaterThan(Date.now());   // reagendado para depois do teto, não perdido
    // O 1º sai e é marcado como enviado: o outro continua esbarrando no teto (agora pelo que JÁ foi enviado).
    const qq = await svc<any>(w.db, `(select to_jsonb(x) from public.conv_svc_automation_queue('${mine[0].recipient_id}', '${mine[0].conversation_id}', 'olá') x)`);
    await svc(w.db, `public.conv_svc_finish_message('${qq.message_id}', true, 'P1', null)`);
    await svc(w.db, `public.conv_svc_automation_finish('${mine[0].recipient_id}', '${qq.message_id}', true, null)`);
    await w.db.exec(`update public.conv_automation_recipients set due_at = now() - interval '1 minute' where id = '${other.id}'`);
    expect((await claim(w, 50)).map((x) => x.recipient_id)).not.toContain(other.id);
    const [r2] = await recipients(w, `id = '${other.id}'`);
    expect(new Date(r2.due_at).getTime()).toBeGreaterThan(Date.now());
  }, 120000);
});

describe('envio manual: preparado, revisado, aprovado', () => {
  it('nada sai antes da aprovação; aprovar põe na fila; cancelar a execução não envia; tudo auditado', async () => {
    const w = await world();
    await openWindow(w);
    const a = await save(w, members({ name: 'Comunicado manual', trigger_type: 'manual', schedule: {} }));
    expect(await rpcError(w.db, U.socioA, `public.conv_automation_prepare_manual('${key()}', '${a.id}')`)).toMatch(/CONV_FORBIDDEN/);
    const prep = await rpc<any>(w.db, U.admin, `public.conv_automation_prepare_manual('${key()}', '${a.id}')`);
    expect(prep.recipients).toBe(4);
    expect((await recipients(w)).every((r) => r.status === 'review')).toBe(true);
    expect(await claim(w)).toEqual([]);                                   // em revisão não é claimable
    // aprovar duas vezes com a mesma chave não duplica
    const k = key();
    const ap = await rpc<any>(w.db, U.admin, `public.conv_automation_approve_run('${k}', '${prep.run_id}')`);
    const ap2 = await rpc<any>(w.db, U.admin, `public.conv_automation_approve_run('${k}', '${prep.run_id}')`);
    expect(ap.queued).toBe(4);
    expect(ap2.replayed).toBe(true);
    expect(await rpcError(w.db, U.admin, `public.conv_automation_approve_run('${key()}', '${prep.run_id}')`)).toMatch(/RUN_NOT_IN_REVIEW/);
    expect((await claim(w)).length).toBe(4);
    expect((await q(w.db, `select 1 from public.admin_audit_logs where action = 'conv.manual_dispatch'`)).length).toBe(1);

    // outra execução: preparada e cancelada ⇒ ninguém recebe
    await q(w.db, `update public.conv_automation_recipients set status = 'canceled' where status = 'processing'`);
    const prep2 = await rpc<any>(w.db, U.admin, `public.conv_automation_prepare_manual('${key()}', '${a.id}')`);
    expect(prep2.recipients).toBe(4);   // os cancelados não bloqueiam uma nova preparação
    await rpc(w.db, U.admin, `public.conv_automation_cancel_run('${prep2.run_id}')`);
    expect((await recipients(w, `run_id = '${prep2.run_id}'`)).every((r) => r.status === 'canceled')).toBe(true);
  }, 120000);

  it('mensagem de teste vai só ao telefone do PRÓPRIO administrador, com dados reais', async () => {
    const w = await world();
    const a = await save(w, members({ name: 'Comunicado', trigger_type: 'manual', schedule: {} }));
    const t = await svc<any>(w.db, `public.conv_svc_automation_test_payload('${U.admin}', '${a.id}')`);
    expect(t.phone).toBe('5599900000001');
    expect(t.body).toMatch(/^\[TESTE/);
    await w.db.exec(`update public.profiles set phone = null where id = '${U.admin}'`);
    await expect(svc(w.db, `public.conv_svc_automation_test_payload('${U.admin}', '${a.id}')`)).rejects.toThrow(/ADMIN_WITHOUT_PHONE/);
    // quem não é administrador não tem teste
    await expect(svc(w.db, `public.conv_svc_automation_test_payload('${U.socioA}', '${a.id}')`)).rejects.toThrow(/ADMIN_WITHOUT_PHONE/);
  }, 90000);
});

describe('campeonatos: só resultado e avanço confirmados', () => {
  const champ = ID(8001);
  async function seed(w: W) {
    await w.db.exec(`
      insert into public.championships(id, name, status) values ('${champ}', 'Circuito de Teste', 'ongoing');
      insert into public.championship_registrations(id, championship_id, user_id, guest_name, class) values
        ('${ID(8101)}', '${champ}', '${U.socioA}', null, '5ª classe'),
        ('${ID(8102)}', '${champ}', '${U.socioB}', null, '5ª classe'),
        ('${ID(8103)}', '${champ}', null, 'Convidado Sem Cadastro', '5ª classe');`);
  }
  const finish = (w: W, id: string, over: string) => w.db.exec(`update public.matches set ${over} where id = '${id}'`);
  const match = (w: W, id: string, regA: string, regB: string, userA: string | null, userB: string | null, phase = 'Quartas') => w.db.exec(`
    insert into public.matches(id, championship_id, phase, registration_a_id, registration_b_id, player_a_id, player_b_id)
    values ('${id}', '${champ}', '${phase}', '${regA}', '${regB}', ${userA ? `'${userA}'` : 'null'}, ${userB ? `'${userB}'` : 'null'})`);
  const resultAutomation = (w: W) => save(w, { name: 'Resultado confirmado', source: 'championship_result', trigger_type: 'event',
    definition: { championship_id: champ, settle_minutes: 10 }, schedule: {},
    message_body: '{{nome}}, resultado de {{fase}} no {{campeonato}}: {{placar}} ({{resultado}}) contra {{adversario}}.' });
  const activateAnHourAgo = async (w: W, id: string) => {
    await status(w, id, 'active');
    await w.db.exec(`update public.conv_automations set activated_at = now() - interval '1 hour' where id = '${id}'`);
  };

  it('resultado: só partida encerrada COM resultado registrado, completo e "assentado"; placar visto de cada lado', async () => {
    const w = await world();
    await seed(w);
    await match(w, ID(9001), ID(8101), ID(8102), U.socioA, U.socioB);
    const a = await resultAutomation(w);
    await activateAnHourAgo(w, a.id);
    const p0 = await preview(w, a.id);
    expect(p0.estimated_recipients).toBe(0);                                      // partida pendente
    // encerrada pelo marcador ao vivo, sem result_set_at: não há como saber se alguém conferiu
    await finish(w, ID(9001), `status = 'finished', winner_id = '${U.socioA}', winner_registration_id = '${ID(8101)}', score_a = '{6,3,10}', score_b = '{4,6,8}'`);
    expect((await preview(w, a.id)).estimated_recipients).toBe(0);
    // registrada agora: ainda não "assentou" (edição pendente)
    await finish(w, ID(9001), `result_set_at = now()`);
    expect((await preview(w, a.id)).estimated_recipients).toBe(0);
    await finish(w, ID(9001), `result_set_at = now() - interval '30 minutes'`);
    const p = await preview(w, a.id);
    expect(p.estimated_recipients).toBe(2);
    await openWindow(w);
    await svc(w.db, `public.conv_svc_automation_tick()`);
    const got = await claim(w);
    const byName = Object.fromEntries(got.map((g) => [g.body.split(',')[0], g.body]));
    expect(byName['Ana']).toBe('Ana, resultado de Quartas no Circuito de Teste: 6-4 3-6 10-8 (vitória) contra Beto Sócio.');
    expect(byName['Beto']).toBe('Beto, resultado de Quartas no Circuito de Teste: 4-6 6-3 8-10 (derrota) contra Ana Sócia.');
  }, 120000);

  it('resultado alterado depois da varredura: não envia o que já não vale; duplicata de varredura não repete', async () => {
    const w = await world();
    await seed(w);
    await openWindow(w);
    await match(w, ID(9002), ID(8101), ID(8102), U.socioA, U.socioB);
    await finish(w, ID(9002), `status = 'finished', winner_id = '${U.socioA}', winner_registration_id = '${ID(8101)}', score_a = '{6,6}', score_b = '{1,2}', result_set_at = now() - interval '30 minutes'`);
    const a = await resultAutomation(w);
    await activateAnHourAgo(w, a.id);
    expect((await svc<any>(w.db, `public.conv_svc_automation_tick()`)).recipients).toBe(2);
    expect((await svc<any>(w.db, `public.conv_svc_automation_tick()`)).recipients).toBe(0);   // mesma partida, mesma pessoa
    // corrigiram: o vencedor mudou
    await finish(w, ID(9002), `winner_id = '${U.socioB}', winner_registration_id = '${ID(8102)}'`);
    expect(await claim(w)).toEqual([]);
    expect((await recipients(w)).every((r) => r.status === 'skipped' && r.skip_reason === 'RESULTADO_ALTERADO')).toBe(true);
  }, 120000);

  it('convidado sem cadastro, placar incompleto e W.O. são tratados com verdade', async () => {
    const w = await world();
    await seed(w);
    await match(w, ID(9003), ID(8101), ID(8103), U.socioA, null);   // contra convidado
    await finish(w, ID(9003), `status = 'finished', winner_id = '${U.socioA}', winner_registration_id = '${ID(8101)}', score_a = '{6,6}', score_b = '{0,1}', result_set_at = now() - interval '30 minutes'`);
    await match(w, ID(9004), ID(8101), ID(8102), U.socioA, U.socioB, 'Semifinal');
    await finish(w, ID(9004), `status = 'finished', winner_id = '${U.socioA}', winner_registration_id = '${ID(8101)}', result_set_at = now() - interval '30 minutes'`);   // sem placar e sem W.O.
    const a = await resultAutomation(w);
    await activateAnHourAgo(w, a.id);
    const p = await preview(w, a.id);
    expect(p.estimated_recipients).toBe(1);   // só a Ana na partida contra o convidado
    expect(p.excluded_by_reason).toMatchObject({ CONVIDADO_SEM_CADASTRO: 1, PLACAR_INCOMPLETO: 2 });
    // W.O. não precisa de placar e fala "por W.O."
    await finish(w, ID(9004), `is_walkover = true, result_type = 'walkover', walkover_winner_registration_id = '${ID(8101)}', walkover_winner_id = '${U.socioA}'`);
    const p2 = await preview(w, a.id);
    expect(p2.estimated_recipients).toBe(3);
  }, 120000);

  it('avanço: só quando o MOTOR já pôs o vencedor na partida seguinte; nada é inferido', async () => {
    const w = await world();
    await seed(w);
    await match(w, ID(9101), ID(8101), ID(8102), U.socioA, U.socioB, 'Quartas');
    await w.db.exec(`insert into public.matches(id, championship_id, phase, player_a_source_match_id) values ('${ID(9102)}', '${champ}', 'Semifinal', '${ID(9101)}')`);
    await finish(w, ID(9101), `status = 'finished', winner_id = '${U.socioA}', winner_registration_id = '${ID(8101)}', score_a = '{6,6}', score_b = '{2,3}', result_set_at = now() - interval '30 minutes'`);
    const a = await save(w, { name: 'Avanço de fase', source: 'championship_advance', trigger_type: 'event', definition: { championship_id: champ }, schedule: {},
      message_body: 'Parabéns, {{nome}}! Você avançou para {{fase}} no {{campeonato}}. Adversário: {{adversario}}.' });
    await activateAnHourAgo(w, a.id);
    // o motor ainda não preencheu a vaga (trigger não rodou): nada de "avançou"
    const before = await preview(w, a.id);
    expect(before.estimated_recipients).toBe(0);
    expect(before.excluded_by_reason).toMatchObject({ AVANCO_NAO_CONFIRMADO_PELO_MOTOR: 1 });
    // o motor propaga o vencedor
    await w.db.exec(`update public.matches set registration_a_id = '${ID(8101)}', player_a_id = '${U.socioA}' where id = '${ID(9102)}'`);
    const after = await preview(w, a.id);
    expect(after.estimated_recipients).toBe(1);
    expect(after.rendered_example).toBe('Parabéns, Ana! Você avançou para Semifinal no Circuito de Teste. Adversário: a definir.');
    // partida seguinte já iniciada ⇒ não avisa
    await w.db.exec(`update public.matches set status = 'finished' where id = '${ID(9102)}'`);
    expect((await preview(w, a.id)).estimated_recipients).toBe(0);
  }, 120000);

  it('aviso de campeonato: só campeonato ativo; convidado fora; classe filtra', async () => {
    const w = await world();
    await seed(w);
    const a = await save(w, { name: 'Aviso do campeonato', source: 'championship_notice', trigger_type: 'manual', definition: { championship_id: champ },
      schedule: {}, message_body: 'Olá, {{nome}}! Novidade no {{campeonato}} ({{classe}}).' });
    const p = await preview(w, a.id);
    expect(p.estimated_recipients).toBe(2);
    expect(p.excluded_by_reason).toMatchObject({ CONVIDADO_SEM_CADASTRO: 1 });
    expect(p.rendered_example).toMatch(/^Olá, (Ana|Beto)! Novidade no Circuito de Teste \(5ª classe\)\.$/);
    await w.db.exec(`update public.championships set status = 'finished'`);
    const p2 = await preview(w, a.id);
    expect(p2.estimated_recipients).toBe(0);
    expect(p2.excluded_by_reason).toMatchObject({ CAMPEONATO_NAO_ATIVO: 3 });
    // campeonato inexistente: pendência de configuração, não erro
    const b = await save(w, { name: 'Sem campeonato', source: 'championship_notice', trigger_type: 'manual', definition: {}, schedule: {}, message_body: 'Oi {{nome}}' });
    expect(b.problems).toContain('CAMPEONATO_OBRIGATORIO');
  }, 120000);
});
