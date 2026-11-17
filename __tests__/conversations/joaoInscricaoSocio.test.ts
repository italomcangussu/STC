// @vitest-environment node
// Caso Diego (10/11): o clube cobrou a inscrição do AUGE OPEN e ele mandou o Pix um minuto depois. O João leu o
// "pagamento mensalidade novembro" da véspera, tratou como mensalidade e, quando ele disse "Inscrição", prometeu uma
// conferência que nunca foi encaminhada (ele estava inscrito pelo app, sem pré-inscrição pelo WhatsApp).
import { describe, expect, it } from 'vitest';
import { handleReceiptIntent } from '../../supabase/functions/_shared/aiAgent/receiptIntent';
import { receiptEvidence, receiptTopic } from '../../supabase/functions/_shared/aiAgent/receiptContext';

type Call = { name: string; args: Record<string, unknown> };
function fakeDb(answers: Record<string, unknown>) {
  const calls: Call[] = [];
  const db = (name: string, args: Record<string, unknown> = {}) => { calls.push({ name, args }); return Promise.resolve({ data: answers[name] ?? null, error: null }); };
  return { db, calls };
}
const conversa = [
  { id: 'A', direction: 'inbound', kind: 'text', body: 'Pagamento mensalidade novembro', created_at: '2026-11-09T17:47:59Z' },
  { id: 'B', direction: 'outbound', kind: 'text', body: 'Diego, os juros da mensalidade de novembro foram retirados e não há valor em aberto.', created_at: '2026-11-09T18:20:01Z' },
  { id: 'C', direction: 'outbound', kind: 'text', body: 'Diego, não identificamos o pagamento da sua inscrição de R$ 130 no AUGE OPEN. Se já pagou, pode me enviar o comprovante?', created_at: '2026-11-10T12:18:01Z' },
  { id: 'PIX', direction: 'inbound', kind: 'image', body: '', created_at: '2026-11-10T12:19:35Z' },
];
const stage = { id: 'ST', source_message_id: 'PIX', status: 'awaiting_purpose' as const, amount_cents: '13000', created_at: '2026-11-10T12:19:40Z' };
const semPre = { conv_svc_receipt_championship_auto: { applied: false, reason: 'NO_SIGNUP' },
  conv_svc_receipt_escalate: { ok: true, admin_conversation_id: 'CV-HENRIQUE', admin_name: 'Henrique', sender_name: 'Diego Memória' } };

describe('assunto do comprovante', () => {
  it('a cobrança do clube depois de horas de silêncio vale mais que a mensalidade da véspera', () => {
    expect(receiptTopic(receiptEvidence(conversa, stage))).toBe('campeonato');
  });
  it('a pessoa que falou da mensalidade e mandou o Pix horas depois continua sendo mensalidade', () => {
    const t = [{ id: 'A', direction: 'inbound', kind: 'text', body: 'vou pagar a mensalidade de novembro', created_at: '2026-11-09T10:00:00Z' },
      { id: 'PIX', direction: 'inbound', kind: 'image', body: '', created_at: '2026-11-09T19:00:00Z' }];
    expect(receiptTopic(receiptEvidence(t, { source_message_id: 'PIX', created_at: '2026-11-09T19:00:05Z' }))).toBe('mensalidade');
  });
});

describe('inscrição de sócio sem pré-inscrição pelo WhatsApp', () => {
  it('o comprovante vai ao financeiro na hora, com a mídia', async () => {
    const { db, calls } = fakeDb(semPre);
    const r = await handleReceiptIntent({ stage, messageId: 'PIX', mediaOnly: true, text: '', transcript: conversa, db, chat: null, model: 'm', ownName: 'Diego Memória' });
    expect(calls.map((c) => c.name)).toContain('conv_svc_receipt_escalate');
    expect(r?.action).toBe('receipt_escalated');
    expect(r?.messages.join(' ')).toMatch(/Henrique/);
  });
  it('"Inscrição" depois de o João achar que era mensalidade também encaminha, sem o modelo prometer nada', async () => {
    const { db, calls } = fakeDb(semPre);
    const depois = [...conversa, { id: 'R', direction: 'outbound', kind: 'text', body: 'Não encontrei mensalidade em aberto para essa competência e esse sócio.', created_at: '2026-11-10T12:19:56Z' }];
    const r = await handleReceiptIntent({ stage, messageId: 'M2', mediaOnly: false, text: 'Inscrição', transcript: depois, db, chat: null, model: 'm', ownName: 'Diego Memória' });
    expect(r?.action).toBe('receipt_escalated');
    expect(calls.find((c) => c.name === 'conv_svc_receipt_escalate')?.args).toMatchObject({ p_stage: 'ST', p_kind: 'other' });
  });
  it('convidado sem cadastro segue guardando o comprovante até a inscrição nascer (caso Bruno)', async () => {
    const { db, calls } = fakeDb(semPre);
    const r = await handleReceiptIntent({ stage, messageId: 'M2', mediaOnly: false, text: 'Inscrição', transcript: conversa, db, chat: null, model: 'm', ownName: '' });
    expect(r).toBeNull();
    expect(calls.map((c) => c.name)).not.toContain('conv_svc_receipt_escalate');
  });
});
