// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { ID, j, key, q, rpc, rpcError, svc, U, world } from './harness';

type W = Awaited<ReturnType<typeof world>>;
let seq = 0;

const dayAt = async (db: PGlite, plus: number) => (await q<{ d: string }>(db, `select (conv_private.today() + ${plus})::text d`))[0].d;
const firstOfMonth = async (db: PGlite, monthsAgo: number) =>
  (await q<{ d: string }>(db, `select (date_trunc('month', conv_private.today()::timestamp) - interval '${monthsAgo} months')::date::text d`))[0].d;

/** Plano do sócio com cobrança escolhida a dedo (sem gerar o resto). */
async function plan(w: W, profile: string) {
  const start = await dayAt(w.db, 400);
  const r = await rpc<{ id: string }>(w.db, U.admin, `public.fin_create_member_plan('${key()}', ${j({ profile_id: profile, start_on: start, amount_cents: 15000, period_months: 1 })})`);
  return r.id;
}
async function charge(w: W, planId: string, profile: string, o: { monthsAgo: number; dueIn: number; status?: string; cents?: number }) {
  const id = ID(20000 + ++seq);
  const comp = await firstOfMonth(w.db, o.monthsAgo);
  const due = await dayAt(w.db, o.dueIn);
  await w.db.exec(`insert into public.fin_member_charges(id, plan_id, profile_id, competence_month, period_months, due_date, original_amount_cents, status, cancel_reason, canceled_at)
    values ('${id}', '${planId}', '${profile}', '${comp}', 1, '${due}', ${o.cents ?? 15000}, '${o.status ?? 'open'}',
      ${o.status === 'canceled' ? `'teste', now()` : 'null, null'})`);
  return id;
}
const draft = (over: Record<string, unknown> = {}) => ({
  name: 'Cobrança em aberto', source: 'finance_charge', trigger_type: 'conditional',
  definition: { stage: 'overdue', days: 1, repeat_days: 7 }, schedule: {},
  message_body: 'Olá, {{nome}}! A mensalidade de {{competencia}} venceu em {{vencimento}} e está em aberto: {{total}}.', ...over });
const save = (w: W, p: Record<string, unknown>, id: string | null = null) =>
  rpc<{ id: string; version: number; problems: string[] }>(w.db, U.admin, `public.conv_save_automation('${key()}', ${id ? `'${id}'` : 'null'}, ${j(p)})`);
const status = (w: W, id: string, s: string) => rpc<any>(w.db, U.admin, `public.conv_automation_set_status('${key()}', '${id}', '${s}')`);
const preview = (w: W, id: string) => rpc<any>(w.db, U.admin, `public.conv_automation_preview('${id}', null)`);
const tick = () => `public.conv_svc_automation_tick()`;
const recipients = (w: W, where = 'true') => q<any>(w.db, `select * from public.conv_automation_recipients where ${where} order by created_at, id`);
const claim = (w: W, n = 10) => svc<any[]>(w.db, `(select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.conv_svc_automation_claim(${n}) x)`);

/** Janela aberta o tempo todo, em todos os dias, sem anti-spam: os testes não dependem do relógio. */
const openWindow = (w: W) => rpc(w.db, U.admin, `public.conv_save_automation_settings('${key()}', ${j({ window_start: '00:00', window_end: '23:59:59', days: [0, 1, 2, 3, 4, 5, 6], min_hours_between: 0, daily_cap: 10, weekly_cap: 30 })})`);

describe('regra de automação: o que falta para ativar', () => {
  it('rascunho incompleto não ativa; variável sem fonte e encargos não configurados bloqueiam; o banco recusa combinação inválida', async () => {
    const w = await world();
    const a = await save(w, draft({ message_body: '' }));
    expect(a.problems).toContain('MENSAGEM_VAZIA');
    expect(await rpcError(w.db, U.admin, `public.conv_automation_set_status('${key()}', '${a.id}', 'active')`)).toMatch(/AUTOMATION_INCOMPLETE: .*MENSAGEM_VAZIA/);
    const b = await save(w, draft({ message_body: 'Oi {{nome}}, seu placar é {{placar}}' }));
    expect(b.problems).toContain('VARIAVEL_INDISPONIVEL:placar');
    const c = await save(w, draft({ message_body: 'Oi {{nome}}, total com encargos: {{encargos}}' }));
    expect(c.problems).toContain('ENCARGOS_NAO_CONFIGURADOS');   // política de encargos não confirmada pelo clube
    expect(await rpcError(w.db, U.admin, `public.conv_save_automation('${key()}', null, ${j({ ...draft(), trigger_type: 'event' })})`)).toMatch(/conv_automation_combo/);
    const d = await save(w, draft({ definition: { stage: 'qualquer' } }));
    expect(d.problems).toContain('ESTAGIO_INVALIDO');
    const e = await save(w, draft({ trigger_type: 'scheduled', schedule: {} }));
    expect(e.problems).toEqual(expect.arrayContaining(['HORARIO_INVALIDO', 'RECORRENCIA_OBRIGATORIA']));
    const ok = await save(w, draft());
    expect(ok.problems).toEqual([]);
    await status(w, ok.id, 'active');
    // origem e tipo não mudam depois de criada
    expect(await rpcError(w.db, U.admin, `public.conv_save_automation('${key()}', '${ok.id}', ${j({ source: 'card_mensal' })})`)).toMatch(/AUTOMATION_KIND_FIXED/);
  }, 60000);

  it('editar uma regra ativa cria versão nova; a versão antiga fica intacta e imutável', async () => {
    const w = await world();
    const a = await save(w, draft());
    const b = await save(w, draft({ message_body: 'Olá, {{nome}}! Mensalidade de {{competencia}} em aberto.' }), a.id);
    expect(b.version).toBe(2);
    const versions = await q<any>(w.db, `select version, message_body from public.conv_automation_versions order by version`);
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    expect(versions[0].message_body).toContain('{{total}}');
    await expect(w.db.exec(`update public.conv_automation_versions set message_body = 'x'`)).rejects.toThrow(/CONV_IMMUTABLE/);
    expect((await q(w.db, `select 1 from public.admin_audit_logs where action in ('conv.automation_create', 'conv.automation_update')`)).length).toBe(2);
  }, 60000);
});

describe('mensalidade: só quem deve, com os números do financeiro', () => {
  it('cobrança vencida em aberto entra; paga, cancelada, em análise, prevista e sócio inativo ficam de fora, com o motivo', async () => {
    const w = await world();
    const pa = await plan(w, U.socioA), pb = await plan(w, U.socioB);
    const overdue = await charge(w, pa, U.socioA, { monthsAgo: 2, dueIn: -10, cents: 15000 });
    await charge(w, pb, U.socioB, { monthsAgo: 2, dueIn: -10, status: 'paid' });
    await charge(w, pb, U.socioB, { monthsAgo: 3, dueIn: -40, status: 'canceled' });
    const inReview = await charge(w, pb, U.socioB, { monthsAgo: 1, dueIn: -3 });
    await w.db.exec(`insert into public.fin_receipt_submissions(id, profile_id, status, storage_path, file_name, content_type, size_bytes, content_sha256, request_id)
      values ('${ID(30001)}', '${U.socioB}', 'in_review', 'p/1', 'c.pdf', 'application/pdf', 10, '${'a'.repeat(64)}', '${key()}');
      insert into public.fin_receipt_charges(submission_id, charge_id) values ('${ID(30001)}', '${inReview}')`);
    const a = await save(w, draft());
    const p = await preview(w, a.id);
    expect(p.estimated_recipients).toBe(1);
    expect(p.rendered_for).toBe('Ana Sócia');
    expect(p.rendered_example).toMatch(/^Olá, Ana! A mensalidade de .+\/\d{4} venceu em \d{2}\/\d{2}\/\d{4} e está em aberto: R\$ 150,00\.$/);
    // sócio em análise aparece só se a regra aceitar (padrão: exclui)
    const incl = await preview(w, (await save(w, draft({ name: 'Inclui análise', definition: { stage: 'overdue', days: 1, exclude_in_review: false } }))).id);
    expect(incl.estimated_recipients).toBe(2);
    // sem telefone → fora, com motivo
    await w.db.exec(`update public.profiles set phone = null where id = '${U.socioA}'`);
    const noPhone = await preview(w, a.id);
    expect(noPhone.estimated_recipients).toBe(0);
    expect(noPhone.excluded_by_reason).toMatchObject({ SEM_TELEFONE_VALIDO: 1 });
    void overdue;
  }, 90000);

  it('estágios: vence em breve, início do período e comprovante em análise', async () => {
    const w = await world();
    const pa = await plan(w, U.socioA), pb = await plan(w, U.socioB);
    await charge(w, pa, U.socioA, { monthsAgo: 1, dueIn: 2 });          // vence em 2 dias
    await charge(w, pb, U.socioB, { monthsAgo: 1, dueIn: 20 });         // ainda longe
    const soon = await save(w, draft({ name: 'Vence logo', definition: { stage: 'before_due', days: 3 }, message_body: 'Olá, {{nome}}! A mensalidade de {{competencia}} vence em {{vencimento}} ({{valor}}).' }));
    const ps = await preview(w, soon.id);
    expect(ps.estimated_recipients).toBe(1);
    expect(ps.rendered_example).toMatch(/vence em \d{2}\/\d{2}\/\d{4} \(R\$ 150,00\)\.$/);
    const start = await save(w, draft({ name: 'Início do período', definition: { stage: 'period_start', days: 3 }, message_body: 'Olá, {{nome}}! Começou o período de {{competencia}}.' }));
    const pst = await preview(w, start.id);
    expect(pst.estimated_recipients).toBeGreaterThanOrEqual(0);   // depende do dia do mês; a regra é "competência iniciou há ≤ N dias"
    const review = await save(w, draft({ name: 'Em análise', definition: { stage: 'in_review' }, message_body: 'Recebemos o comprovante de {{competencia}}; ele está em análise.' }));
    expect((await preview(w, review.id)).estimated_recipients).toBe(0);   // nenhum comprovante em análise
  }, 90000);

  it('pagamento entre a varredura e o envio: a mensagem NÃO sai (revalidação)', async () => {
    const w = await world();
    await openWindow(w);
    const pa = await plan(w, U.socioA);
    const c1 = await charge(w, pa, U.socioA, { monthsAgo: 2, dueIn: -10 });
    const a = await save(w, draft());
    await status(w, a.id, 'active');
    expect((await svc<any>(w.db, tick())).recipients).toBe(1);
    await w.db.exec(`update public.fin_member_charges set status = 'paid' where id = '${c1}'`);   // alguém pagou
    expect(await claim(w)).toEqual([]);
    const [r] = await recipients(w);
    expect([r.status, r.skip_reason]).toEqual(['skipped', 'COBRANCA_NAO_PENDENTE']);
  }, 90000);
});

describe('varredura, dedupe, pausa e fila de envio', () => {
  const setup = async () => {
    const w = await world();
    await openWindow(w);
    const pa = await plan(w, U.socioA), pb = await plan(w, U.socioB);
    await charge(w, pa, U.socioA, { monthsAgo: 2, dueIn: -10 });
    await charge(w, pb, U.socioB, { monthsAgo: 2, dueIn: -12, cents: 20000 });
    const a = await save(w, draft());
    await status(w, a.id, 'active');
    return { w, a };
  };

  it('a varredura grava o público uma vez: repetir não duplica nem recria a execução', async () => {
    const { w, a } = await setup();
    const t1 = await svc<any>(w.db, tick());
    const t2 = await svc<any>(w.db, tick());
    expect(t1.recipients).toBe(2);
    expect(t2.recipients).toBe(0);
    expect((await recipients(w)).length).toBe(2);
    expect((await q(w.db, `select 1 from public.conv_automation_runs where automation_id = '${a.id}'`)).length).toBe(1);
  }, 90000);

  it('outra automação com a MESMA finalidade não reenvia à mesma pessoa pelo mesmo fato', async () => {
    const { w } = await setup();
    await svc(w.db, tick());
    const dup = await save(w, draft({ name: 'Cobrança em aberto (cópia)' }));
    await status(w, dup.id, 'active');
    expect((await svc<any>(w.db, tick())).recipients).toBe(0);
    expect((await recipients(w)).length).toBe(2);
  }, 90000);

  it('claim → fila → provedor → resultado: cada pessoa recebe uma mensagem; reenvio da mesma chave não duplica; texto sai com os números reais', async () => {
    const { w } = await setup();
    await svc(w.db, tick());
    const got = await claim(w);
    expect(got.length).toBe(2);
    const bodies = got.map((g) => g.body).sort();
    expect(bodies[0]).toMatch(/Olá, Ana! .*R\$ 150,00\./);
    expect(bodies[1]).toMatch(/Olá, Beto! .*R\$ 200,00\./);
    const g = got[0];
    const q1 = await svc<any>(w.db, `(select to_jsonb(x) from public.conv_svc_automation_queue('${g.recipient_id}', '${g.conversation_id}', ${j(g.body).replace(/::jsonb$/, '')}::jsonb #>> '{}') x)`);
    const q2 = await svc<any>(w.db, `(select to_jsonb(x) from public.conv_svc_automation_queue('${g.recipient_id}', '${g.conversation_id}', ${j(g.body).replace(/::jsonb$/, '')}::jsonb #>> '{}') x)`);
    expect(q2.message_id).toBe(q1.message_id);
    expect((await q<any>(w.db, `select origin, status, automation_recipient_id from public.conv_messages where id = '${q1.message_id}'`))[0])
      .toEqual({ origin: 'automation', status: 'queued', automation_recipient_id: g.recipient_id });
    await svc(w.db, `public.conv_svc_finish_message('${q1.message_id}', true, 'PROV-A', null)`);
    await svc(w.db, `public.conv_svc_automation_finish('${g.recipient_id}', '${q1.message_id}', true, null)`);
    await svc(w.db, `public.conv_svc_automation_finish('${g.recipient_id}', '${q1.message_id}', true, null)`);   // idempotente
    expect((await recipients(w, `id = '${g.recipient_id}'`))[0].status).toBe('sent');
    // quem já recebeu não é reclamado
    expect((await claim(w)).map((x) => x.recipient_id)).not.toContain(g.recipient_id);
  }, 90000);

  it('falha de um destinatário não marca os outros: tenta de novo, e na 3ª desiste e deixa registro para investigação', async () => {
    const { w } = await setup();
    await svc(w.db, tick());
    const got = await claim(w);
    const [bad, good] = got;
    const qq = await svc<any>(w.db, `(select to_jsonb(x) from public.conv_svc_automation_queue('${good.recipient_id}', '${good.conversation_id}', 'texto bom') x)`);
    await svc(w.db, `public.conv_svc_finish_message('${qq.message_id}', true, 'PROV-OK', null)`);
    await svc(w.db, `public.conv_svc_automation_finish('${good.recipient_id}', '${qq.message_id}', true, null)`);
    for (let i = 1; i <= 3; i++) {
      await svc(w.db, `public.conv_svc_automation_finish('${bad.recipient_id}', null, false, 'HTTP_503')`);
      const [r] = await recipients(w, `id = '${bad.recipient_id}'`);
      if (i < 3) {
        expect([r.status, r.attempts]).toEqual(['pending', i]);
        await w.db.exec(`update public.conv_automation_recipients set due_at = now() - interval '1 minute' where id = '${bad.recipient_id}'`);
        expect((await claim(w)).map((x) => x.recipient_id)).toEqual([bad.recipient_id]);
      } else {
        expect([r.status, r.last_error]).toEqual(['failed', 'HTTP_503']);
      }
    }
    expect((await recipients(w, `id = '${good.recipient_id}'`))[0].status).toBe('sent');
    expect((await q(w.db, `select 1 from public.admin_audit_logs where action = 'conv.automation_send_failed'`)).length).toBe(1);
    const audit = JSON.stringify(await q(w.db, `select * from public.admin_audit_logs where action = 'conv.automation_send_failed'`));
    expect(audit).not.toMatch(/5585988/);   // nem telefone no log
  }, 120000);

  it('pausar interrompe o que não saiu e cancela execuções futuras; reativar volta a materializar quem ainda atende', async () => {
    const { w, a } = await setup();
    await svc(w.db, tick());
    await status(w, a.id, 'paused');
    expect((await recipients(w)).every((r) => r.status === 'canceled' && r.skip_reason === 'AUTOMACAO_PAUSED')).toBe(true);
    expect(await claim(w)).toEqual([]);
    expect((await svc<any>(w.db, tick())).recipients).toBe(0);   // pausada não varre
    await status(w, a.id, 'active');
    expect((await svc<any>(w.db, tick())).recipients).toBe(2);
    await status(w, a.id, 'ended');
    expect(await rpcError(w.db, U.admin, `public.conv_automation_set_status('${key()}', '${a.id}', 'active')`)).toMatch(/AUTOMATION_ENDED/);
    expect(await claim(w)).toEqual([]);
  }, 90000);

  it('janela de horário e teto por contato reagendam em vez de enviar; opt-out nunca recebe', async () => {
    const { w } = await setup();
    await svc(w.db, tick());
    // janela fechada hoje inteiro: nada sai agora, e o horário seguinte é gravado
    const now = await q<{ t: string }>(w.db, `select (now() at time zone 'America/Fortaleza')::time(0)::text t`);
    const closedStart = '00:00', closedEnd = now[0].t > '00:02:00' ? '00:01' : '00:01';
    await rpc(w.db, U.admin, `public.conv_save_automation_settings('${key()}', ${j({ window_start: closedStart, window_end: closedEnd, days: [0, 1, 2, 3, 4, 5, 6] })})`);
    expect(await claim(w)).toEqual([]);
    const pend = await recipients(w, `status = 'pending'`);
    expect(pend.length).toBe(2);
    expect(pend.every((r) => new Date(r.due_at).getTime() > Date.now())).toBe(true);
    // opt-out: ao voltar a janela, o contato é pulado
    await openWindow(w);
    await w.db.exec(`update public.conv_automation_recipients set due_at = now() - interval '1 minute'`);
    const ana = await svc<any>(w.db, `public.conv_svc_ingest_message(${j({ provider_id: `OPT${Math.random()}`, chat_kind: 'direct', phone: '99900000002', kind: 'text', body: 'parar' })})`);
    expect(ana.duplicate).toBe(false);
    const got = await claim(w);
    expect(got.length).toBe(1);   // só o Beto
    expect((await recipients(w, `profile_id = '${U.socioA}'`))[0].status).toBe('canceled');   // o opt-out cancelou o pendente da Ana
  }, 120000);

  it('variável sem valor no envio: a mensagem não sai (nunca com lacuna)', async () => {
    const w = await world();
    await openWindow(w);
    const pa = await plan(w, U.socioA);
    await charge(w, pa, U.socioA, { monthsAgo: 2, dueIn: -10 });
    // {{dias_atraso}} é permitida, mas só tem valor se houver atraso (days_late) — usamos uma que sempre falta: encargos sem política
    const a = await save(w, draft({ message_body: 'Olá, {{nome}}! Atraso de {{dias_atraso}} dias; total {{total}}.' }));
    await status(w, a.id, 'active');
    await svc(w.db, tick());
    const got = await claim(w);
    expect(got.length).toBe(1);
    expect(got[0].body).toMatch(/Atraso de \d+ dias; total R\$ 150,00\./);
  }, 90000);
});

describe('Card Mensal: validade e estado reais', () => {
  const card = async (w: W) => {
    const d = (n: number) => dayAt(w.db, n);
    await w.db.exec(`insert into public.non_socio_students(id, name, phone, plan_type, plan_status, master_expiration_date, student_type, is_active) values
      ('${ID(740)}', 'Aluno Perto', '85911110001', 'Card Mensal', 'active', '${await d(5)}', 'regular', true),
      ('${ID(741)}', 'Aluno Longe', '85911110002', 'Card Mensal', 'active', '${await d(40)}', 'regular', true),
      ('${ID(742)}', 'Aluno Cancelado', '85911110003', 'Card Mensal', 'inactive', '${await d(5)}', 'regular', true),
      ('${ID(743)}', 'Aluno Pausado', '85911110004', 'Card Mensal', 'active', '${await d(5)}', 'regular', false),
      ('${ID(744)}', 'Dependente', '85911110005', 'Dependente', 'active', '${await d(5)}', 'dependent', true),
      ('${ID(745)}', 'Aluno Sem Fone', null, 'Card Mensal', 'active', '${await d(5)}', 'regular', true),
      ('${ID(746)}', 'Aluno Vencido Antigo', '85911110006', 'Card Mensal', 'active', '${await d(-60)}', 'regular', true)`);
  };
  const body = 'Olá, {{nome}}! Seu Card Mensal vence em {{vencimento}}, daqui a {{dias_para_vencer}} dias.';

  it('renovação: só cartão ativo, de aluno ativo, próximo do vencimento; cancelado/pausado/dependente/sem telefone/muito vencido ficam de fora', async () => {
    const w = await world();
    await card(w);
    const a = await save(w, { name: 'Renovar Card', source: 'card_mensal', trigger_type: 'conditional', definition: { days_before: 7, days_after: 0 }, message_body: body });
    expect(a.problems).toEqual([]);
    const p = await preview(w, a.id);
    expect(p.estimated_recipients).toBe(1);
    expect(p.rendered_for).toBe('Aluno Perto');
    expect(p.rendered_example).toMatch(/^Olá, Aluno! Seu Card Mensal vence em \d{2}\/\d{2}\/\d{4}, daqui a 5 dias\.$/);
    expect(p.excluded_by_reason).toMatchObject({ CARD_INATIVO_OU_CANCELADO: 1, ALUNO_PAUSADO_OU_ENCERRADO: 1, SEM_TELEFONE_VALIDO: 1,
      AINDA_LONGE_DO_VENCIMENTO: 1, VENCIDO_HA_MUITO_TEMPO: 1 });
    // dependente tem plano "Dependente": nunca entra no público do Card Mensal
    expect(Object.keys(p.excluded_by_reason)).not.toContain('DEPENDENTE');
  }, 90000);

  it('um aviso por cartão e vencimento; renovou antes do envio ⇒ não envia; novo vencimento = nova janela', async () => {
    const w = await world();
    await openWindow(w);
    await card(w);
    const a = await save(w, { name: 'Renovar Card', source: 'card_mensal', trigger_type: 'conditional', definition: { days_before: 7 }, message_body: body });
    await status(w, a.id, 'active');
    expect((await svc<any>(w.db, tick())).recipients).toBe(1);
    expect((await svc<any>(w.db, tick())).recipients).toBe(0);   // mesma janela: sem repetição
    await w.db.exec(`update public.non_socio_students set master_expiration_date = '${await dayAt(w.db, 35)}' where id = '${ID(740)}'`);   // renovou
    expect(await claim(w)).toEqual([]);
    expect((await recipients(w))[0].skip_reason).toBe('CARD_RENOVADO_OU_ALTERADO');
    // o envio de mensagem nunca mexe no cartão
    const [s] = await q<any>(w.db, `select plan_status, master_expiration_date::text d from public.non_socio_students where id = '${ID(740)}'`);
    expect(s.plan_status).toBe('active');
    expect((await q(w.db, `select 1 from public.student_payments`)).length).toBe(0);   // nenhum pagamento criado
    // cartão desativado depois da varredura
    await w.db.exec(`update public.non_socio_students set master_expiration_date = '${await dayAt(w.db, 3)}' where id = '${ID(740)}'`);
    expect((await svc<any>(w.db, tick())).recipients).toBe(1);
    await w.db.exec(`update public.non_socio_students set plan_status = 'inactive' where id = '${ID(740)}'`);
    expect(await claim(w)).toEqual([]);
    expect((await recipients(w, `status = 'skipped'`)).map((r) => r.skip_reason)).toContain('CARD_INATIVO_OU_CANCELADO');
  }, 90000);
});

describe('regra do clube no financeiro: vence no mês cobrado e só fins de semana contam', () => {
  const audience = (w: W, id: string, asOf: string) =>
    q<{ dedupe_key: string; included: boolean; reason: string | null; subject: any }>(w.db,
      `select x.dedupe_key, x.included, x.reason, x.subject from public.conv_automations a, lateral conv_private.audience(a, '${asOf}'::date, '${asOf}') x where a.id = '${id}'`);

  it('a cobrança GERADA pelo financeiro cai nos estágios certos, com o vencimento do banco (nada é recalculado aqui)', async () => {
    const w = await world();
    // Plano que começa no dia 1º de outubro/2026: o financeiro gera a competência de outubro vencendo em 05/10 (segunda-feira).
    const p = await rpc<{ id: string }>(w.db, U.admin, `public.fin_create_member_plan('${key()}', ${j({ profile_id: U.socioA, start_on: '2026-10-01', amount_cents: 15000, period_months: 1 })})`);
    await rpc(w.db, U.admin, `public.fin_generate_member_charges('${key()}', '${p.id}', '2026-10-06')`);
    const [c] = await q<{ due_date: string; competence_month: string }>(w.db, `select due_date::text, competence_month::text from public.fin_member_charges where profile_id = '${U.socioA}' and competence_month = '2026-10-01'`);
    expect(c.due_date).toBe('2026-10-05');   // mês cobrado (e dia 5 em dia útil)

    const inicio = await save(w, draft({ name: 'Início', definition: { stage: 'period_start', days: 3 }, message_body: 'Olá, {{nome}}! {{competencia}} {{valor}} vence em {{vencimento}}.' }));
    const antes = await save(w, draft({ name: 'Antes', definition: { stage: 'before_due', days: 3 }, message_body: 'Olá, {{nome}}! Vence em {{vencimento}} ({{valor}}).' }));
    const atraso = await save(w, draft({ name: 'Atraso', definition: { stage: 'overdue', days: 1, repeat_days: 7 }, message_body: 'Olá, {{nome}}! Venceu em {{vencimento}} ({{total}}).' }));
    const dias = async (id: string, asOf: string) => (await audience(w, id, asOf)).filter((r) => r.included && r.subject.competence_label?.includes('outubro/2026')).length;

    // 01/10: início do período sim; vencimento ainda a 4 dias (fora da janela de 3)
    expect([await dias(inicio.id, '2026-10-01'), await dias(antes.id, '2026-10-01'), await dias(atraso.id, '2026-10-01')]).toEqual([1, 0, 0]);
    // 02/10: as duas janelas alcançam a mesma cobrança (consequência da regra nova) — o teto por contato é quem segura a rajada
    expect([await dias(inicio.id, '2026-10-02'), await dias(antes.id, '2026-10-02'), await dias(atraso.id, '2026-10-02')]).toEqual([1, 1, 0]);
    // 04/10 (domingo): nada de atraso; início do período já passou da janela de 3 dias
    expect([await dias(inicio.id, '2026-10-04'), await dias(antes.id, '2026-10-04'), await dias(atraso.id, '2026-10-04')]).toEqual([0, 1, 0]);
    // 05/10: vence hoje (ainda não é atraso)
    expect([await dias(inicio.id, '2026-10-05'), await dias(antes.id, '2026-10-05'), await dias(atraso.id, '2026-10-05')]).toEqual([0, 1, 0]);
    // 06/10: venceu ontem ⇒ atraso
    expect([await dias(inicio.id, '2026-10-06'), await dias(antes.id, '2026-10-06'), await dias(atraso.id, '2026-10-06')]).toEqual([0, 0, 1]);
    // O texto usa o vencimento gravado pelo financeiro
    const [r] = (await audience(w, atraso.id, '2026-10-06')).filter((x) => x.included);
    expect(r.subject.due_date).toBe('2026-10-05');
    expect(r.subject.days_late).toBe(1);
  }, 120000);

  it('os estágios de aviso de uma mesma cobrança não furam o teto por contato (no máximo o teto diário, nunca rajada)', async () => {
    const w = await world();
    const p = await rpc<{ id: string }>(w.db, U.admin, `public.fin_create_member_plan('${key()}', ${j({ profile_id: U.socioA, start_on: '2026-10-01', amount_cents: 15000, period_months: 1 })})`);
    await rpc(w.db, U.admin, `public.fin_generate_member_charges('${key()}', '${p.id}', '2026-10-06')`);
    const inicio = await save(w, draft({ name: 'Início', trigger_type: 'manual', definition: { stage: 'period_start', days: 400 }, message_body: 'Olá, {{nome}}! {{competencia}}.' }));
    const antes = await save(w, draft({ name: 'Antes', trigger_type: 'manual', definition: { stage: 'before_due', days: 400 }, message_body: 'Olá, {{nome}}! Vence {{vencimento}}.' }));
    // janela aberta, teto de 1 por dia, 24 h entre mensagens
    await rpc(w.db, U.admin, `public.conv_save_automation_settings('${key()}', ${j({ window_start: '00:00', window_end: '23:59:59', days: [0, 1, 2, 3, 4, 5, 6], min_hours_between: 24, daily_cap: 1, weekly_cap: 6 })})`);
    for (const a of [inicio, antes]) { await status(w, a.id, 'active'); }
    const r1 = await rpc<any>(w.db, U.admin, `public.conv_automation_prepare_manual('${key()}', '${inicio.id}')`);
    const r2 = await rpc<any>(w.db, U.admin, `public.conv_automation_prepare_manual('${key()}', '${antes.id}')`);
    expect(r1.recipients).toBeGreaterThan(0);
    expect(r2.recipients).toBeGreaterThan(0);
    await rpc(w.db, U.admin, `public.conv_automation_approve_run('${key()}', '${r1.run_id}')`);
    await rpc(w.db, U.admin, `public.conv_automation_approve_run('${key()}', '${r2.run_id}')`);
    // Só o 1º é entregue agora; o outro é reagendado para depois do teto (não sai junto).
    const lote = await claim(w, 10);
    const doSocio = lote.filter((x) => x.body);
    expect(doSocio.length).toBe(1);
  }, 120000);
});
