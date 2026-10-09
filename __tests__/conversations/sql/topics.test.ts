// @vitest-environment node
/**
 * Continuidade por assunto do João no banco (20261009121500): assunto durável fora da sessão técnica, isolamento por
 * solicitante, escrita atrasada que não sobrescreve, cancelamento que derruba a proposta e guarda de aceite que nunca
 * transforma recusa em autorização.
 */
import { describe, expect, it } from 'vitest';
import { j, key, q, rpc, svc, U, world } from './harness';

type W = Awaited<ReturnType<typeof world>>;
let n = 0;
const ADMIN_PHONE = '99900000001';

async function enable(w: W) {
  await rpc(w.db, U.admin, `public.conv_save_ai_settings('${key()}', ${j({ active: true, model: 'modelo-de-teste' })})`);
  await rpc(w.db, U.admin, `public.conv_save_channel('${key()}', ${j({ ai_direct_enabled: true })})`);
  await rpc(w.db, U.admin, `public.fin_save_account('${key()}', null, null, ${j({ name: 'Banco do clube', kind: 'bank', opening_balance_cents: 0, opening_date: '2020-01-01', is_default_receipts: true })})`);
}
const pause = () => new Promise((r) => setTimeout(r, 15));
const say = async (w: W, phone: string, body: string) => {
  await pause();
  return svc<any>(w.db, `public.conv_svc_ingest_message(${j({ provider_id: `T${++n}${Math.random()}`, chat_kind: 'direct', phone, name: 'Pessoa', kind: 'text', body })})`);
};
async function open(w: W, phone: string) {
  const m = await say(w, phone, 'oi joão');
  const t = await svc<any>(w.db, `public.conv_svc_ai_trigger('${m.message_id}')`);
  return t.session_id as string;
}
const save = (w: W, session: string, memory: unknown, close = false) =>
  svc(w.db, `public.conv_svc_ai_save_turn('${session}', ${j(memory)}::jsonb, 'reply', '{}'::jsonb, true, ${close})`);
const context = (w: W, session: string) => svc<any>(w.db, `public.conv_svc_ai_context('${session}')`);
const accepts = async (w: W, text: string, allowCancel = false) =>
  (await q<{ r: boolean }>(w.db, `select (conv_private.is_confirmation(${j(text)}::jsonb #>> '{}') or conv_private.is_semantic_acceptance(${j(text)}::jsonb #>> '{}', ${allowCancel})) r`))[0].r;

const TOPIC_A = '00000000-0000-4000-8000-00000000a001';
const TOPIC_B = '00000000-0000-4000-8000-00000000b002';
const topic = (o: Record<string, unknown>) => ({
  id: TOPIC_A, intent: 'admin_financeiro', domain: 'admin', status: 'awaiting_data', slots: { fin_action: 'receita', amount: 30 },
  summary: 'Doação de R$ 30 para a ação das crianças', last_question: 'Em qual categoria?', next_step: 'categoria',
  decisions: ['não é Card Mensal'], outcome: null, created_at: '2026-10-08T21:21:00Z', updated_at: '2026-10-08T21:22:00Z', ...o,
});

describe('guarda de aceite no banco (is_confirmation OR is_semantic_acceptance)', () => {
  it('nenhuma recusa, dúvida, adiamento ou condição vira autorização; concordâncias naturais seguras passam', async () => {
    const w = await world();
    for (const recusa of ['Negativo', 'Não', 'Não quero', 'Não precisa', 'Talvez', 'Agora não', 'Sim, mas espera', 'Não, pode deixar',
      'Não confirme', 'pode deixar', 'n', 'nada disso', 'espera aí', 'sim?', 'isso não', 'é outra', 'pode lançar depois', 'cancela', 'nem pensar']) {
      expect([recusa, await accepts(w, recusa)]).toEqual([recusa, false]);
    }
    for (const aceite of ['Sim', 'Isso', 'Isso mesmo', 'Exatamente', 'Perfeito', 'Pode', 'Fechado', 'Correto', 'É essa', 'Pode fazer',
      'Pode lançar', 'Está certo', 'ok', 'lança aí', 'confirmo']) {
      expect([aceite, await accepts(w, aceite)]).toEqual([aceite, true]);
    }
    // Cancelamento só é aceite quando a proposta é de cancelamento.
    expect(await accepts(w, 'sim, pode cancelar')).toBe(false);
    expect(await accepts(w, 'sim, pode cancelar', true)).toBe(true);
  }, 60000);

  it('"isso" antes da proposta não confirma; "negativo" depois não confirma; "pode lançar" grava uma vez só', async () => {
    const w = await world();
    await enable(w);
    const session = await open(w, ADMIN_PHONE);
    const isso = await say(w, ADMIN_PHONE, 'Isso');
    await pause();
    const prop = await svc<any>(w.db, `public.conv_svc_ai_admin_finance_propose('${session}', ${j({ action: 'fin_entry_create', entry_kind: 'revenue', description: 'Doação para a ação das crianças', amount_cents: 3000, category_name: 'Outras receitas' })})`);
    expect(prop.ok).toBe(true);
    const confirm = (msg: string) => svc<any>(w.db, `public.conv_svc_ai_confirm('${prop.proposal_id}', '${msg}')`);

    expect((await confirm(isso.message_id)).ok).toBe(false);
    expect((await confirm((await say(w, ADMIN_PHONE, 'Negativo')).message_id)).ok).toBe(false);
    expect((await confirm((await say(w, ADMIN_PHONE, 'Sim, mas espera')).message_id)).ok).toBe(false);
    expect(await q(w.db, 'select 1 from public.fin_entries')).toHaveLength(0);

    const yes = await say(w, ADMIN_PHONE, 'Pode lançar');
    expect((await confirm(yes.message_id)).ok).toBe(true);
    expect((await confirm(yes.message_id)).replayed).toBe(true);
    expect(await q(w.db, 'select 1 from public.fin_entries')).toHaveLength(1);
  }, 60000);
});

describe('assunto durável (conv_ai_topics)', () => {
  it('sobrevive à expiração da sessão técnica e volta no contexto da sessão nova; o concluído vira resultado resumido', async () => {
    const w = await world();
    await enable(w);
    const s1 = await open(w, ADMIN_PHONE);
    const done = topic({ id: TOPIC_B, status: 'completed', slots: {}, outcome: 'admin_confirmed', summary: 'Despesa de gelo lançada' });
    await save(w, s1, { intent: 'admin_financeiro', topics: [done, topic({})], active_topic_id: TOPIC_A });
    expect(await q(w.db, `select status from public.conv_ai_topics order by id`)).toEqual([{ status: 'awaiting_data' }, { status: 'completed' }]);

    await q(w.db, `update public.conv_ai_sessions set expires_at = now() - interval '1 minute' where id = '${s1}'`);
    await svc(w.db, 'public.conv_svc_ai_expire_sessions()');
    // Dias depois, nada do assunto se perdeu.
    await q(w.db, `update public.conv_ai_topics set updated_at = now() - interval '45 days' where id = '${TOPIC_A}'`);
    const s2 = await open(w, ADMIN_PHONE);
    expect(s2).not.toBe(s1);
    const ctx = await context(w, s2);
    expect(ctx.session.memory).toEqual({});
    expect(ctx.durable_topics).toHaveLength(1);
    expect(ctx.durable_topics[0]).toMatchObject({ id: TOPIC_A, status: 'awaiting_data', slots: { fin_action: 'receita', amount: 30 },
      last_question: 'Em qual categoria?', decisions: ['não é Card Mensal'] });
    expect(ctx.topic_outcomes).toEqual([expect.objectContaining({ id: TOPIC_B, outcome: 'admin_confirmed', summary: 'Despesa de gelo lançada' })]);
  }, 60000);

  it('escrita atrasada não sobrescreve estado mais novo; assunto encerrado não reabre', async () => {
    const w = await world();
    await enable(w);
    const s = await open(w, ADMIN_PHONE);
    await save(w, s, { topics: [topic({ updated_at: '2026-10-08T21:30:00Z', slots: { amount: 30, category_name: 'Outras receitas' } })] });
    await save(w, s, { topics: [topic({ updated_at: '2026-10-08T21:25:00Z', slots: { amount: 99 } })] });
    expect((await q<any>(w.db, `select slots from public.conv_ai_topics`))[0].slots).toEqual({ amount: 30, category_name: 'Outras receitas' });

    await save(w, s, { topics: [topic({ status: 'canceled', updated_at: '2026-10-08T21:31:00Z', close_reason: 'deixou com o financeiro' })] });
    await save(w, s, { topics: [topic({ status: 'awaiting_data', updated_at: '2026-10-08T21:40:00Z' })] });
    expect((await q<any>(w.db, `select status, close_reason from public.conv_ai_topics`))[0]).toEqual({ status: 'canceled', close_reason: 'deixou com o financeiro' });
  }, 60000);

  it('isolamento por solicitante: o assunto de uma pessoa não aparece nem é alterado pela sessão de outra', async () => {
    const w = await world();
    await enable(w);
    const admin = await open(w, ADMIN_PHONE);
    const socio = await open(w, '99900000002');
    await save(w, admin, { topics: [topic({})] });
    await save(w, socio, { topics: [topic({ updated_at: '2026-10-09T10:00:00Z', slots: { amount: 1 } })] });
    expect((await q<any>(w.db, `select slots from public.conv_ai_topics`))[0].slots).toEqual({ fin_action: 'receita', amount: 30 });
    expect((await context(w, socio)).durable_topics).toEqual([]);
  }, 60000);

  it('assunto aguardando confirmação guarda a referência da proposta; cancelar o assunto cancela a proposta', async () => {
    const w = await world();
    await enable(w);
    const s = await open(w, ADMIN_PHONE);
    const prop = await svc<any>(w.db, `public.conv_svc_ai_admin_finance_propose('${s}', ${j({ action: 'fin_entry_create', entry_kind: 'revenue', description: 'Doação', amount_cents: 3000, category_name: 'Outras receitas' })})`);
    await save(w, s, { topics: [topic({ status: 'awaiting_confirmation', updated_at: '2026-10-08T21:23:00Z' })] });
    expect((await q<any>(w.db, `select proposal_id from public.conv_ai_topics`))[0].proposal_id).toBe(prop.proposal_id);

    await save(w, s, { topics: [topic({ status: 'canceled', updated_at: '2026-10-08T21:24:00Z' })] });
    expect((await q<any>(w.db, `select status from public.conv_booking_proposals where id = '${prop.proposal_id}'`))[0].status).toBe('canceled');
    const yes = await say(w, ADMIN_PHONE, 'sim');
    expect((await svc<any>(w.db, `public.conv_svc_ai_confirm('${prop.proposal_id}', '${yes.message_id}')`)).ok).toBe(false);
    expect(await q(w.db, 'select 1 from public.fin_entries')).toHaveLength(0);
  }, 60000);

  it('memória inválida nunca derruba o turno', async () => {
    const w = await world();
    await enable(w);
    const s = await open(w, ADMIN_PHONE);
    await save(w, s, { topics: [{ id: 'nao-e-uuid', status: 'awaiting_data' }, topic({ status: 'qualquer' }), 'lixo'] });
    expect(await q(w.db, `select 1 from public.conv_ai_topics`)).toHaveLength(0);
    expect((await q<any>(w.db, `select turns from public.conv_ai_sessions where id = '${s}'`))[0].turns).toBe(1);
  }, 60000);
});
