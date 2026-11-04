// @vitest-environment node
// Caso Hermeson (03/11): admin e sócio, avisou "quero te enviar meu comprovante da mensalidade de novembro", mandou o Pix
// (R$ 320, para o clube, igual ao devido) e o João perguntou "é para renovar o Card de qual aluno?", depois a categoria do
// caixa e por fim disse que não sabia repassar. Agora o servidor tenta a baixa da mensalidade dele antes de perguntar.
import { describe, expect, it } from 'vitest';
import { beforeModel } from '../../supabase/functions/_shared/aiAgent/turnShortcuts';
import { confirmedOwnMembershipMonth, talksAboutOwnMembership } from '../../supabase/functions/_shared/aiAgent/receiptContext';
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

// Caso Ítalo (04/11): mandou só a imagem do Pix de R$ 229 (400 menos 148 + 23 abatidos) e o João perguntou do Card.
describe('admin manda só a imagem e o valor bate com a mensalidade dele', () => {
  const comDica = { ...lido, amount_cents: 22900, paid_on: '2026-11-04', own_membership: { competence_month: '2026-11-01', total_due_cents: 40000, offset_cents: 17100 } };
  const pergunta = 'Recebi o comprovante (R$ 229,00, de 04/11/2026, para Sobral Tenis Clube). É a sua mensalidade de 11/2026? Se for, me confirma que eu dou baixa. Se for outra coisa, me diz o que é.';

  it('pergunta se é a mensalidade dele, não do Card', () => {
    const texto = receiptReceivedMessage(comDica, null);
    expect(texto).toBe(pergunta);
    expect(texto).not.toContain('Card');
  });

  it('conversa sobre Card mantém a pergunta do Card', () => {
    expect(receiptReceivedMessage(comDica, 'card')).toContain('Card');
  });

  it('"sim" depois da pergunta dá baixa na mensalidade do mês perguntado', async () => {
    const conversa = [{ id: 'M1', direction: 'inbound', kind: 'image', body: '' }, { direction: 'outbound', kind: 'text', body: pergunta }];
    const { t, calls } = turno(conversa, { soMidia: false, buffered: 'Sim' });
    expect((await beforeModel(t) as { action?: string } | null)?.action).toBe('receipt_membership_paid');
    const auto = calls.find(c => c.name === 'conv_svc_receipt_membership_auto');
    expect(auto?.args).toMatchObject({ p_context: { month: '2026-11-01', purpose_kind: 'membership' } });
  });

  it('"sim" sem a pergunta antes não dá baixa', async () => {
    const conversa = [{ id: 'M1', direction: 'inbound', kind: 'image', body: '' }, { direction: 'outbound', kind: 'text', body: 'Recebi o comprovante.' }];
    const { t, calls } = turno(conversa, { soMidia: false, buffered: 'sim' });
    await beforeModel(t);
    expect(calls.map(c => c.name)).not.toContain('conv_svc_receipt_membership_auto');
  });
});

describe('confirmedOwnMembershipMonth', () => {
  const q = { direction: 'outbound', body: 'Recebi. É a sua mensalidade de 11/2026? Se for, me confirma.' };
  it.each([['sim', '2026-11-01'], ['É sim!', '2026-11-01'], ['isso mesmo', '2026-11-01'], ['não, é do Card do Pedro', null], ['sim, mas do Gianmarco', null]])(
    '%s → %s', (body, mes) => expect(confirmedOwnMembershipMonth([q, { direction: 'inbound', body }])).toBe(mes));
});

// Conversa real do Ítalo (04/11, 14:14): "É a mensalidade de novembro" e depois "Confirmo"; o João não deu baixa.
describe('admin diz só "é a mensalidade de novembro"', () => {
  const comDica = { ...lido, amount_cents: 22900, own_membership: { competence_month: '2026-11-01' } };
  const conversa = [{ id: 'M1', direction: 'inbound', kind: 'image', body: '' },
    { direction: 'outbound', kind: 'text', body: 'Recebi o comprovante (R$ 229,00). É para renovar o Card de qual aluno? Se for outra coisa, me diz o que é.' }];
  const comLeitura = (buffered: string, transcript = conversa) => {
    const r = turno(transcript, { soMidia: false, buffered });
    const db = (r.t as { deps: { db: (n: string, a?: Record<string, unknown>) => Promise<unknown> } }).deps;
    const original = db.db;
    db.db = (n, a) => n === 'conv_svc_ai_admin_receipt' ? Promise.resolve({ data: comDica, error: null }) : original(n, a);
    return r;
  };

  it('valor bate com a mensalidade dele: dá baixa', async () => {
    const { t, calls } = comLeitura('É a mensalidade de novembro');
    expect((await beforeModel(t) as { action?: string } | null)?.action).toBe('receipt_membership_paid');
    expect(calls.find(c => c.name === 'conv_svc_receipt_membership_auto')?.args).toMatchObject({ p_context: { month: '2026-11-01' } });
  });

  it('"Confirmo" depois de já ter dito a mensalidade: dá baixa', async () => {
    const depois = [...conversa, { direction: 'inbound', kind: 'text', body: 'É a mensalidade de novembro' },
      { direction: 'outbound', kind: 'text', body: 'Confirma essa finalidade para eu encaminhar à conferência?' }];
    const { t } = comLeitura('Confirmo', depois);
    expect((await beforeModel(t) as { action?: string } | null)?.action).toBe('receipt_membership_paid');
  });

  it('valor não bate com a mensalidade dele: não dá baixa', async () => {
    const { t, calls } = turno(conversa, { soMidia: false, buffered: 'É a mensalidade de novembro' });
    await beforeModel(t);
    expect(calls.map(c => c.name)).not.toContain('conv_svc_receipt_membership_auto');
  });
});

// Sem palavra exata: a IA lê o sentido da conversa; na dúvida o João pergunta, sem afirmar.
describe('finalidade do comprovante do admin pelo sentido da conversa', () => {
  const comDica = { ...lido, amount_cents: 22900, own_membership: { competence_month: '2026-11-01' } };
  const conversa = [{ id: 'M1', direction: 'inbound', kind: 'image', body: '' },
    { direction: 'outbound', kind: 'text', body: 'Recebi o comprovante (R$ 229,00).' }];
  const comIa = (buffered: string, verdict: string) => {
    const r = turno(conversa, { soMidia: false, buffered });
    const deps = (r.t as { deps: { db: (n: string, a?: Record<string, unknown>) => Promise<unknown>; chat: unknown } }).deps;
    const original = deps.db;
    deps.db = (n, a) => n === 'conv_svc_ai_admin_receipt' ? Promise.resolve({ data: comDica, error: null }) : original(n, a);
    deps.chat = async () => ({ output: JSON.stringify({ verdict, month: null }) });
    return r;
  };

  it('"pode baixar" (sem a palavra mensalidade): a IA entende e dá baixa', async () => {
    const { t, calls } = comIa('pode baixar, é meu', 'own');
    expect((await beforeModel(t) as { action?: string } | null)?.action).toBe('receipt_membership_paid');
    expect(calls.find(c => c.name === 'conv_svc_receipt_membership_auto')?.args).toMatchObject({ p_context: { month: '2026-11-01' } });
  });

  it('na dúvida pergunta, sem afirmar e sem dar baixa', async () => {
    const { t, falas, calls } = comIa('é aquele lá', 'unclear');
    expect((await beforeModel(t) as { action?: string }).action).toBe('receipt_membership_question');
    expect(falas.join(' ')).toContain('É a sua mensalidade de 11/2026?');
    expect(calls.map(c => c.name)).not.toContain('conv_svc_receipt_membership_auto');
  });

  it('outro assunto: não pergunta da mensalidade', async () => {
    const { t, calls } = comIa('quantas reservas tem hoje?', 'unrelated');
    await beforeModel(t);
    expect(calls.map(c => c.name)).not.toContain('conv_svc_receipt_membership_auto');
  });
});
