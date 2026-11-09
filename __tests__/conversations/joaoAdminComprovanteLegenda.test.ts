// @vitest-environment node
// Caso Henrique (05 a 08/11): "segue o comprovante do aluguel" + PDF no mesmo turno. O servidor leu R$ 3.242,00 com confiança
// alta, mas o modelo não recebia a leitura e perguntava "Qual foi o valor?" (14 vezes em 4 dias).
import { describe, expect, it } from 'vitest';
import { beforeModel } from '../../supabase/functions/_shared/aiAgent/turnShortcuts';
import { receiptJustReadText } from '../../supabase/functions/_shared/aiAgent/promptAdmin';

const lido = { found: true, amount_cents: 324200, paid_on: '2026-11-05', payee: 'MACEL LIMA PONTES', payee_ok: false, ocr_status: 'ok' };

function turno(receipt: unknown) {
  const falas: string[] = [];
  const calls: string[] = [];
  const db = (name: string) => { calls.push(name); return Promise.resolve({ data: name === 'conv_svc_ai_admin_receipt' ? receipt : null, error: null }); };
  const pendentes = [{ id: 'T1', kind: 'text', body: 'João, segue o comprovante de pagamento do aluguel' }, { id: 'D1', kind: 'document', body: '' }];
  const ctx: Record<string, unknown> = { is_group: false, requester: { profile: { id: 'A1', name: 'Henrique Coelho', is_admin: true } }, transcript: [] };
  const t = {
    deps: { db, chat: async () => ({ output: '{}' }), uaz: null, sleep: async () => undefined }, isGroup: false, soMidia: false,
    buffered: 'João, segue o comprovante de pagamento do aluguel', settings: { model: 'm', handoff_keywords: [] }, conversation: 'CONV', session: 'S',
    sessionMemory: {}, ultima: pendentes[1], pendentes, ctx,
    entregar: async (b: { text: string }[]) => { falas.push(...b.map((x) => x.text)); return b.length; },
    save: async () => undefined,
    say: async (m: string[], action: string) => { falas.push(...m); return { status: 'replied', action }; },
    transferir: async () => ({ status: 'handoff' }),
  } as never;
  return { t, ctx, falas, calls };
}

describe('comprovante do admin com legenda no mesmo turno', () => {
  it('a leitura vai para o contexto e o modelo responde', async () => {
    const { t, ctx, calls } = turno(lido);
    expect(await beforeModel(t)).toBeNull();
    expect(calls).toContain('conv_svc_ai_admin_receipt');
    expect(ctx.admin_receipt_read).toEqual(lido);
    const texto = receiptJustReadText(ctx);
    expect(texto).toContain('amount = 3242.00');
    expect(texto).toContain('2026-11-05');
    expect(texto).toContain('NUNCA pergunte o valor');
  });
  it('comprovante já usado: o servidor avisa e não monta lançamento', async () => {
    const { t, falas } = turno({ ...lido, status: 'approved' });
    expect((await beforeModel(t) as { action?: string }).action).toBe('admin_receipt_received');
    expect(falas.join(' ')).toContain('já foi usado');
  });
  it('sem leitura: nada no contexto', async () => {
    const { t, ctx } = turno({ found: false });
    expect(await beforeModel(t)).toBeNull();
    expect(receiptJustReadText(ctx)).toBe('');
  });
});
