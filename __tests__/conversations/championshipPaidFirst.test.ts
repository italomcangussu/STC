// @vitest-environment node
// Caso Bruno (28/10): mandou o PDF do Pix junto com "Quarta classe" e o nome, ANTES de existir a pré-inscrição. O João
// repassou o comprovante ao Henrique como "outra finalidade" e a inscrição nunca foi feita. Agora o comprovante fica
// guardado, o João colhe os dados e, quando a inscrição nasce, confere o Pix na hora e confirma.
import { describe, expect, it } from 'vitest';
import { campeonato } from '../../supabase/functions/_shared/aiAgent/championship';
import { HOLD, tryChampionshipPay } from '../../supabase/functions/_shared/aiAgent/championshipReceipt';
import { handleReceiptIntent } from '../../supabase/functions/_shared/aiAgent/receiptIntent';
import type { DecideInput } from '../../supabase/functions/_shared/aiAgent/decide';
import type { Answer } from '../../supabase/functions/_shared/aiAgent/turnTypes';

type Call = { name: string; args: Record<string, unknown> };
const pago = { applied: true, championship: 'AUGE OPEN', amount_cents: 13000, paid_on: '2026-10-28', confirmed: ['Bruno Farias Cavalcante'], waitlist: [],
  athletes: [{ full_name: 'Bruno Farias Cavalcante', class: '4ª Classe', shirt_size: 'G', city: 'Sobral', phone: '88999680233', status: 'confirmed' }],
  admin_conversation_id: 'CV-HENRIQUE', admin_name: 'Henrique', sender_name: 'Bruno Farias' };
const inscrito = { ok: true, championship: 'AUGE OPEN', price_cents: 13000, pix_key: '52.393.541/0001-20', payee: 'Sobral Tênis Clube',
  signup: { full_name: 'Bruno Farias Cavalcante', class: '4ª Classe', shirt_size: 'G', city: 'Sobral', phone: '88999680233', status: 'pre' },
  my_pending: ['Bruno Farias Cavalcante'], my_pending_total_cents: 13000 };

function fakeDb(answers: Record<string, unknown>) {
  const calls: Call[] = [];
  const db = (name: string, args: Record<string, unknown> = {}) => { calls.push({ name, args }); return Promise.resolve({ data: answers[name] ?? null, error: null }); };
  return { db, calls };
}
const conversa = [
  { direction: 'inbound', kind: 'text', body: 'Já pode se inscrever no torneio de Sobral?' },
  { direction: 'outbound', kind: 'text', body: '💸 *Pix da inscrição:* 52.393.541/0001-20' },
  { direction: 'inbound', kind: 'document', body: '' },
  { direction: 'inbound', kind: 'text', body: 'Quarta classe' },
];

describe('pagou antes de se inscrever', () => {
  it('sem pré-inscrição, numa conversa do torneio: guarda o comprovante', async () => {
    const { db } = fakeDb({ conv_svc_receipt_championship_auto: { applied: false, reason: 'NO_SIGNUP' } });
    expect((await tryChampionshipPay(db, 'ST', 'campeonato'))?.action).toBe(HOLD);
    expect(await tryChampionshipPay(db, 'ST', null)).toBeNull();
  });

  it('PDF junto com a classe e o nome: não vai ao financeiro, o João segue colhendo os dados', async () => {
    const { db, calls } = fakeDb({ conv_svc_receipt_championship_auto: { applied: false, reason: 'NO_SIGNUP' } });
    const r = await handleReceiptIntent({ stage: { id: 'ST', source_message_id: 'PDF', status: 'awaiting_purpose', amount_cents: '13000' }, messageId: 'M2',
      mediaOnly: false, text: 'Quarta classe\nBruno Farias Cavalcante', transcript: conversa, db, chat: async () => ({ output: '{"action":"purpose","purpose_kind":"other","purpose_detail":"Inscrição AUGE Open"}' }), model: 'm' });
    expect(r).toBeNull();
    expect(calls.map((c) => c.name)).not.toContain('conv_svc_receipt_escalate');
  });

  it('a inscrição nasce: confere o comprovante guardado e confirma, em vez de pedir o Pix', async () => {
    const { db, calls } = fakeDb({
      conv_svc_ai_championship_signup: inscrito,
      conv_svc_receipt_stage: { id: 'ST', source_message_id: 'PDF', status: 'awaiting_purpose' },
      conv_svc_receipt_championship_auto: pago,
    });
    const i = { deps: { db, chat: null, uaz: null, sleep: async () => undefined }, session: 'S1', today: '2026-10-28', memory: {}, conversation: 'CV-BRUNO',
      ctx: { is_group: false, requester: { profile: null }, championship: { requester_phone: '88999680233', championships: [] } },
      answer: { intent: 'campeonato', ready: true } as Answer,
      slots: { champ_action: 'inscrever', athlete_name: 'Bruno Farias Cavalcante', athlete_self: true, champ_class: '4', shirt_size: 'G', athlete_city: 'Sobral' },
    } as unknown as DecideInput;
    const d = await campeonato(i, {});
    expect(calls.map((c) => c.name)).toEqual(['conv_svc_ai_championship_signup', 'conv_svc_receipt_stage', 'conv_svc_receipt_championship_auto']);
    expect(d.action).toBe('receipt_championship_paid');
    expect(d.bubbles.join(' ')).toContain('✅ Confirmada');
    expect(d.bubbles.join(' ')).toContain('Comprovante recebido e conferido');
    expect(d.bubbles.join(' ')).not.toContain('Chave Pix');
    expect(d.forward?.admin_conversation_id).toBe('CV-HENRIQUE');
  });

  it('sem comprovante guardado: segue o pedido do Pix de sempre', async () => {
    const { db } = fakeDb({ conv_svc_ai_championship_signup: inscrito, conv_svc_receipt_stage: null });
    const i = { deps: { db, chat: null, uaz: null, sleep: async () => undefined }, session: 'S1', today: '2026-10-28', memory: {}, conversation: 'CV-BRUNO',
      ctx: { is_group: false, requester: { profile: null }, championship: { requester_phone: '88999680233', championships: [] } },
      answer: { intent: 'campeonato', ready: true } as Answer,
      slots: { champ_action: 'inscrever', athlete_name: 'Bruno Farias Cavalcante', athlete_self: true, champ_class: '4', shirt_size: 'G' },
    } as unknown as DecideInput;
    const d = await campeonato(i, {});
    expect(d.action).toBe('champ_signup');
    expect(d.bubbles[0]).toContain('Chave Pix');
  });

  it('administrador sem inscrição pendente: o comprovante dele não vira pedido de dados (segue como despesa)', async () => {
    const { beforeModel } = await import('../../supabase/functions/_shared/aiAgent/turnShortcuts');
    const falas: string[] = [];
    const { db } = fakeDb({ conv_svc_receipt_stage: { id: 'ST', source_message_id: 'M1', status: 'awaiting_purpose' },
      conv_svc_receipt_championship_auto: { applied: false, reason: 'NO_SIGNUP' }, conv_svc_ai_admin_receipt: { found: true, amount_cents: 13000 } });
    const t = {
      deps: { db, chat: async () => ({ output: '{}' }), uaz: null, sleep: async () => undefined }, isGroup: false, soMidia: true, buffered: '',
      settings: { model: 'm', handoff_keywords: [] }, conversation: 'CONV', session: 'S', sessionMemory: {},
      ultima: { id: 'M1', kind: 'document' }, pendentes: [{ id: 'M1', kind: 'document' }],
      ctx: { is_group: false, requester: { profile: { id: 'A1', name: 'Hermeson', is_admin: true, is_member: true } }, transcript: conversa },
      entregar: async (b: { text: string }[]) => { falas.push(...b.map((x) => x.text)); return b.length; },
      save: async () => undefined,
      say: async (m: string[], action: string) => { falas.push(...m); return { status: 'replied', action }; },
    } as never;
    const r = await beforeModel(t);
    expect(r?.action).toBe('admin_receipt_received');
    expect(falas.join(' ')).not.toContain('nome completo do atleta');
  });
});
