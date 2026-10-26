// @vitest-environment node
// Campeonato com inscrição pelo João (Serra e Sertão): o servidor inscreve, manda a camisa, define cabeças, sorteia e
// confirma pelo Pix; o prompt leva as informações e as regras só quando há campeonato aberto.
import { describe, expect, it } from 'vitest';
import { campeonato, duplicateMessage, drawMessage, isChampionshipServerAction, keepChampionshipInChat, signupMessage, waitlistMessage } from '../../supabase/functions/_shared/aiAgent/championship';
import { championshipRules, championshipText, phoneBR } from '../../supabase/functions/_shared/aiAgent/championshipPrompt';
import { tryChampionshipPay } from '../../supabase/functions/_shared/aiAgent/championshipReceipt';
import { parseAnswer } from '../../supabase/functions/_shared/aiAgent/answerParse';
import type { DecideInput } from '../../supabase/functions/_shared/aiAgent/decide';
import type { Answer, Slots } from '../../supabase/functions/_shared/aiAgent/turnTypes';

const champ = {
  id: 'C1', name: 'Serra e Sertão 2026', start_date: '2026-11-27', end_date: '2026-11-29', status: 'draft',
  info: 'Jogos em melhor de 3 sets. Se houver 3º set, ele é decidido num tie-break de 7 pontos.', price_cents: 13000,
  shirt_sizes: ['P', 'M', 'G', 'GG'], max_per_class: 16, deadline: '2026-11-24', registration_open: true, shirt_image: null,
  classes: [{ class: '4ª Classe', confirmed: 3, pre: 1, waitlist: 0, spots_left: 13, drawn: false },
    { class: '5ª Classe', confirmed: 16, pre: 0, waitlist: 2, spots_left: 0, drawn: false }],
  mine: [{ full_name: 'Caio Albuquerque', class: '4ª Classe', shirt_size: 'M', city: 'Tianguá', status: 'pre', phone: '88999991001' }],
  admin: null,
};
const pack = (extra: Record<string, unknown> = {}) => ({ requester_phone: '88999991001', is_admin: false, pix_key: '52.393.541/0001-20', payee: 'Sobral Tênis Clube',
  championships: [{ ...champ, ...extra }] });
const atleta = { profile: null };
const admin = { profile: { id: 'A1', name: 'Henrique', is_admin: true, is_member: true } };

type Call = { name: string; args: Record<string, unknown> };
function input(slots: Slots, opts: { requester?: unknown; data?: unknown; isGroup?: boolean; championship?: unknown } = {}) {
  const calls: Call[] = [];
  const db = (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return Promise.resolve({ data: opts.data ?? null, error: null }); };
  const i = {
    deps: { db, chat: null, uaz: null, sleep: async () => undefined }, session: 'S1', today: '2026-10-26', memory: {},
    ctx: { is_group: opts.isGroup ?? false, requester: opts.requester ?? atleta, championship: opts.championship ?? pack() },
    answer: { intent: 'campeonato', ready: true } as Answer, slots,
  } as unknown as DecideInput;
  return { i, calls };
}

describe('prompt do campeonato', () => {
  it('leva as informações, as vagas, o telefone de quem fala e as inscrições dela', () => {
    const t = championshipText({ championship: pack() });
    expect(t).toContain('Serra e Sertão 2026 (27/11/2026 a 29/11/2026)');
    expect(t).toContain('ABERTA até 24/11/2026');
    expect(t).toContain('R$ 130,00 por atleta');
    expect(t).toContain('5ª Classe: 16 confirmados');
    expect(t).toContain('LOTADA');
    expect(t).toContain('tie-break de 7 pontos');
    expect(t).toContain('TELEFONE DE QUEM FALA COM VOCÊ: (88) 99999-1001');
    expect(t).toContain('Caio Albuquerque | 4ª Classe | camisa M | Tianguá');
    expect(t).not.toContain('INSCRITOS CONFIRMADOS');
  });

  it('sem campeonato aberto não acrescenta nada', () => {
    expect(championshipText({ championship: null })).toBe('');
    expect(championshipRules({ championship: null })).toBe('');
  });

  it('as regras de sorteio e cabeças só aparecem para o administrador', () => {
    expect(championshipRules({ championship: pack(), requester: atleta })).not.toContain('"sortear"');
    expect(championshipRules({ championship: pack(), requester: admin })).toContain('"sortear"');
    expect(championshipRules({ championship: pack(), requester: atleta })).toContain('NUNCA transfira');
  });

  it('o modelo devolve a intenção e os dados do atleta', () => {
    const a = parseAnswer(JSON.stringify({ messages: [], intent: 'campeonato', ready: true,
      slots: { champ_action: 'inscrever', athlete_name: 'Davi Torres', athlete_self: false, athlete_phone: '88 98888-0001', champ_class: '5ª', shirt_size: 'gg', athlete_city: 'Tianguá' } }));
    expect(a.intent).toBe('campeonato');
    expect(a.slots).toMatchObject({ champ_action: 'inscrever', athlete_name: 'Davi Torres', athlete_phone: '88 98888-0001', champ_class: '5ª', shirt_size: 'GG' });
    expect(parseAnswer(JSON.stringify({ intent: 'campeonato', slots: { champ_action: 'apagar_tudo' } })).slots.champ_action).toBeNull();
  });

  it('formata o telefone', () => {
    expect(phoneBR('88999991001')).toBe('(88) 99999-1001');
    expect(phoneBR('8833334444')).toBe('(88) 3333-4444');
  });
});

describe('inscrição pelo servidor', () => {
  const dados: Slots = { champ_action: 'inscrever', athlete_name: 'Caio Albuquerque', athlete_self: true, champ_class: '4', shirt_size: 'M', athlete_city: 'Tianguá' };

  it('o próprio atleta: usa o telefone de quem fala e devolve o Pix', async () => {
    const { i, calls } = input(dados, { data: { ok: true, championship: 'Serra e Sertão 2026', price_cents: 13000, pix_key: '52.393.541/0001-20', payee: 'Sobral Tênis Clube',
      signup: { full_name: 'Caio Albuquerque', class: '4ª Classe', shirt_size: 'M', city: 'Tianguá', phone: '88999991001', status: 'pre' },
      my_pending: ['Caio Albuquerque'], my_pending_total_cents: 13000 } });
    const d = await campeonato(i, {});
    expect(calls[0]).toMatchObject({ name: 'conv_svc_ai_championship_signup', args: { p_session: 'S1', p: { phone: '88999991001', class: '4', full_name: 'Caio Albuquerque' } } });
    expect(d.action).toBe('champ_signup');
    expect(d.bubbles[0]).toContain('Classe: 4ª Classe (saibro)');
    expect(d.bubbles[0]).toContain('Pix de R$ 130,00');
    expect(d.bubbles[0]).toContain('52.393.541/0001-20');
    expect(d.memory.slots).toEqual({});
  });

  it('falta dado: pergunta só o que falta, sem chamar o banco', async () => {
    const { i, calls } = input({ champ_action: 'inscrever', athlete_name: 'Davi Torres', athlete_self: false });
    const d = await campeonato(i, {});
    expect(calls).toHaveLength(0);
    expect(d.awaiting).toBe(true);
    expect(d.bubbles[0]).toBe('Para fazer a inscrição, só falta a classe (4ª ou 5ª), o tamanho da camisa e o telefone do atleta (com DDD).');
  });

  it('no grupo, pede para chamar no privado', async () => {
    const { i, calls } = input(dados, { isGroup: true });
    const d = await campeonato(i, {});
    expect(calls).toHaveLength(0);
    expect(d.bubbles[0]).toContain('privado');
  });

  it('duplicado: diz a situação e não inscreve de novo', async () => {
    const { i } = input(dados, { data: { ok: false, code: 'DUPLICATE', same_phone: true, existing: { full_name: 'Caio Albuquerque', class: '4ª Classe', status: 'confirmed' } } });
    const d = await campeonato(i, {});
    expect(d.action).toBe('champ_duplicate');
    expect(d.bubbles[0]).toContain('Caio Albuquerque na 4ª Classe já está com a inscrição confirmada');
  });

  it('dado inválido: repassa a explicação do banco e espera a correção', async () => {
    const { i } = input(dados, { data: { ok: false, code: 'INVALID_SIZE', message: 'Tamanhos da camisa: P, M, G, GG.' } });
    const d = await campeonato(i, {});
    expect(d.awaiting).toBe(true);
    expect(d.bubbles[0]).toBe('Tamanhos da camisa: P, M, G, GG.');
  });

  it('classe cheia: lista de espera, sem pedir Pix', () => {
    const t = waitlistMessage({ championship: 'Serra e Sertão 2026', signup: { full_name: 'Enzo Lima', class: '5ª Classe' } });
    expect(t).toContain('lista de espera');
    expect(t).toContain('Não precisa pagar agora');
  });

  it('várias pendentes: pede um Pix só com o total', () => {
    const t = signupMessage({ championship: 'Serra e Sertão 2026', price_cents: 13000, pix_key: 'K', payee: 'Clube',
      signup: { full_name: 'Davi Torres', class: '5ª Classe', shirt_size: 'GG', phone: '88988880001' }, my_pending: ['Caio Albuquerque', 'Davi Torres'], my_pending_total_cents: 26000 });
    expect(t).toContain('2 inscrições esperando o Pix (Caio Albuquerque, Davi Torres)');
    expect(t).toContain('R$ 260,00');
  });

  it('duplicado pelo telefone avisa', () => {
    expect(duplicateMessage({ same_phone: true, existing: { full_name: 'X Y', status: 'pre' } })).toContain('o telefone informado já está nessa inscrição');
  });
});

describe('camisa, cabeças e sorteio', () => {
  it('sem foto cadastrada, avisa que ainda não chegou', async () => {
    const { i } = input({ champ_action: 'camisa' });
    const d = await campeonato(i, {});
    expect(d.action).toBe('champ_shirt_missing');
    expect(d.files).toBeUndefined();
  });

  it('com foto, manda como imagem', async () => {
    const { i } = input({ champ_action: 'camisa' }, { championship: pack({ shirt_image: { path: 'championships/serra/camisa.jpg', mime: 'image/jpeg', name: 'camisa.jpg' } }) });
    const d = await campeonato(i, {});
    expect(d.files).toEqual([{ path: 'championships/serra/camisa.jpg', name: 'camisa.jpg', mime: 'image/jpeg', caption: '', kind: 'image' }]);
  });

  it('quem não é administrador não define cabeça nem sorteia', async () => {
    for (const action of ['cabecas', 'sortear'] as const) {
      const { i, calls } = input({ champ_action: action, champ_class: '4', seed_names: ['A B'] });
      const d = await campeonato(i, {});
      expect(calls).toHaveLength(0);
      expect(d.action).toBe('champ_forbidden');
    }
  });

  it('administrador define os cabeças na ordem', async () => {
    const { i, calls } = input({ champ_action: 'cabecas', champ_class: '4', seed_names: ['Caio', 'Davi Torres'] },
      { requester: admin, data: { ok: true, class: '4ª Classe', seeds: ['Caio Albuquerque', 'Davi Torres'] } });
    const d = await campeonato(i, {});
    expect(calls[0]).toMatchObject({ name: 'conv_svc_ai_championship_seeds', args: { p: { class: '4', names: ['Caio', 'Davi Torres'] } } });
    expect(d.bubbles[0]).toContain('1. Caio Albuquerque\n2. Davi Torres');
  });

  it('administrador sorteia e vê as oitavas, com quem passa direto', async () => {
    const { i } = input({ champ_action: 'sortear', champ_class: '4' }, { requester: admin, data: { ok: true, class: '4ª Classe', count: 15,
      matches: [{ match: 1, a: 'Caio Albuquerque', b: null, bye: true }, { match: 2, a: 'A', b: 'B', bye: false }] } });
    const d = await campeonato(i, {});
    expect(d.action).toBe('champ_drawn');
    expect(d.verbatim).toBe(true);
    expect(d.bubbles[0]).toContain('1. Caio Albuquerque — passa direto (sem adversário)');
    expect(d.bubbles[0]).toContain('2. A x B');
  });

  it('sem classe, pergunta qual sortear', async () => {
    const { i, calls } = input({ champ_action: 'sortear' }, { requester: admin });
    const d = await campeonato(i, {});
    expect(calls).toHaveLength(0);
    expect(d.bubbles[0]).toContain('Qual classe');
  });

  it('só estas ações são do servidor', () => {
    expect(['inscrever', 'camisa', 'cabecas', 'sortear'].every(isChampionshipServerAction)).toBe(true);
    expect(isChampionshipServerAction('info')).toBe(false);
  });

  it('texto do sorteio', () => {
    expect(drawMessage({ class: '5ª Classe', count: 16, matches: [{ match: 1, a: 'A', b: 'B', bye: false }] })).toContain('Sorteio da 5ª Classe feito ✅ (16 atletas)');
  });
});

describe('não transfere assunto do campeonato', () => {
  const base = { messages: ['Vou confirmar com a organização e te falo.'], intent: 'campeonato', slots: {}, ready: false, customer_confirmed: false,
    declined: false, awaiting: false, transfer: true, handoff_kind: 'hard', handoff_note: 'x', close: false } as Answer;
  it('fala de transferência vira conversa', () => {
    expect(keepChampionshipInChat(base)).toMatchObject({ transfer: false, handoff_kind: null, awaiting: true });
  });
  it('outros assuntos seguem como estavam', () => {
    expect(keepChampionshipInChat({ ...base, intent: 'outro' }).transfer).toBe(true);
  });
});

describe('comprovante do Pix da inscrição', () => {
  const dbOf = (data: unknown) => (name: string) => Promise.resolve({ data: name === 'conv_svc_receipt_championship_auto' ? data : null });

  it('confirmado: responde ao atleta e avisa o financeiro', async () => {
    const r = await tryChampionshipPay(dbOf({ applied: true, championship: 'Serra e Sertão 2026', amount_cents: 26000, confirmed: ['Caio Albuquerque', 'Davi Torres'], waitlist: [],
      admin_conversation_id: 'CV', admin_name: 'Henrique', sender_name: 'Caio' }), 'ST', '');
    expect(r?.action).toBe('receipt_championship_paid');
    expect(r?.messages.join(' ')).toContain('Inscrições confirmadas no Serra e Sertão 2026: Caio Albuquerque e Davi Torres');
    expect(r?.forward?.text).toContain('já lancei a receita com o comprovante');
  });

  it('pago com a classe já cheia: avisa a lista de espera', async () => {
    const r = await tryChampionshipPay(dbOf({ applied: true, championship: 'S', amount_cents: 13000, confirmed: [], waitlist: ['Enzo Lima'] }), 'ST', '');
    expect(r?.messages.join(' ')).toContain('Enzo Lima ficou na lista de espera');
  });

  it('valor que não fecha, com cara de inscrição: explica o total esperado', async () => {
    const r = await tryChampionshipPay(dbOf({ applied: false, reason: 'AMBIGUOUS', amount_cents: 13000, total_cents: 26000,
      pending: [{ name: 'Caio Albuquerque', class: '4ª Classe' }, { name: 'Davi Torres', class: '5ª Classe' }] }), 'ST', '');
    expect(r?.action).toBe('receipt_championship_amount');
    expect(r?.messages[0]).toContain('somam R$ 260,00');
  });

  it('valor de outra coisa, sem conversa de inscrição: segue o fluxo comum do comprovante', async () => {
    const r = await tryChampionshipPay(dbOf({ applied: false, reason: 'AMOUNT_MISMATCH', amount_cents: 15000, total_cents: 13000,
      pending: [{ name: 'Caio Albuquerque', class: '4ª Classe' }] }), 'ST', 'Bom dia!');
    expect(r).toBeNull();
  });

  it('logo depois do pedido de Pix, qualquer valor errado é explicado', async () => {
    const r = await tryChampionshipPay(dbOf({ applied: false, reason: 'AMOUNT_MISMATCH', amount_cents: 15000, total_cents: 13000,
      pending: [{ name: 'Caio Albuquerque', class: '4ª Classe' }] }), 'ST', 'Pré-inscrição feita no Serra e Sertão 2026 ✅');
    expect(r?.action).toBe('receipt_championship_amount');
  });

  it('sem pré-inscrição: não é com ele', async () => {
    expect(await tryChampionshipPay(dbOf({ applied: false, reason: 'NO_SIGNUP' }), 'ST', 'inscrição')).toBeNull();
  });

  it('comprovante repetido: não confirma', async () => {
    const r = await tryChampionshipPay(dbOf({ applied: false, reason: 'DUPLICATE' }), 'ST', '');
    expect(r?.action).toBe('receipt_championship_duplicate');
  });
});
