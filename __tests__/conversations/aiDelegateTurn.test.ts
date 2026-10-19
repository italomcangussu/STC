// @vitest-environment node
// Assessor do professor (outro assistente) de ponta a ponta: o turno REAL contra o SQL REAL. A lista da semana vira UM resumo,
// um "confirmo" grava todas as aulas aceitas, e aviso sem pedido não recebe resposta (sem pingue-pongue entre robôs).
import { describe, expect, it } from 'vitest';
import { ID, U, j, key, pgDb, q, rpc, svc, world } from './sql/harness';
import { runTurn } from '../../supabase/functions/_shared/aiAgent/turn';
import type { Chat } from '../../supabase/functions/_shared/aiAgent/llm';
import type { UazCaller } from '../../supabase/functions/_shared/uazChat';

type W = Awaited<ReturnType<typeof world>>;
const ASSESSOR = '5599900000077';
let n = 0;

const answer = (o: Record<string, unknown>) => JSON.stringify({ messages: [], intent: 'outro', ready: false, customer_confirmed: false, declined: false,
  awaiting: false, transfer: false, handoff_kind: null, handoff_note: null, close: false, slots: {}, ...o });

const script = (...outs: string[]) => {
  const systems: string[] = [];
  const chat: Chat = async (messages) => {
    systems.push(messages[0].content);
    const out = outs.shift();
    if (out === undefined) throw new Error('modelo chamado além do roteiro');
    return { output: out, model: 'teste', usage: null };
  };
  return { chat, systems };
};

const provider = () => {
  const sent: string[] = [];
  const uaz: UazCaller = async ({ path, body }) => {
    if (path === '/send/text') { sent.push(String(body.text)); return { ok: true, body: { messageid: `OUT${++n}` } }; }
    return { ok: true, body: {} };
  };
  return { uaz, sent };
};

const fromAssessor = (w: W, body: string) =>
  svc<any>(w.db, `public.conv_svc_ingest_message(${j({ provider_id: `A${++n}${Math.random()}`, chat_kind: 'direct', phone: ASSESSOR, name: 'João (Assessor)', kind: 'text', body })})`);

async function setup() {
  const w = await world();
  await rpc(w.db, U.admin, `public.conv_save_ai_settings('${key()}', ${j({ active: true, model: 'modelo-de-teste', buffer_seconds: 0, max_turns: 12 })})`);
  await rpc(w.db, U.admin, `public.conv_save_channel('${key()}', ${j({ bot_phone: '5599900000099', ai_direct_enabled: true })})`);
  const [{ seg, futuro }] = await q<{ seg: string; futuro: string }>(w.db,
    `select (conv_private.today() + (8 - extract(isodow from conv_private.today())::int))::text seg, (conv_private.today() + 60)::text futuro`);
  await w.db.exec(`insert into public.non_socio_students(id, name, plan_type, plan_status, master_expiration_date, student_type) values
    ('${ID(720)}', 'José Martins', 'Card Mensal', 'active', '${futuro}', 'regular'),
    ('${ID(721)}', 'Vinícius Alves', 'Card Mensal', 'active', '${futuro}', 'regular')`);
  const first = await fromAssessor(w, 'oi');
  await w.db.exec(`insert into public.conv_contact_delegates(contact_id, principal_profile_id) values ('${first.contact_id}', '${U.prof}')`);
  return { w, seg };
}

const turn = (w: W, messageId: string, chat: Chat, uaz: UazCaller) => runTurn(messageId, { db: pgDb(w.db), chat, uaz, sleep: async () => undefined });
const aulas = (w: W) => q<any>(w.db, `select * from public.reservations where type = 'Aula' order by start_time`);

describe('assessor do professor: aulas em lote', () => {
  it('a semana inteira vira UM resumo (com o motivo de cada recusa) e um "confirmo" grava todas as aceitas', async () => {
    const { w, seg } = await setup();
    const lista = await fromAssessor(w, `Segunda\nJosé Martins — 20h às 20h30\nVinícius — 20h30 às 21h\nJosé Martins — 19h45 às 20h15`);
    const p = provider();
    const m1 = script(answer({ intent: 'aulas_lote', ready: true, slots: { lessons: [
      { date: seg, start: '20:00', end: '20:30', student_names: ['José Martins'] },
      { date: seg, start: '20:30', end: '21:00', student_names: ['Vinícius Alves'] },
      { date: seg, start: '19:45', end: '20:15', student_names: ['José Martins'] },
    ] } }));
    await turn(w, lista.message_id, m1.chat, p.uaz);
    expect(m1.systems[0]).toContain('AULAS EM LOTE');
    expect(m1.systems[0]).toContain('CONVERSA COM OUTRO ASSISTENTE');
    expect(p.sent).toHaveLength(1);
    expect(p.sent[0]).toContain('Posso marcar 2 aulas');
    expect(p.sent[0]).toContain('hora cheia ou meia hora');
    expect(await aulas(w)).toHaveLength(0);

    const sim = await fromAssessor(w, 'Confirmo, pode marcar as duas');
    const m2 = script(answer({ intent: 'aulas_lote', customer_confirmed: true }));
    await turn(w, sim.message_id, m2.chat, p.uaz);
    expect(p.sent[1]).toContain('Pronto: 2 aulas marcadas');
    const gravadas = await aulas(w);
    expect(gravadas).toHaveLength(2);
    expect(gravadas.every((r) => r.creator_id === U.prof && r.professor_id === ID(900))).toBe(true);
  }, 60000);

  it('nome com dúvida vira pergunta ao assessor; o "Confirmo" grava o resto e o "Pronto" lembra o que falta; a resposta ao nome monta a aula', async () => {
    const { w, seg } = await setup();
    const [{ futuro }] = await q<{ futuro: string }>(w.db, `select (conv_private.today() + 60)::text futuro`);
    await w.db.exec(`insert into public.non_socio_students(id, name, plan_type, plan_status, master_expiration_date, student_type) values
      ('${ID(722)}', 'Lucas Rodrigues', 'Card Mensal', 'active', '${futuro}', 'regular')`);
    const p = provider();
    const lista = await fromAssessor(w, `Seg 20:00–20:30 · José Martins\nSeg 20:30–21:00 · Lucas Martins`);
    const m1 = script(answer({ intent: 'aulas_lote', ready: true, slots: { lessons: [
      { date: seg, start: '20:00', end: '20:30', student_names: ['José Martins'] },
      { date: seg, start: '20:30', end: '21:00', student_names: ['Lucas Martins'] },
    ] } }));
    await turn(w, lista.message_id, m1.chat, p.uaz);
    expect(p.sent[0]).toContain('Posso marcar 1 aula');
    expect(p.sent[0]).toContain('Confirme com o professor o nome do aluno');
    expect(p.sent[0]).toContain('Lucas Martins: no STC tem Lucas Rodrigues; é essa pessoa?');
    expect(p.sent[0]).not.toContain('não está cadastrado');

    const ok = await fromAssessor(w, 'Confirmo');
    await turn(w, ok.message_id, script(answer({ intent: 'aulas_lote', customer_confirmed: true })).chat, p.uaz);
    expect(p.sent[1]).toContain('Pronto: 1 aula marcada');
    expect(p.sent[1]).toContain('Lucas Rodrigues; é essa pessoa?');
    expect(await aulas(w)).toHaveLength(1);

    const nome = await fromAssessor(w, 'Sim, é o Lucas Rodrigues');
    await turn(w, nome.message_id, script(answer({ intent: 'aulas_lote', ready: true, slots: { lessons: [
      { date: seg, start: '20:30', end: '21:00', student_names: ['Lucas Rodrigues'] }] } })).chat, p.uaz);
    expect(p.sent[2]).toContain('Posso marcar 1 aula');
    expect(p.sent[2]).toContain('Lucas Rodrigues');
  }, 60000);

  it('aviso sem pedido ("vou confirmar com o professor e te mando") não recebe resposta', async () => {
    const { w } = await setup();
    const aviso = await fromAssessor(w, 'Certo! Vou confirmar com o Prof. os horários e te mando a lista em seguida.');
    const p = provider();
    const m = script(answer({ silent: true }));
    const r = await turn(w, aviso.message_id, m.chat, p.uaz);
    expect(r.status).toBe('skip');
    expect(p.sent).toHaveLength(0);
    const [conv] = await q<{ ai_status: string }>(w.db, `select ai_status from public.conv_conversations where id = '${aviso.conversation_id}'`);
    expect(conv.ai_status).toBe('ai');
  }, 60000);

  it('o assessor nunca é transferido: pedido que a IA não resolve fica com o João', async () => {
    const { w } = await setup();
    const pedido = await fromAssessor(w, 'Qual o CNPJ do clube para a nota fiscal?');
    const p = provider();
    const m = script(answer({ transfer: true, handoff_kind: 'hard', handoff_note: 'pergunta fora do escopo' }));
    await turn(w, pedido.message_id, m.chat, p.uaz);
    const [conv] = await q<{ ai_status: string }>(w.db, `select ai_status from public.conv_conversations where id = '${pedido.conversation_id}'`);
    expect(conv.ai_status).toBe('ai');
    expect(p.sent).toHaveLength(1);
  }, 60000);
});
