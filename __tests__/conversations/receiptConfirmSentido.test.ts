// @vitest-environment node
// Confirmação da proposta do comprovante por qualquer palavra ("fechado", "pode", 👍), não só "confirmo".
import { describe, expect, it } from 'vitest';
import { handleReceiptIntent } from '../../supabase/functions/_shared/aiAgent/receiptIntent';

const proposta = 'Vou classificar o comprovante de R$ 50,00 como doação/campanha (campanha). Confirma que essa é a finalidade e autoriza registrar para conferência? Ainda não dei baixa nem alterei o caixa.';
const stage = { id: 'ST', source_message_id: 'M1', status: 'awaiting_confirmation' as const };

function rodar(text: string, intent: string, ultima = proposta) {
  const calls: string[] = [];
  const db = (name: string) => { calls.push(name); return Promise.resolve({ data: { ok: true, status: 'registered', kind: 'donation' }, error: null }); };
  const chat = async () => ({ output: JSON.stringify({ intent }) });
  const transcript = [{ id: 'M1', direction: 'inbound', kind: 'image', body: '' }, { direction: 'outbound', kind: 'text', body: ultima }];
  return { calls, r: handleReceiptIntent({ stage, messageId: 'M2', mediaOnly: false, text, transcript, db, chat, model: 'm' }) };
}

describe('confirmação do comprovante pelo sentido', () => {
  it('"fechado, pode lançar" confirma', async () => {
    const { calls, r } = rodar('fechado, pode lançar', 'yes');
    expect((await r)?.action).toBe('receipt_donation_registered');
    expect(calls).toContain('conv_svc_receipt_confirm');
  });
  it('"não, era do Card" pede a finalidade certa', async () => {
    const { calls, r } = rodar('não era isso, era do card', 'no');
    expect((await r)?.action).toBe('receipt_purpose_correction');
    expect(calls).toContain('conv_svc_receipt_revise');
  });
  it('sim para outra pergunta do João não confirma o comprovante', async () => {
    const { calls } = rodar('pode', 'yes', 'Quer reservar a quadra 2 às 18h?');
    expect(calls).not.toContain('conv_svc_receipt_confirm');
  });
});
