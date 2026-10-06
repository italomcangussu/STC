import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
const invoke = vi.fn();
const from = vi.fn();
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), functions: { invoke: (...a: unknown[]) => invoke(...a) }, from: (...a: unknown[]) => from(...a), storage: { from: vi.fn() }, channel: vi.fn(), removeChannel: vi.fn() } }));
vi.mock('../../../lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), functions: { invoke: (...a: unknown[]) => invoke(...a) }, from: (...a: unknown[]) => from(...a), storage: { from: vi.fn() }, channel: vi.fn(), removeChannel: vi.fn() } }));

import {
  ConversationOperationError, describeConversationError, fillTemplate, kindForFile, listInbox, saveQuickReply, sendMessage,
  setConversationMeta, setMentionVerified, toMessage, approveRun, saveAutomation, searchOpenTargets,
} from '@/lib/conversations/api';
import { formatWhatsAppDisplay, maskPhone } from '@/lib/conversations/phone';
import { OperationError } from '@/lib/conversations/edge';

beforeEach(() => { rpc.mockReset(); invoke.mockReset(); from.mockReset(); });

describe('erros em frase (nunca o código cru)', () => {
  it('traduz o código devolvido pela função de borda', () => {
    expect(describeConversationError(new OperationError('WHATSAPP_NOT_CONFIGURED'))).toContain('não está conectado');
    expect(describeConversationError(new OperationError('FORBIDDEN'))).toContain('Só administradores');
    expect(describeConversationError(new OperationError('MESSAGE_NOT_EDITABLE'))).toContain('15 minutos');
    expect(describeConversationError(new OperationError('NETWORK'))).toContain('conexão');
  });

  it('código desconhecido cai no texto genérico, sem mostrar o código', () => {
    const t = describeConversationError(new OperationError('XYZ_INEXISTENTE'));
    expect(t).not.toContain('XYZ');
    expect(t).toContain('Tente de novo');
  });

  it('erro de RPC: acha o código dentro da mensagem do banco', () => {
    expect(describeConversationError({ message: 'AUTOMATION_PAUSED' })).toContain('pausada');
    expect(describeConversationError({ message: 'MENTION_NOT_VERIFIED' })).toContain('verificada');
    expect(describeConversationError({ message: 'CONV_FORBIDDEN', code: '42501' })).toContain('Só administradores');
    expect(describeConversationError({ message: 'permission denied', code: '42501' })).toContain('Só administradores');
  });

  it('quem não é administrador recebe a explicação de acesso, não um erro técnico', () => {
    const msg = describeConversationError({ code: '42501', message: 'CONV_FORBIDDEN' });
    expect(msg).toMatch(/administradores/i);
    expect(msg).not.toMatch(/42501|CONV_FORBIDDEN/);
  });
});

describe('leitura e RPCs', () => {
  it('listInbox usa conv_inbox com filtro, busca e teto', async () => {
    rpc.mockResolvedValue({ data: [{ id: 'c1' }], error: null });
    expect(await listInbox('groups', '  maria ')).toEqual([{ id: 'c1' }]);
    expect(rpc).toHaveBeenCalledWith('conv_inbox', { p_filter: 'groups', p_search: 'maria', p_limit: 150 });
  });

  it('erro do banco sobe como exceção', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'CONV_FORBIDDEN', code: '42501' } });
    await expect(listInbox('open', '')).rejects.toMatchObject({ code: '42501' });
  });

  it('setConversationMeta manda só o que mudou', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await setConversationMeta('c1', { tags: ['vip'] });
    expect(rpc).toHaveBeenLastCalledWith('conv_set_meta', { p_conversation: 'c1', p: { tags: ['vip'] } });
    await setConversationMeta('c1', { assignedTo: null });
    expect(rpc).toHaveBeenLastCalledWith('conv_set_meta', { p_conversation: 'c1', p: { assigned_to: null } });
  });

  it('operações com idempotência levam uma chave nova a cada ação', async () => {
    rpc.mockResolvedValue({ data: { run_id: 'r', queued: 3 }, error: null });
    await approveRun('r');
    await approveRun('r');
    const chaves = rpc.mock.calls.map((c) => (c[1] as { p_request: string }).p_request);
    expect(chaves[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(chaves[0]).not.toBe(chaves[1]);
  });

  it('saveAutomation envia o corpo completo e devolve as pendências do banco', async () => {
    rpc.mockResolvedValue({ data: { id: 'a1', version: 1, problems: ['MENSAGEM_VAZIA'] }, error: null });
    const r = await saveAutomation(null, { name: 'Teste', source: 'audience', trigger_type: 'manual', definition: { audience: 'members' }, schedule: {}, message_body: '' });
    expect(r.problems).toEqual(['MENSAGEM_VAZIA']);
    expect(rpc).toHaveBeenCalledWith('conv_save_automation', expect.objectContaining({ p_id: null, p: expect.objectContaining({ source: 'audience' }) }));
  });

  it('marcar a menção como verificada passa pelo RPC (o banco confere a identidade da conta)', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await setMentionVerified(true);
    expect(rpc).toHaveBeenCalledWith('conv_set_mention_verified', { p_verified: true });
  });

  it('atalho de resposta rápida duplicado vira frase', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'dup' } });
    await expect(saveQuickReply({ shortcut: 'ola', title: 't', body: 'b' })).rejects.toThrow('Já existe uma resposta com esse atalho.');
  });
});

describe('função de borda (conversation-operations)', () => {
  it('sendMessage envia a ação com a chave de idempotência e devolve a mensagem', async () => {
    invoke.mockResolvedValue({ data: { message: { id: 'm1', status: 'sent' } }, error: null });
    const r = await sendMessage({ conversationId: 'c1', idempotencyKey: 'k1', body: 'oi' });
    expect(r).toEqual({ id: 'm1', status: 'sent' });
    expect(invoke).toHaveBeenCalledWith('conversation-operations', { body: expect.objectContaining({ action: 'send', conversationId: 'c1', idempotencyKey: 'k1', kind: 'text', body: 'oi' }) });
  });

  it('abre o corpo do erro HTTP e expõe só o código', async () => {
    const resposta = new Response(JSON.stringify({ error: 'WHATSAPP_SEND_FAILED' }), { status: 502 });
    invoke.mockResolvedValue({ data: null, error: { message: 'Edge Function returned a non-2xx status code', context: resposta } });
    const erro = await sendMessage({ conversationId: 'c1', idempotencyKey: 'k1', body: 'oi' }).catch((e) => e);
    expect(erro).toBeInstanceOf(ConversationOperationError);
    expect(erro.code).toBe('WHATSAPP_SEND_FAILED');
    expect(erro.message).toBe('WHATSAPP_SEND_FAILED');
    expect(describeConversationError(erro)).toContain('marcada com falha');
  });

  it('sem resposta HTTP é rede', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } });
    const erro = await sendMessage({ conversationId: 'c1', idempotencyKey: 'k1', body: 'oi' }).catch((e) => e);
    expect(erro.code).toBe('NETWORK');
  });
});

describe('mensagem', () => {
  const base = {
    id: 'm1', direction: 'inbound' as const, origin: 'customer' as const, kind: 'text' as const, body: 'oi', status: 'received' as const,
    created_at: '2026-10-06T12:00:00Z', sent_at: null, last_error: null, request_id: null, media_path: null, media_mime: null, media_name: null,
    meta: null, reply_preview: null, reactions: null, edited_at: null, deleted_at: null, provider_message_id: 'p1', mention_direct: null, mention_evidence: null, sender: null,
  };

  it('toMessage preenche padrões e nome de quem falou no grupo', () => {
    const m = toMessage({ ...base, sender: { name: ' Ana ', phone: '5588999990000' }, mention_direct: true, mention_evidence: 'bot_phone' });
    expect(m.senderName).toBe('Ana');
    expect(m.mentionDirect).toBe(true);
    expect(m.mentionEvidence).toBe('bot_phone');
    expect(m.reactions).toEqual({});
    expect(m.meta).toEqual({});
  });

  it('sem nome, usa o telefone', () => {
    expect(toMessage({ ...base, sender: { name: null, phone: '5588999990000' } }).senderName).toBe('+5588999990000');
    expect(toMessage(base).senderName).toBeNull();
  });
});

describe('abrir conversa pelo cadastro', () => {
  it('só devolve quem tem telefone e rotula sócio/aluno', async () => {
    const consulta = (rows: unknown[]) => ({ select: () => ({ ilike: () => ({ not: () => ({ order: () => ({ limit: () => Promise.resolve({ data: rows, error: null }) }) }) }) }) });
    from.mockImplementation((t: string) => t === 'profiles'
      ? consulta([{ id: 'p1', name: 'Maria', phone: '88999990000' }, { id: 'p2', name: 'Sem Fone', phone: '' }])
      : consulta([{ id: 's1', name: 'Mario Aluno', phone: '(88) 98888-0000' }]));
    const r = await searchOpenTargets('mar');
    expect(r.map((x) => [x.name, x.hint])).toEqual([['Maria', 'Sócio'], ['Mario Aluno', 'Aluno']]);
    expect(await searchOpenTargets('m')).toEqual([]);
  });
});

describe('utilidades', () => {
  it('fillTemplate usa o primeiro nome e some se for só número', () => {
    expect(fillTemplate('Olá, {nome}! Tudo bem?', 'Maria da Silva')).toBe('Olá, Maria! Tudo bem?');
    expect(fillTemplate('Olá, {nome}!', '+55 88 99999')).toBe('Olá!');
  });

  it('kindForFile', () => {
    expect(kindForFile(new File([''], 'a.png', { type: 'image/png' }))).toBe('image');
    expect(kindForFile(new File([''], 'a.pdf', { type: 'application/pdf' }))).toBe('document');
    expect(kindForFile(new File([''], 'a.mp3', { type: 'audio/mpeg' }))).toBe('audio');
  });

  it('telefone: máscara e exibição (com e sem DDI; grupo não é telefone)', () => {
    expect(maskPhone('88999990000')).toBe('(88) 99999-0000');
    expect(maskPhone('8899')).toBe('(88) 99');
    expect(formatWhatsAppDisplay('5588999990000')).toBe('(88) 99999-0000');
    expect(formatWhatsAppDisplay('8833334444')).toBe('(88) 3333-4444');
    expect(formatWhatsAppDisplay('120363025246125486@g.us')).toBe('Grupo');
    expect(formatWhatsAppDisplay('')).toBe('');
  });
});
