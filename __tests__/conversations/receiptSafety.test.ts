// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { receiptTopic, talksAboutOwnMembership, membershipReference, receiptEvidence, membershipIsForAnother } from '../../supabase/functions/_shared/aiAgent/receiptContext';
import { handleReceiptIntent } from '../../supabase/functions/_shared/aiAgent/receiptIntent';
import { parseReceiptText } from '../../supabase/functions/_shared/financeReceiptOcr';

const inbound = (body: string) => ({ direction: 'inbound', kind: 'text', body });

describe('finalidade e titular do comprovante', () => {
  it.each([
    ['doação para a campanha', 'donation'],
    ['paguei o Card do meu filho', 'card'],
    ['mensalidade de outubro', 'mensalidade'],
    ['inscrição no torneio', 'campeonato'],
    ['renovar minha mensalidade', 'mensalidade'],
    ['renovar minha reserva', null],
    ['mensalidade e inscrição', 'ambiguous'],
  ])('%s → %s', (body, topic) => expect(receiptTopic([inbound(body)])).toBe(topic));

  it('lista genérica do agente não substitui a finalidade dita pela pessoa', () => {
    expect(receiptTopic([inbound('mensalidade de outubro'), { direction: 'outbound', body: 'É mensalidade, Card ou inscrição?' }])).toBe('mensalidade');
  });
  it('pergunta equivocada do agente não redefine a finalidade declarada', () => {
    expect(receiptTopic([inbound('minha mensalidade de novembro'), { direction: 'outbound', body: 'É para renovar o Card de qual aluno?' }])).toBe('mensalidade');
  });
  it.each([
    ['meu comprovante da mensalidade do Gianmarco', false],
    ['paguei a mensalidade do Gianmarco', false],
    ['mensalidade de Hermeson Junior', false],
    ['meu comprovante da mensalidade de novembro de Gianmarco', false],
    ['minha mensalidade de novembro', true],
    ['minha mensalidade do mês de novembro', true],
    ['mensalidade de Hermeson Veras', true],
  ])('titular: %s', (body, own) => expect(talksAboutOwnMembership([inbound(body)], 'Hermeson Veras')).toBe(own));
  it('declaração antiga não vence a correção mais recente', () => {
    expect(talksAboutOwnMembership([inbound('minha mensalidade'), inbound('essa é a mensalidade do Gianmarco')], 'Hermeson Veras')).toBe(false);
  });
  it('caso Thieslley: nome e competência em mensagens separadas mantêm o titular', () => {
    expect(talksAboutOwnMembership([inbound('Isso!\nMensalidade Thieslley Soares\nValor: 320,00'), inbound('É a mensalidade de novembro, só considere aí')], 'Thieslley Soares')).toBe(true);
  });
  it('mensalidade do clube não significa pagamento de terceiro', () => {
    expect(membershipIsForAnother([inbound('Mensalidade do clube')], 'Igor Morais')).toBe(false);
  });
  it('competência em mensagem posterior não apaga o nome de outro sócio', () => {
    expect(membershipIsForAnother([inbound('mensalidade do Gianmarco'), inbound('mensalidade de novembro')], 'Hermeson Veras')).toBe(true);
  });
});

describe('competência declarada', () => {
  it.each([
    ['mensalidade de outubro', '2026-10-01'],
    ['mensalidade de outubro de 2025', '2025-10-01'],
    ['mensalidade 10/2026', '2026-10-01'],
    ['mensalidade deste mês', '2026-11-01'],
    ['mensalidade do mês passado', '2026-10-01'],
  ])('%s', (body, month) => expect(membershipReference([inbound(body)], '2026-11-04')).toEqual({ month, ambiguous: false }));
  it('mais de uma competência precisa de conciliação', () => {
    expect(membershipReference([inbound('mensalidade de outubro e novembro')], '2026-11-04').ambiguous).toBe(true);
  });
  it('resposta curta complementa a competência sem repetir a pergunta', () => {
    expect(membershipReference([inbound('minha mensalidade'), inbound('outubro')], '2026-11-04').month).toBe('2026-10-01');
  });
  it('mês anterior atravessa o ano', () => {
    expect(membershipReference([inbound('mensalidade do mês passado')], '2026-01-04').month).toBe('2025-12-01');
  });
  it('data do Pix não vira competência', () => {
    expect(membershipReference([inbound('mensalidade paga em 04/11/2026')], '2026-11-04').month).toBeNull();
  });
  it('competência inválida nunca permite escolher outra cobrança', () => {
    expect(membershipReference([inbound('mensalidade 13/2026')], '2026-11-04').ambiguous).toBe(true);
  });
});

describe('contexto pertence ao arquivo e ao titular', () => {
  it('comprovante novo não herda o titular do arquivo anterior', () => {
    const evidence = receiptEvidence([inbound('minha mensalidade'), { id: 'old', kind: 'image' }, inbound('mensalidade do Gianmarco'), { id: 'new', kind: 'image' }], { source_message_id: 'new' });
    expect(evidence.map(m => m.body)).not.toContain('minha mensalidade');
    expect(membershipIsForAnother(evidence, 'Hermeson Veras')).toBe(true);
  });
  it('intenção de dias anteriores não decide a baixa de hoje', () => {
    const evidence = receiptEvidence([{ ...inbound('minha mensalidade'), created_at: '2026-10-01T12:00:00Z' }], { source_message_id: 'new', created_at: '2026-11-04T12:00:00Z' });
    expect(evidence).toEqual([]);
  });
});

describe('rota financeira exclusiva', () => {
  it.each(['doação para a campanha', 'Card do meu filho', 'mensalidade e inscrição'])('não tenta baixa de mensalidade por coincidência: %s', async body => {
    const db = vi.fn().mockResolvedValue({ data: { applied: true } });
    await handleReceiptIntent({ stage: { id: 's', source_message_id: 'm', status: 'awaiting_purpose' }, mediaOnly: true,
      text: '', transcript: [inbound(body)], db, chat: null, model: '' });
    expect(db).not.toHaveBeenCalled();
  });
  it('mensalidade recusada não tenta inscrição de mesmo valor', async () => {
    const db = vi.fn().mockResolvedValue({ data: { applied: false, reason: 'AMOUNT_MISMATCH', due_cents: 20000 } });
    const result = await handleReceiptIntent({ stage: { id: 's', source_message_id: 'm', status: 'awaiting_purpose' }, mediaOnly: true,
      text: '', transcript: [inbound('minha mensalidade')], db, chat: null, model: '' });
    expect(db.mock.calls.map(c => c[0])).toEqual(['conv_svc_receipt_membership_auto']);
    expect(result?.messages.join(' ')).toContain('200,00');
  });
  it('sem finalidade, pergunta antes de executar qualquer baixa', async () => {
    const db = vi.fn().mockResolvedValue({ data: { applied: true } });
    const result = await handleReceiptIntent({ stage: { id: 's', source_message_id: 'm', status: 'awaiting_purpose' }, mediaOnly: true,
      text: '', transcript: [], db, chat: null, model: '' });
    expect(result?.action).toBe('receipt_purpose_requested');
    expect(db).not.toHaveBeenCalled();
  });
  it('a finalidade anterior não captura pedido de reserva após comprovante', async () => {
    const db = vi.fn().mockResolvedValue({ data: { applied: true } });
    const chat = vi.fn().mockResolvedValue({ output: '{"action":"unrelated"}' });
    const result = await handleReceiptIntent({ stage: { id: 's', source_message_id: 'm', status: 'awaiting_purpose' }, messageId: 'text', mediaOnly: false,
      text: 'quero reservar uma quadra amanhã', transcript: [inbound('minha mensalidade')], db, chat, model: 'm' });
    expect(result).toBeNull();
    expect(db).not.toHaveBeenCalled();
  });
  it.each(['null', '[]', '{"action":"purpose","purpose_kind":"membership","purpose_detail":{}}'])('saída inválida do classificador: %s', async output => {
    const db = vi.fn();
    const result = await handleReceiptIntent({ stage: { id: 's', source_message_id: 'm', status: 'awaiting_purpose' }, messageId: 'text', mediaOnly: false,
      text: 'é desse pagamento', transcript: [], db, chat: async () => ({ output }), model: 'm' });
    expect(result?.action).toBe('receipt_purpose_unclear');
    expect(db).not.toHaveBeenCalled();
  });
});

describe('evidência de pagamento no OCR', () => {
  it('CNPJ do pagador não é evidência do favorecido', () => {
    expect(parseReceiptText('Origem\nSobral Tenis Clube\nCNPJ: 52.393.541/0001-20\nDestino\nFulano de Tal').payee_document).toBeNull();
  });
  it.each(['Pix agendado', 'Pagamento cancelado', 'Transação não realizada', 'Transferência em processamento'])('%s não é pagamento concluído', status => {
    const result = parseReceiptText(`${status}\nValor pago R$ 200,00\nData 04/11/2026\nFavorecido Sobral Tenis Clube`) as any;
    expect(result.payment_status).not.toBe('completed');
    expect(result.confidence.amount).not.toBe('high');
  });
});
