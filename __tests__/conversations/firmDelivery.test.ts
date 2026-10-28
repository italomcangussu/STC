// @vitest-environment node
// Caso Romário (28/10): o PDF confirmou a inscrição, mas ele mandou uma pergunta enquanto o comprovante era lido e a
// guarda "esta ainda é a última mensagem?" calou a confirmação. O aviso firme sai mesmo assim; só a equipe assumir para.
import { describe, expect, it } from 'vitest';
import { turnDelivery } from '../../supabase/functions/_shared/aiAgent/turnDelivery';

function delivery({ latest, stillActive }: { latest: boolean; stillActive: boolean }) {
  const sent: string[] = [];
  const db = async (name: string, args: Record<string, unknown> = {}) => {
    if (name === 'conv_svc_queue_message') return { data: [{ message_id: 'Q', destination: '558500000000' }], error: null };
    if (name === 'conv_svc_finish_message') return { data: null, error: null };
    return { data: null, error: null, args };
  };
  const uaz = async (req: { body?: Record<string, unknown> }) => { sent.push(String(req.body?.text ?? '')); return { ok: true, status: 200, body: { id: 'P' } }; };
  const d = turnDelivery({
    deps: { db, uaz, sleep: async () => undefined } as never, conversation: 'C', session: 'S', isGroup: false, replyTo: undefined,
    latest: async () => latest, stillActive: async () => stillActive,
  });
  return { d, sent };
}
const bolhas = [{ text: '✅ Inscrição confirmada', delayMs: 0 }, { text: '🧾 Comprovante conferido', delayMs: 0 }];

describe('aviso firme do que o servidor já fez', () => {
  it('a pessoa mandou outra mensagem no meio: a fala comum para', async () => {
    const { d, sent } = delivery({ latest: false, stillActive: true });
    expect(await d.entregar(bolhas)).toBe(0);
    expect(sent).toHaveLength(0);
  });
  it('mas a confirmação firme sai inteira', async () => {
    const { d, sent } = delivery({ latest: false, stillActive: true });
    expect(await d.entregar(bolhas, { firme: true })).toBe(2);
    expect(sent.join(' ')).toContain('Inscrição confirmada');
  });
  it('a equipe assumiu: nem a firme sai', async () => {
    const { d } = delivery({ latest: false, stillActive: false });
    expect(await d.entregar(bolhas, { firme: true })).toBe(0);
  });
});
