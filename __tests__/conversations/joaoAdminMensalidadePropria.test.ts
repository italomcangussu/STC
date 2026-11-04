// @vitest-environment node
// Caso Hermeson (03/11): admin e sócio, avisou "quero te enviar meu comprovante da mensalidade de novembro", mandou o Pix
// (R$ 320, para o clube, igual ao devido) e o João perguntou "é para renovar o Card de qual aluno?", depois a categoria do
// caixa e por fim disse que não sabia repassar. Agora o servidor tenta a baixa da mensalidade dele antes de perguntar.
import { describe, expect, it } from 'vitest';
import { beforeModel } from '../../supabase/functions/_shared/aiAgent/turnShortcuts';
import { talksAboutOwnMembership } from '../../supabase/functions/_shared/aiAgent/receiptContext';
import { receiptReceivedMessage } from '../../supabase/functions/_shared/aiAgent/studentCard';

type Call = { name: string; args: Record<string, unknown> };
const lido = { found: true, amount_cents: 32000, paid_on: '2026-11-03', payee: 'Sobral Tenis Clube', payee_ok: true, ocr_status: 'ok' };
const baixa = { applied: true, month: '2026-11-01', charge_type: 'membership', amount_cents: 32000, admin_conversation_id: 'CV-HENRIQUE',
  admin_name: 'Henrique', sender_name: 'Hermeson Veras' };

function fakeDb(answers: Record<string, unknown>) {
  const calls: Call[] = [];
  const db = (name: string, args: Record<string, unknown> = {}) => { calls.push({ name, args }); return Promise.resolve({ data: answers[name] ?? null, error: null }); };
  return { db, calls };
}

function turno(transcript: Record<string, unknown>[], opts: { soMidia: boolean; buffered?: string; auto?: unknown }) {
  const falas: string[] = [];
  const { db, calls } = fakeDb({ conv_svc_ai_admin_receipt: lido, conv_svc_receipt_stage: { id: 'ST', source_message_id: 'M1', status: 'awaiting_purpose' },
    conv_svc_receipt_membership_auto: opts.auto ?? baixa });
  const midia = opts.soMidia ? [{ id: 'M1', kind: 'image' }] : [{ id: 'M2', kind: 'text' }];
  const t = {
    deps: { db, chat: async () => ({ output: '{}' }), uaz: null, sleep: async () => undefined }, isGroup: false, soMidia: opts.soMidia,
    buffered: opts.buffered ?? '', settings: { model: 'm', handoff_keywords: [] }, conversation: 'CONV', session: 'S', sessionMemory: {},
    ultima: midia[0], pendentes: midia,
    ctx: { is_group: false, requester: { profile: { id: 'A1', name: 'Hermeson Veras', is_admin: true } }, transcript },
    entregar: async (b: { text: string }[]) => { falas.push(...b.map((x) => x.text)); return b.length; },
    save: async () => undefined,
    say: async (m: string[], action: string) => { falas.push(...m); return { status: 'replied', action }; },
    transferir: async () => ({ status: 'handoff' }),
  } as never;
  return { t, falas, calls };
}

const avisou = [{ direction: 'inbound', kind: 'text', body: 'Quero te enviar meu comprovante de pagamento da mensalidade de novembro' },
  { direction: 'outbound', kind: 'text', body: 'Pode mandar a imagem ou o PDF por aqui.' }];

describe('admin que também é sócio paga a própria mensalidade', () => {
  it('arquivo sem finalidade não tenta quitar inscrição por coincidência de valor', async () => {
    const { t, calls } = turno([], { soMidia: true });
    await beforeModel(t);
    expect(calls.map(c => c.name)).not.toContain('conv_svc_receipt_championship_auto');
    expect(calls.map(c => c.name)).not.toContain('conv_svc_receipt_membership_auto');
  });
  it('avisou que é a mensalidade dele e mandou o Pix: baixa na hora, sem perguntar do Card', async () => {
    const { t, falas, calls } = turno(avisou, { soMidia: true });
    const r = await beforeModel(t) as { action?: string };
    expect(r.action).toBe('receipt_membership_paid');
    expect(calls.map((c) => c.name)).toContain('conv_svc_receipt_membership_auto');
    expect(falas.join(' ')).toContain('mensalidade de 11/2026');
    expect(falas.join(' ')).not.toContain('Card');
  });

  it('o texto logo depois do arquivo diz que é dele: baixa também', async () => {
    const depois = [...avisou, { direction: 'inbound', kind: 'image', body: '' }, { direction: 'outbound', kind: 'text', body: 'Recebi o comprovante.' }];
    const { t } = turno(depois, { soMidia: false, buffered: 'Referente a mensalidade de novembro de Hermeson Veras' });
    expect((await beforeModel(t) as { action?: string } | null)?.action).toBe('receipt_membership_paid');
  });

  it('comprovante de outro sócio com o mesmo valor não baixa a mensalidade do admin', async () => {
    const outro = [{ direction: 'inbound', kind: 'text', body: 'Vou mandar a mensalidade do Gianmarco' }];
    const { t, calls } = turno(outro, { soMidia: true });
    const r = await beforeModel(t) as { action?: string };
    expect(r.action).toBe('admin_receipt_received');
    expect(calls.map((c) => c.name)).not.toContain('conv_svc_receipt_membership_auto');
  });

  it('valor que não bate: pergunta de qual sócio e mês, nunca do Card', async () => {
    const { t, falas } = turno(avisou, { soMidia: true, auto: { applied: false, reason: 'AMOUNT_MISMATCH' } });
    expect((await beforeModel(t) as { action?: string }).action).toBe('receipt_membership_review');
    expect(falas.join(' ')).toContain('qual sócio');
    expect(falas.join(' ')).not.toContain('Card');
  });
});

describe('talksAboutOwnMembership', () => {
  const fala = (body: string) => [{ direction: 'inbound', body }];
  it.each([
    ['meu comprovante da mensalidade de novembro', true],
    ['Referente a mensalidade de novembro de Hermeson Veras', true],
    ['mensalidade do Gianmarco', false],
    ['meu comprovante do Card do aluno', false],
  ])('%s → %s', (body, esperado) => expect(talksAboutOwnMembership(fala(body), 'Hermeson Veras')).toBe(esperado));
  it('fala do João não conta', () => expect(talksAboutOwnMembership([{ direction: 'outbound', body: 'sua mensalidade' }], 'Hermeson')).toBe(false));
});

it('sem assunto de mensalidade, a pergunta antiga do Card continua', () => {
  expect(receiptReceivedMessage(lido, null)).toContain('Card');
});
