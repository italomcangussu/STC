import { describe, expect, it, vi } from 'vitest';
import { deliverForward, forwardText, type ReceiptForward } from '../../supabase/functions/_shared/aiAgent/receiptForward';
import { handleReceiptIntent } from '../../supabase/functions/_shared/aiAgent/receiptIntent';

const fwd: ReceiptForward = { admin_conversation_id: 'conv-h', admin_name: 'Henrique', sender_name: 'Diego Memória', kind: 'student_card',
  detail: 'Card Mensal de Matheus e José', amount_cents: 30000, paid_on: '2026-10-21', payee: 'Sobral Tenis Clube',
  media_path: 'in/x/pix.jpg', media_mime: 'image/jpeg', media_name: 'pix.jpg', media_kind: 'image' };

describe('João: repasse do comprovante ao financeiro', () => {
  it('o texto diz quem mandou, o que leu, o que a pessoa disse e o próximo passo', () => {
    expect(forwardText(fwd)).toBe('Henrique, Diego Memória mandou este comprovante de R$ 300,00 (pago em 21/10/2026, para Sobral Tenis Clube). Disse que é: Card Mensal de Matheus e José. Quer que eu cadastre ou renove o Card do aluno? Me diga o nome e se é mensalista ou Mensalista Kids.');
    expect(forwardText({ ...fwd, kind: 'membership', detail: 'mensalidade de outubro' })).toMatch(/"pode dar baixa"/);
  });
  it('manda o texto e depois a própria imagem na conversa do financeiro', async () => {
    const db = vi.fn(async (name: string) => (name === 'conv_svc_queue_message' ? { data: [{ message_id: 'm', destination: '5588999990000' }], error: null } : { data: null, error: null }));
    const uaz = vi.fn().mockResolvedValue({ ok: true, body: { id: 'p' } });
    const n = await deliverForward(fwd, { db, uaz, signedUrl: async () => 'https://x/pix.jpg' });
    expect(n).toBe(2);
    expect(uaz.mock.calls[0][0].path).toBe('/send/text');
    expect(uaz.mock.calls[1][0]).toMatchObject({ path: '/send/media', body: { type: 'image', file: 'https://x/pix.jpg' } });
    expect(db.mock.calls.filter((c) => c[0] === 'conv_svc_queue_message').every((c) => (c[1] as { p_conversation: string }).p_conversation === 'conv-h')).toBe(true);
  });
  it('depois que o sócio diz a finalidade, repassa em vez de pedir "confirmo"', async () => {
    const db = vi.fn(async (name: string) => (name === 'conv_svc_receipt_escalate' ? { data: { ok: true, ...fwd } } : { data: { ok: true } }));
    const chat = vi.fn().mockResolvedValue({ output: JSON.stringify({ action: 'purpose', purpose_kind: 'student_card', purpose_detail: 'Card Mensal de Matheus e José' }) });
    const r = await handleReceiptIntent({ stage: { id: 's', source_message_id: 'img', status: 'awaiting_purpose', amount_cents: '30000' },
      messageId: 'txt', mediaOnly: false, text: 'é o card do Matheus e do José', transcript: [], db, chat, model: 'm' });
    expect(r?.action).toBe('receipt_escalated');
    expect(r?.forward?.admin_conversation_id).toBe('conv-h');
    expect(r?.messages[0]).toBe('Obrigado! Passei o comprovante (R$ 300,00) para Henrique, do financeiro, conferir: Card Mensal de Matheus e José. Se precisar de mais alguma coisa, eu te aviso por aqui.');
    expect(db).not.toHaveBeenCalledWith('conv_svc_receipt_purpose', expect.anything());
  });
});

describe('João: época da mensalidade', () => {
  it('comprovante que bate tem baixa: responde ao sócio e avisa o financeiro só por texto', async () => {
    const db = vi.fn(async (name: string) => (name === 'conv_svc_receipt_membership_auto'
      ? { data: { applied: true, month: '2026-11-01', amount_cents: 15000, admin_conversation_id: 'conv-h', admin_name: 'Henrique', sender_name: 'Tiago' } }
      : { data: null }));
    const r = await handleReceiptIntent({ stage: { id: 's', source_message_id: 'img', status: 'awaiting_purpose', amount_cents: '15000' },
      messageId: 'img', mediaOnly: true, text: '', transcript: [], db, chat: null, model: 'm' });
    expect(r?.messages[0]).toBe('Recebi! Sua mensalidade de 11/2026 (R$ 150,00) está registrada como paga. Obrigado!');
    expect(r?.forward?.text).toBe('Henrique, para você saber: a mensalidade de 11/2026 de Tiago (R$ 150,00) chegou pelo WhatsApp e já dei baixa (valor igual ao devido e Pix para o clube).');
    expect(r?.forward?.media_path).toBeUndefined();
  });
  it('não bate: pergunta a que se refere, sem baixa', async () => {
    const db = vi.fn(async () => ({ data: { applied: false, reason: 'AMOUNT_MISMATCH' } }));
    const r = await handleReceiptIntent({ stage: { id: 's', source_message_id: 'img', status: 'awaiting_purpose', amount_cents: '9900' },
      messageId: 'img', mediaOnly: true, text: '', transcript: [], db, chat: null, model: 'm' });
    expect(r?.action).toBe('receipt_purpose_requested');
    expect(r?.messages[0]).toMatch(/referente a quê/);
  });
});
