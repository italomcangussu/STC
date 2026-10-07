import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/components/ui/ConfirmProvider';

const api = vi.hoisted(() => ({
  listInbox: vi.fn(), listMessages: vi.fn(), signMedia: vi.fn(), listQuickReplies: vi.fn(), listStaff: vi.fn(), subscribeInbox: vi.fn(),
  sendMessage: vi.fn(), markConversationRead: vi.fn(), markConversationUnread: vi.fn(), refreshAvatar: vi.fn(), sendPresence: vi.fn(),
  setAiStatus: vi.fn(), setConversationStatus: vi.fn(), listNotes: vi.fn(), listFollowups: vi.fn(), searchPeople: vi.fn(),
  listAutomations: vi.fn(), getAutomationSettings: vi.fn(), setAutomationStatus: vi.fn(), prepareManualRun: vi.fn(), listRuns: vi.fn(),
  listRecipients: vi.fn(), approveRun: vi.fn(), cancelRun: vi.fn(), retryFailed: vi.fn(), previewAutomation: vi.fn(), listChampionshipOptions: vi.fn(),
  getChannel: vi.fn(), listGroups: vi.fn(), aiHealth: vi.fn(), listMentionSamples: vi.fn(), instanceStatus: vi.fn(), setMentionVerified: vi.fn(),
  setAiChannel: vi.fn(), setGroup: vi.fn(), getAiSettings: vi.fn(), listProposals: vi.fn(), saveAiSettings: vi.fn(),
  listMemoryCandidates: vi.fn(), reviewMemoryCandidate: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getUser: () => Promise.resolve({ data: { user: { id: 'admin-1' } } }) }, rpc: vi.fn(), from: vi.fn(), functions: { invoke: vi.fn() }, storage: { from: vi.fn() }, channel: vi.fn(), removeChannel: vi.fn() },
}));
vi.mock('../../../lib/supabase', () => ({
  supabase: { auth: { getUser: () => Promise.resolve({ data: { user: { id: 'admin-1' } } }) }, rpc: vi.fn(), from: vi.fn(), functions: { invoke: vi.fn() }, storage: { from: vi.fn() }, channel: vi.fn(), removeChannel: vi.fn() },
}));
vi.mock('@/lib/conversations/api', async (original) => ({ ...(await original<typeof import('@/lib/conversations/api')>()), ...api }));
vi.mock('@/lib/notifications', () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import { ConversationsHub } from '@/components/conversations/ConversationsHub';
import type { ConversationMessage, ConversationSummary } from '@/lib/conversations/api';

const resumo = (p: Partial<ConversationSummary>): ConversationSummary => ({
  id: 'c1', kind: 'direct', status: 'open', title: 'Maria Souza', destination: '5588999990000', contact_id: 'ct1', group_id: null, avatar_url: null,
  profile_id: 'pr1', profile_name: 'Maria Souza', student_id: null, link_status: 'linked', opt_out: false, last_message_at: '2026-10-06T12:00:00Z',
  last_body: 'Quero uma quadra amanhã', last_message_kind: 'text', last_direction: 'inbound', last_status: 'received', last_origin: 'customer',
  last_deleted: false, unread_count: 2, tags: [], assigned_to: null, assigned_name: null, next_followup_at: null, waiting_since: null,
  ai_status: 'ai', handoff_kind: null, handoff_note: null, handoff_at: null, ai_session_open: false, ...p,
});

const msg = (p: Partial<ConversationMessage>): ConversationMessage => ({
  id: 'm1', direction: 'inbound', origin: 'customer', kind: 'text', body: 'oi', status: 'received', createdAt: '2026-10-06T12:00:00Z', sentAt: null,
  lastError: null, mediaPath: null, mediaMime: null, mediaName: null, meta: {}, replyPreview: null, reactions: {}, editedAt: null, deletedAt: null,
  providerId: 'p1', senderName: null, mentionDirect: false, mentionEvidence: null, ...p,
});

const GRUPO = resumo({ id: 'g1', kind: 'group', title: 'Racha de quinta', destination: '120363025246125486@g.us', contact_id: null, group_id: 'gr1', profile_id: null, profile_name: null, link_status: null, unread_count: 0, last_body: 'bora?' });

/** O diálogo de confirmação é o último `role=dialog` aberto (o `Sheet` também usa StandardModal). */
async function dialogoDeConfirmacao(): Promise<HTMLElement> {
  const todos = await screen.findAllByRole('dialog');
  return todos[todos.length - 1];
}

function montar() {
  return render(<ConfirmProvider><ConversationsHub currentUserId="admin-1" /></ConfirmProvider>);
}

beforeEach(() => {
  localStorage.clear();
  Object.values(api).forEach((f) => f.mockReset());
  api.listInbox.mockResolvedValue([resumo({}), GRUPO]);
  api.listMessages.mockResolvedValue([]);
  api.signMedia.mockResolvedValue(new Map());
  api.listQuickReplies.mockResolvedValue([]);
  api.listStaff.mockResolvedValue([{ id: 'admin-1', name: 'Admin' }]);
  api.subscribeInbox.mockReturnValue(() => undefined);
  api.listNotes.mockResolvedValue([]);
  api.listFollowups.mockResolvedValue([]);
  api.searchPeople.mockResolvedValue([]);
  api.sendMessage.mockResolvedValue({ id: 'new', status: 'sent' });
  api.refreshAvatar.mockResolvedValue(null);
  api.sendPresence.mockResolvedValue(undefined);
  api.markConversationRead.mockResolvedValue(undefined);
  api.markConversationUnread.mockResolvedValue(undefined);
  api.listAutomations.mockResolvedValue([]);
  api.getAutomationSettings.mockResolvedValue({ enabled: true, window_start: '08:00:00', window_end: '20:00:00', days: [1, 2, 3, 4, 5, 6], min_hours_between: 12, daily_cap: 2, weekly_cap: 6, opt_out_keywords: [], updated_at: '' });
  api.listChampionshipOptions.mockResolvedValue([]);
  api.getChannel.mockResolvedValue({ institutional_name: 'STC Institucional', bot_phone: null, bot_lids: [], inbound_token_rotated_at: null, ai_direct_enabled: false, ai_group_enabled: false, mention_verified_at: null, group_session_minutes: 15, version: 1 });
  api.listGroups.mockResolvedValue([]);
  api.aiHealth.mockResolvedValue({ aiConfigured: true, whatsappConfigured: true });
  api.listMentionSamples.mockResolvedValue([]);
  api.instanceStatus.mockResolvedValue({ state: 'connected', qrcode: null, profileName: 'STC Institucional', phone: '5588999990000' });
  api.getAiSettings.mockResolvedValue({ version: 3, active: false, persona_name: 'Assistente do STC', model: '', instructions: '', business_context: '', buffer_seconds: 6, max_turns: 12, handoff_keywords: ['atendente'], daily_turn_budget: 300, proposal_ttl_minutes: 20 });
  api.listProposals.mockResolvedValue([]);
  api.listMemoryCandidates.mockResolvedValue([]);
  api.reviewMemoryCandidate.mockResolvedValue({ id: 'm1', status: 'approved' });
});
afterEach(() => cleanup());

describe('Conversas: navegação', () => {
  it('abre na caixa e oferece as quatro áreas no mesmo módulo', async () => {
    montar();
    const abas = await screen.findAllByRole('tab');
    expect(abas.map((a) => a.textContent)).toEqual(['Conversas', 'Automações', 'IA', 'Canal']);
    expect(await screen.findByText('Maria Souza')).toBeTruthy();
  });

  it('lembra a última área escolhida', async () => {
    const { unmount } = montar();
    fireEvent.click(await screen.findByRole('tab', { name: 'IA' }));
    await screen.findByText('Agente de IA');
    unmount();
    montar();
    expect(await screen.findByText('Agente de IA')).toBeTruthy();
  });
});

describe('Conversas: caixa (um histórico só)', () => {
  it('identifica grupo, vínculo com o cadastro e quem não quer automações', async () => {
    api.listInbox.mockResolvedValue([resumo({ opt_out: true }), GRUPO, resumo({ id: 'c3', title: '+55 88 98888-0000', destination: '5588988880000', profile_id: null, profile_name: null, link_status: 'ambiguous' })]);
    montar();
    await screen.findByText('Racha de quinta');
    expect(screen.getAllByText('Grupo').length).toBeGreaterThan(0);
    expect(screen.getByText('Sócio')).toBeTruthy();
    expect(screen.getByText('Cadastro a confirmar')).toBeTruthy();
    expect(screen.getByText('Não receber automações')).toBeTruthy();
  });

  it('abrir a conversa NÃO marca como lida; mostra IA, automação e menção no mesmo histórico', async () => {
    api.listMessages.mockResolvedValue([
      msg({ id: 'm1', body: '@STC Institucional quero quadra', senderName: 'Ana', mentionDirect: true, mentionEvidence: 'bot_phone' }),
      msg({ id: 'm2', direction: 'outbound', origin: 'ai', body: 'Posso reservar saibro às 18h. Confirma?', status: 'sent' }),
      msg({ id: 'm3', direction: 'outbound', origin: 'automation', body: 'Sua mensalidade vence dia 10', status: 'delivered' }),
      msg({ id: 'm4', senderName: 'Beto', body: 'bora todos', mentionDirect: false, mentionEvidence: 'todos' }),
    ]);
    montar();
    fireEvent.click(await screen.findByText('Racha de quinta'));
    expect(await screen.findByText('Posso reservar saibro às 18h. Confirma?')).toBeTruthy();
    expect(screen.getAllByText('IA').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Automação').length).toBeGreaterThan(0);
    expect(screen.getByText('chamou o STC')).toBeTruthy();
    expect(screen.getByText('sem menção direta')).toBeTruthy();
    expect(screen.getByText('Ana')).toBeTruthy();
    expect(api.markConversationRead).not.toHaveBeenCalled();
    expect(api.listMessages).toHaveBeenCalledWith('g1');
    // aviso de que a resposta vai para o grupo todo
    expect(screen.getByText(/todos os participantes veem/)).toBeTruthy();
  });

  it('enviar texto manda a mensagem com chave de idempotência pela função de borda', async () => {
    montar();
    fireEvent.click(await screen.findByText('Maria Souza'));
    const campo = await screen.findByLabelText(/Mensagem para Maria Souza/);
    fireEvent.change(campo, { target: { value: 'Combinado!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }));
    await waitFor(() => expect(api.sendMessage).toHaveBeenCalledTimes(1));
    expect(api.sendMessage.mock.calls[0][0]).toMatchObject({ conversationId: 'c1', body: 'Combinado!' });
    expect(api.sendMessage.mock.calls[0][0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('falha no provedor aparece em frase e a mensagem fica marcada (nunca "enviada")', async () => {
    const { OperationError } = await import('@/lib/conversations/edge');
    api.sendMessage.mockRejectedValue(new OperationError('WHATSAPP_SEND_FAILED'));
    api.listMessages.mockResolvedValueOnce([]).mockResolvedValue([msg({ id: 'f1', direction: 'outbound', origin: 'staff', body: 'Combinado!', status: 'failed', requestId: 'r1' })]);
    montar();
    fireEvent.click(await screen.findByText('Maria Souza'));
    fireEvent.change(await screen.findByLabelText(/Mensagem para Maria Souza/), { target: { value: 'Combinado!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }));
    expect(await screen.findByText(/não aceitou a mensagem/)).toBeTruthy();
    expect(await screen.findByText(/Não enviada — tentar de novo/)).toBeTruthy();
  });

  it('"digitando…" chega pelo id da conversa (o broadcast do webhook não leva telefone)', async () => {
    let presenca: ((p: { conversationId: string; state: string }) => void) | undefined;
    api.subscribeInbox.mockImplementation((_mudou: unknown, aoDigitar: typeof presenca) => { presenca = aoDigitar; return () => undefined; });
    montar();
    await screen.findByText('Maria Souza');
    act(() => presenca?.({ conversationId: 'c1', state: 'composing' }));
    expect(await screen.findByText(/digitando/i)).toBeTruthy();
    // grupo nunca mostra "digitando"
    act(() => presenca?.({ conversationId: 'g1', state: 'composing' }));
    expect(screen.getAllByText(/digitando/i).length).toBe(1);
  });

  it('erro de acesso vira explicação, não código', async () => {
    api.listInbox.mockRejectedValue({ code: '42501', message: 'CONV_FORBIDDEN' });
    montar();
    expect(await screen.findByText(/Não foi possível carregar as conversas|Só administradores/)).toBeTruthy();
    expect(screen.queryByText(/42501|CONV_FORBIDDEN/)).toBeNull();
  });

  it('assumir a conversa troca quem responde (auditado no banco)', async () => {
    api.setAiStatus.mockResolvedValue(undefined);
    montar();
    fireEvent.click(await screen.findByText('Maria Souza'));
    fireEvent.click(await screen.findByRole('button', { name: /Quem responde: IA atendendo/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Assumir a conversa/ }));
    await waitFor(() => expect(api.setAiStatus).toHaveBeenCalledWith('c1', 'human'));
  });
});

describe('Conversas: automações', () => {
  const auto = (p: Record<string, unknown>) => ({
    id: 'a1', name: 'Mensalidade: aviso de atraso', description: '', objective: '', source: 'finance_charge', trigger_type: 'scheduled',
    definition: { stage: 'overdue' }, schedule: { time: '10:00', weekdays: [1, 2] }, message_body: 'Olá, {{nome}}! {{valor}} em aberto.', status: 'draft', version: 1,
    activated_at: null, updated_at: '2026-10-06T12:00:00Z', problems: [], sent: 0, pending: 0, failed: 0, skipped: 0, last_run_at: null, ...p,
  });

  async function abrirAutomacoes() {
    montar();
    fireEvent.click(await screen.findByRole('tab', { name: 'Automações' }));
  }

  it('mostra a pendência em frase (nunca o código)', async () => {
    api.listAutomations.mockResolvedValue([auto({ problems: ['ENCARGOS_NAO_CONFIGURADOS'] })]);
    await abrirAutomacoes();
    expect(await screen.findByText(/política de multa e juros ainda não foi confirmada/)).toBeTruthy();
    expect(screen.queryByText('ENCARGOS_NAO_CONFIGURADOS')).toBeNull();
  });

  it('ativar passa pelo diálogo de confirmação e chama o RPC', async () => {
    api.listAutomations.mockResolvedValue([auto({})]);
    api.setAutomationStatus.mockResolvedValue({ status: 'active' });
    await abrirAutomacoes();
    await screen.findByText('Mensalidade: aviso de atraso');
    fireEvent.click(screen.getByRole('button', { name: /Ativar/ }));
    expect(api.setAutomationStatus).not.toHaveBeenCalled();
    const dialogo = await dialogoDeConfirmacao();
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Ativar' }));
    await waitFor(() => expect(api.setAutomationStatus).toHaveBeenCalledWith('a1', 'active'));
  });

  it('disparo manual só PREPARA o público: nada é enviado até a aprovação', async () => {
    api.listAutomations.mockResolvedValue([auto({ trigger_type: 'manual', schedule: {}, status: 'active' })]);
    api.prepareManualRun.mockResolvedValue({ run_id: 'r1', recipients: 3 });
    api.listRuns.mockResolvedValue([{ id: 'r1', automation_id: 'a1', version: 1, kind: 'manual', planned_for: '', status: 'review', created_at: '2026-10-06T12:00:00Z', finished_at: null }]);
    api.listRecipients.mockResolvedValue([
      { id: 'x1', run_id: 'r1', display_name: 'Ana', status: 'review', skip_reason: null, attempts: 0, last_error: null, sent_at: null, body: 'Olá, Ana!' },
      { id: 'x2', run_id: 'r1', display_name: 'Beto', status: 'review', skip_reason: null, attempts: 0, last_error: null, sent_at: null, body: 'Olá, Beto!' },
    ]);
    api.approveRun.mockResolvedValue({ run_id: 'r1', queued: 2 });
    await abrirAutomacoes();
    fireEvent.click(await screen.findByRole('button', { name: /Preparar envio/ }));
    await waitFor(() => expect(api.prepareManualRun).toHaveBeenCalledWith('a1'));
    expect(api.approveRun).not.toHaveBeenCalled();
    expect(api.sendMessage).not.toHaveBeenCalled();
    expect((await screen.findAllByText(/Aguardando sua aprovação/)).length).toBeGreaterThan(0);
    fireEvent.click(await screen.findByRole('button', { name: /Aprovar e enviar/ }));
    expect(api.approveRun).not.toHaveBeenCalled();
    const dialogo = await dialogoDeConfirmacao();
    expect(within(dialogo).getByText(/Enviar para 2 pessoas\?/)).toBeTruthy();
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Aprovar e enviar' }));
    await waitFor(() => expect(api.approveRun).toHaveBeenCalledWith('r1'));
  });

  it('prévia mostra quem fica de fora e o motivo em frase', async () => {
    api.listAutomations.mockResolvedValue([auto({ status: 'active' })]);
    api.previewAutomation.mockResolvedValue({ estimated_recipients: 4, excluded_by_reason: { SOCIO_INATIVO: 2, OPT_OUT: 1 }, sample: ['Ana', 'Beto'], rendered_example: 'Olá, Ana! R$ 150,00 em aberto.', rendered_for: 'Ana', problems: [] });
    await abrirAutomacoes();
    fireEvent.click(await screen.findByRole('button', { name: /Prévia/ }));
    expect(await screen.findByText('Sócio inativo')).toBeTruthy();
    expect(screen.getByText('Pediu para não receber')).toBeTruthy();
    expect(screen.getByText('Olá, Ana! R$ 150,00 em aberto.')).toBeTruthy();
  });

  it('o editor recusa variável que a origem não tem, antes de salvar', async () => {
    await abrirAutomacoes();
    fireEvent.click((await screen.findAllByRole('button', { name: /Nova automação/ }))[0]);
    const texto = await screen.findByLabelText('Mensagem');
    fireEvent.change(texto, { target: { value: 'Oi {{nome}}, placar {{placar}}' } });
    expect(await screen.findByText('A variável {{placar}} não existe para este tipo de automação.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Salvar' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Conversas: canal e grupos', () => {
  async function abrirCanal() {
    montar();
    fireEvent.click(await screen.findByRole('tab', { name: 'Canal' }));
    await screen.findByText('Conta institucional');
  }

  it('não deixa marcar a menção como verificada sem identidade da conta, nem ligar a IA em grupos', async () => {
    await abrirCanal();
    const verificar = screen.getByRole('button', { name: /Marcar como verificada/ }) as HTMLButtonElement;
    expect(verificar.disabled).toBe(true);
    const iaGrupos = screen.getByLabelText(/IA atende grupos/) as HTMLInputElement;
    expect(iaGrupos.disabled).toBe(true);
    expect(screen.getByText(/Grupos ficam bloqueados enquanto a menção direta não estiver verificada/)).toBeTruthy();
  });

  it('verificar a menção exige confirmação consciente', async () => {
    api.getChannel.mockResolvedValue({ institutional_name: 'STC Institucional', bot_phone: '5588999990000', bot_lids: [], inbound_token_rotated_at: null, ai_direct_enabled: false, ai_group_enabled: false, mention_verified_at: null, group_session_minutes: 15, version: 1 });
    api.setMentionVerified.mockResolvedValue(undefined);
    await abrirCanal();
    fireEvent.click(screen.getByRole('button', { name: /Marcar como verificada/ }));
    expect(api.setMentionVerified).not.toHaveBeenCalled();
    const dialogo = await dialogoDeConfirmacao();
    expect(within(dialogo).getByText(/mensagens REAIS de um grupo de teste/)).toBeTruthy();
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Já conferi' }));
    await waitFor(() => expect(api.setMentionVerified).toHaveBeenCalledWith(true));
  });

  it('mostra como cada mensagem de grupo foi classificada e os campos que o provedor entregou', async () => {
    api.listMentionSamples.mockResolvedValue([
      { id: 's1', created_at: '2026-10-06T12:00:00Z', mention_direct: true, mention_evidence: 'bot_phone', body: '@STC quero quadra' },
      { id: 's2', created_at: '2026-10-06T12:01:00Z', mention_direct: false, mention_evidence: 'todos', body: '@todos olá' },
    ]);
    api.listGroups.mockResolvedValue([{ id: 'gr1', group_jid: '120363025246125486@g.us', name: 'Racha de quinta', status: 'detected', ai_enabled: false, first_seen_at: '2026-10-06T11:00:00Z', last_seen_at: '2026-10-06T12:00:00Z', events_seen: 4, last_payload_shape: { mentionedJid: 'array' } }]);
    await abrirCanal();
    expect(screen.getByText('@STC quero quadra')).toBeTruthy();
    expect(screen.getByText('@STC quero quadra')).toBeTruthy();
    expect(screen.getByText('@todos olá')).toBeTruthy();
    const linhaSim = screen.getByText('@STC quero quadra').closest('li')!;
    const linhaNao = screen.getByText('@todos olá').closest('li')!;
    expect(within(linhaSim).getByText('chamou o STC')).toBeTruthy();
    expect(within(linhaNao).getByText('sem menção direta')).toBeTruthy();
    expect(screen.getByText('Racha de quinta')).toBeTruthy();
    expect(screen.getByText('Detectado')).toBeTruthy();
    expect(screen.getByText(/Só nomes de campos/)).toBeTruthy();
  });

  it('permitir um grupo chama o RPC; o token do webhook nunca aparece', async () => {
    api.listGroups.mockResolvedValue([{ id: 'gr1', group_jid: '120363025246125486@g.us', name: 'Racha', status: 'detected', ai_enabled: false, first_seen_at: '', last_seen_at: '2026-10-06T12:00:00Z', events_seen: 1, last_payload_shape: null }]);
    api.setGroup.mockResolvedValue(undefined);
    api.getChannel.mockResolvedValue({ institutional_name: 'STC Institucional', bot_phone: null, bot_lids: [], inbound_token_rotated_at: '2026-10-05T10:00:00Z', ai_direct_enabled: false, ai_group_enabled: false, mention_verified_at: null, group_session_minutes: 15, version: 2 });
    await abrirCanal();
    fireEvent.click(screen.getByRole('button', { name: /Permitir/ }));
    await waitFor(() => expect(api.setGroup).toHaveBeenCalledWith('gr1', 'allowed', false));
    expect(document.body.textContent).not.toMatch(/token=|inbound_token_hash/);
  });
});

describe('Conversas: IA', () => {
  it('não deixa salvar com o agente ligado e sem modelo', async () => {
    montar();
    fireEvent.click(await screen.findByRole('tab', { name: 'IA' }));
    await screen.findByText(/Configuração \(versão 3\)/);
    fireEvent.click(screen.getByLabelText('Agente ligado'));
    expect(screen.getByText('Escolha o modelo para poder ligar o agente.')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Salvar nova versão/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Modelo'), { target: { value: 'openai/gpt-4o-mini' } });
    expect((screen.getByRole('button', { name: /Salvar nova versão/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('lista propostas com o motivo quando o SISTEMA recusou (a IA não confirma por conta própria)', async () => {
    api.listProposals.mockResolvedValue([
      { id: 'p1', conversation_id: 'c1', action: 'create', status: 'confirmed', payload: { type: 'Play', date: '2026-10-08', start: '18:00', end: '19:00', court_name: 'Saibro 1' }, failure_code: null, created_at: '2026-10-06T12:00:00Z', confirmed_at: '2026-10-06T12:02:00Z', reservation_id: '12345678-aaaa' },
      { id: 'p2', conversation_id: 'c1', action: 'create', status: 'failed', payload: { type: 'Play', date: '2026-10-08', start: '18:00', end: '19:00', court_name: 'Saibro 1' }, failure_code: 'SLOT_TAKEN', created_at: '2026-10-06T12:05:00Z', confirmed_at: null, reservation_id: null },
    ]);
    montar();
    fireEvent.click(await screen.findByRole('tab', { name: 'IA' }));
    expect(await screen.findByText('Confirmada e gravada')).toBeTruthy();
    expect(screen.getByText(/O sistema recusou: Horário já ocupado na hora de confirmar\./)).toBeTruthy();
    expect(screen.getAllByText(/Reservar · Play · 08\/10 às 18:00–19:00 · Saibro 1/).length).toBe(2);
  });

  describe('memória do João (a diretoria decide)', () => {
    const sugestao = (o: Record<string, unknown> = {}) => ({ id: 'm1', subject_name: 'Beto Sócio', kind: 'recurring_preference', content: 'Prefere jogar cedo.', confidence: 0.82,
      status: 'pending', created_at: '2026-10-06T12:00:00Z', reviewed_at: null, source_body: 'o Beto sempre joga cedo', ...o });

    it('sem sugestão, diz que não há nada para revisar', async () => {
      montar();
      fireEvent.click(await screen.findByRole('tab', { name: 'IA' }));
      expect(await screen.findByText('Nada para revisar')).toBeTruthy();
      expect(screen.getByText('O que o João aprendeu sobre a turma')).toBeTruthy();
    });

    it('mostra quem, o quê, a confiança e a frase original; aprovar sem mexer manda só a decisão', async () => {
      api.listMemoryCandidates.mockImplementation(async (st: string) => (st === 'pending' ? [sugestao()] : []));
      montar();
      fireEvent.click(await screen.findByRole('tab', { name: 'IA' }));
      expect(await screen.findByText('Beto Sócio')).toBeTruthy();
      expect(screen.getByText('Preferência')).toBeTruthy();
      expect(screen.getByText('82% de confiança')).toBeTruthy();
      expect(screen.getByText(/Na conversa: “o Beto sempre joga cedo”/)).toBeTruthy();
      expect(screen.getByRole('tab', { name: 'Para revisar (1)' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /Aprovar/ }));
      await waitFor(() => expect(api.reviewMemoryCandidate).toHaveBeenCalledWith('m1', 'approved', undefined));
    });

    it('a diretoria corrige o texto antes de aprovar: o texto novo é o que vai', async () => {
      api.listMemoryCandidates.mockImplementation(async (st: string) => (st === 'pending' ? [sugestao()] : []));
      montar();
      fireEvent.click(await screen.findByRole('tab', { name: 'IA' }));
      const campo = await screen.findByLabelText('Texto da memória sobre Beto Sócio');
      fireEvent.change(campo, { target: { value: 'Gosta de jogar antes do calor.' } });
      fireEvent.click(screen.getByRole('button', { name: /Aprovar/ }));
      await waitFor(() => expect(api.reviewMemoryCandidate).toHaveBeenCalledWith('m1', 'approved', 'Gosta de jogar antes do calor.'));
    });

    it('recusar descarta; texto curto demais não deixa aprovar', async () => {
      api.listMemoryCandidates.mockImplementation(async (st: string) => (st === 'pending' ? [sugestao({ kind: 'inside_joke' })] : []));
      montar();
      fireEvent.click(await screen.findByRole('tab', { name: 'IA' }));
      expect(await screen.findByText('Brincadeira interna')).toBeTruthy();
      fireEvent.change(screen.getByLabelText('Texto da memória sobre Beto Sócio'), { target: { value: 'ok' } });
      expect((screen.getByRole('button', { name: /Aprovar/ }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: /Recusar/ }));
      await waitFor(() => expect(api.reviewMemoryCandidate).toHaveBeenCalledWith('m1', 'rejected', undefined));
    });

    it('aba Aprovadas lista o que o João já usa e permite retirar', async () => {
      api.listMemoryCandidates.mockImplementation(async (st: string) => (st === 'approved' ? [sugestao({ status: 'approved', content: 'Gosta de jogar cedo.' })] : []));
      montar();
      fireEvent.click(await screen.findByRole('tab', { name: 'IA' }));
      fireEvent.click(await screen.findByRole('tab', { name: 'Aprovadas' }));
      expect(await screen.findByText('Gosta de jogar cedo.')).toBeTruthy();
      expect(screen.queryByRole('button', { name: /Aprovar/ })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: /Retirar/ }));
      await waitFor(() => expect(api.reviewMemoryCandidate).toHaveBeenCalledWith('m1', 'rejected', undefined));
    });

    it('erro do servidor aparece em português e a lista continua', async () => {
      api.listMemoryCandidates.mockImplementation(async (st: string) => (st === 'pending' ? [sugestao()] : []));
      api.reviewMemoryCandidate.mockRejectedValueOnce({ message: 'CANDIDATE_NOT_FOUND' });
      montar();
      fireEvent.click(await screen.findByRole('tab', { name: 'IA' }));
      fireEvent.click(await screen.findByRole('button', { name: /Aprovar/ }));
      expect(await screen.findByText('Esta sugestão não existe mais. Atualize a lista.')).toBeTruthy();
    });
  });

  it('avisa quando o servidor não tem a chave do provedor de IA', async () => {
    api.aiHealth.mockResolvedValue({ aiConfigured: false, whatsappConfigured: true });
    montar();
    fireEvent.click(await screen.findByRole('tab', { name: 'IA' }));
    expect(await screen.findByText('Provedor de IA sem chave no servidor')).toBeTruthy();
  });
});
