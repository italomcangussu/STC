import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive, ArrowLeft, Bot, ChevronDown, ChevronUp, Eye, EyeOff, Hand, MessageCircle, MessageCirclePlus, PanelRightOpen, Pause,
  RotateCcw, Search, X,
} from 'lucide-react';
import { cx } from '../../lib/conversations/cx';
import { formatWhatsAppDisplay } from '../../lib/conversations/phone';
import ConversationCard, { Avatar, displayName } from './ConversationCard';
import MessageBubble from './MessageBubble';
import Composer from './Composer';
import ContactPanel from './ContactPanel';
import { ForwardDialog, ImageViewer, NewConversationDialog, QuickRepliesDialog } from './ConversationDialogs';
import { useChatOverlay } from './useChatOverlay';
import { useConfirm } from '../../hooks/useConfirm';
import { Button, InlineAlert, LoadingSpinner } from './ui';
import { buildMessageTimelineItems } from '../../lib/conversations/messageTimeline';
import { clearConversationDraft, getConversationDraft, hasConversationDraft, setConversationDraft } from '../../lib/conversations/draftStore';
import { decidePresenceSignal, type PresenceState } from '../../lib/conversations/presenceSignalPolicy';
import { applyPresenceEvent, formatPresenceLabel, getActivePresence, pruneExpiredPresence, type PresenceEntry } from '../../lib/conversations/conversationPresenceState';
import {
  PAGE, deleteMessage, describeConversationError, editMessage, kindForFile, listInbox, listMessages, listQuickReplies,
  listStaff, markConversationRead, markConversationUnread, reactToMessage, refreshAvatar, sendMessage, sendPresence,
  setAiStatus, setConversationStatus, signMedia, subscribeInbox, syncMessage, uploadOutbound,
  type AiStatus, type ConversationMessage, type ConversationSummary, type InboxFilter, type OutboundKind, type QuickReply, type StaffOption,
} from '../../lib/conversations/api';

/**
 * Caixa de atendimento: o WhatsApp institucional do clube (conversas diretas e grupos permitidos)
 * como mensageiro completo (texto, mídia, áudio de voz, responder, reagir, editar, apagar para
 * todos, encaminhar, tiques, digitando, busca) e CRM leve ao lado. As mensagens da IA e das
 * automações aparecem na MESMA conversa, identificadas — não existe um segundo histórico.
 * Regra herdada do chat do North Jato: abrir NÃO marca como lida — só a ação explícita ou responder.
 */

const rascunhos = new Map<string, string>();
const avataresPedidos = new Set<string>();

const FILTROS: { id: InboxFilter; label: string }[] = [
  { id: 'open', label: 'Abertas' },
  { id: 'unread', label: 'Não lidas' },
  { id: 'waiting', label: 'Aguardando' },
  { id: 'ai', label: 'IA atendendo' },
  { id: 'handoff', label: 'Transferidas' },
  { id: 'groups', label: 'Grupos' },
  { id: 'mine', label: 'Minhas' },
  { id: 'followup', label: 'Retornos' },
  { id: 'closed', label: 'Encerradas' },
];

const FILTROS_PRINCIPAIS = FILTROS.slice(0, 3);
const FILTROS_MAIS = FILTROS.slice(3);

const VAZIO: Record<InboxFilter, string> = {
  open: 'Quando alguém mandar mensagem para o WhatsApp do clube, ela aparece aqui.',
  unread: 'Tudo lido. 🎉',
  waiting: 'Ninguém esperando resposta agora.',
  mine: 'Nenhuma conversa com você como responsável.',
  followup: 'Nenhum retorno para hoje.',
  ai: 'Nenhuma conversa com o agente de IA agora.',
  handoff: 'Nenhuma conversa transferida pela IA esperando a equipe.',
  groups: 'Grupos aparecem aqui depois de permitidos em Canal.',
  closed: 'Conversas encerradas ficam aqui e voltam sozinhas se a pessoa escrever.',
};

function otimista(input: Partial<ConversationMessage> & { requestId: string }): ConversationMessage {
  return {
    id: `pendente-${input.requestId}`, direction: 'outbound', origin: 'staff', kind: 'text', body: null, status: 'queued',
    createdAt: new Date().toISOString(), sentAt: null, lastError: null, mediaPath: null, mediaMime: null, mediaName: null,
    meta: {}, replyPreview: null, reactions: {}, editedAt: null, deletedAt: null, providerId: null, senderName: null,
    mentionDirect: false, mentionEvidence: null, pending: true, ...input,
  };
}

export default function InboxTab({ currentUserId, standalone = false }: { currentUserId: string; standalone?: boolean }) {
  const confirm = useConfirm();
  const [filtro, setFiltro] = useState<InboxFilter>('open');
  const [busca, setBusca] = useState('');
  const [conversas, setConversas] = useState<ConversationSummary[]>([]);
  const [carregandoLista, setCarregandoLista] = useState(true);
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [selecionada, setSelecionada] = useState<string | null>(null);
  /** Guarda a conversa aberta mesmo quando o filtro deixa de listá-la. */
  const [atualFixa, setAtualFixa] = useState<ConversationSummary | null>(null);

  const [mensagens, setMensagens] = useState<ConversationMessage[]>([]);
  const [temMais, setTemMais] = useState(false);
  const [carregandoMensagens, setCarregandoMensagens] = useState(false);
  const [carregandoAntigas, setCarregandoAntigas] = useState(false);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [naoLidasAoAbrir, setNaoLidasAoAbrir] = useState(0);

  const [texto, setTexto] = useState('');
  const [respondendo, setRespondendo] = useState<ConversationMessage | null>(null);
  const [editando, setEditando] = useState<ConversationMessage | null>(null);
  const [encaminhando, setEncaminhando] = useState<ConversationMessage | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [soltos, setSoltos] = useState<File[] | null>(null);
  const [arrastando, setArrastando] = useState(false);

  const [painel, setPainel] = useState(false);
  const [novaConversa, setNovaConversa] = useState(false);
  const [gerirRespostas, setGerirRespostas] = useState(false);
  const [foto, setFoto] = useState<string | null>(null);
  const [buscaNaConversa, setBuscaNaConversa] = useState<string | null>(null);
  const [indiceBusca, setIndiceBusca] = useState(0);
  const [mudandoStatus, setMudandoStatus] = useState(false);

  const [equipe, setEquipe] = useState<StaffOption[]>([]);
  const [respostas, setRespostas] = useState<QuickReply[]>([]);

  const presencaRef = useRef(new Map<string, PresenceEntry>());
  const [, setTick] = useState(0);
  const saidaRef = useRef<{ state: PresenceState | null; at: number | null }>({ state: null, at: null });
  const digitandoRef = useRef(false);
  const gravandoRef = useRef(false);

  const rolagemRef = useRef<HTMLDivElement>(null);
  const fimRef = useRef<HTMLDivElement>(null);
  const selecionadaRef = useRef<string | null>(null);
  selecionadaRef.current = selecionada;
  const conversasRef = useRef<ConversationSummary[]>([]);
  conversasRef.current = conversas;

  const atual = useMemo(
    () => conversas.find((c) => c.id === selecionada) ?? (atualFixa?.id === selecionada ? atualFixa : null),
    [conversas, selecionada, atualFixa],
  );
  useEffect(() => { if (atual) setAtualFixa(atual); }, [atual]);
  const grupo = atual?.kind === 'group';

  /* ----------------------------- Carregamento ----------------------------- */

  const carregarLista = useCallback(async () => {
    try {
      setConversas(await listInbox(filtro, busca));
      setErroLista(null);
    } catch (e) {
      setErroLista(describeConversationError(e).startsWith('A operação não foi concluída') ? 'Não foi possível carregar as conversas agora.' : describeConversationError(e));
    } finally {
      setCarregandoLista(false);
    }
  }, [filtro, busca]);

  useEffect(() => {
    setCarregandoLista(true);
    const t = setTimeout(() => void carregarLista(), busca ? 300 : 0);
    return () => clearTimeout(t);
  }, [carregarLista, busca]);

  const carregarRespostas = useCallback(() => { listQuickReplies().then(setRespostas).catch(() => undefined); }, []);
  useEffect(() => {
    carregarRespostas();
    listStaff().then(setEquipe).catch(() => undefined);
  }, [carregarRespostas]);

  const assinarMidias = useCallback(async (lista: ConversationMessage[]) => {
    const faltam = lista.map((m) => m.mediaPath).filter((p): p is string => Boolean(p));
    if (faltam.length === 0) return;
    const novas = await signMedia(faltam);
    setUrls((antes) => new Map([...antes, ...novas]));
  }, []);

  /** Recarrega as mensagens recentes, mantendo as antigas já carregadas e as otimistas. */
  const recarregarMensagens = useCallback(async (id: string) => {
    const recentes = await listMessages(id);
    if (selecionadaRef.current !== id) return;
    setMensagens((antes) => {
      const ids = new Set(recentes.map((m) => m.id));
      const reqs = new Set(recentes.map((m) => m.requestId).filter(Boolean));
      const maisVelha = recentes[0]?.createdAt;
      const antigas = antes.filter((m) => !m.pending && !ids.has(m.id) && maisVelha && m.createdAt < maisVelha);
      const pendentes = antes.filter((m) => m.pending && m.requestId && !reqs.has(m.requestId));
      return [...antigas, ...recentes, ...pendentes];
    });
    void assinarMidias(recentes);
  }, [assinarMidias]);

  // Abrir conversa: mensagens e rascunho dela. NÃO marca como lida.
  useEffect(() => {
    if (!selecionada) return;
    setMensagens([]);
    setErro(null);
    setRespondendo(null);
    setEditando(null);
    setBuscaNaConversa(null);
    setTexto(getConversationDraft(rascunhos, selecionada));
    const c = conversasRef.current.find((x) => x.id === selecionada);
    setNaoLidasAoAbrir(c?.unread_count ?? 0);
    setCarregandoMensagens(true);
    listMessages(selecionada)
      .then((lista) => {
        if (selecionadaRef.current !== selecionada) return;
        setMensagens(lista);
        setTemMais(lista.length === PAGE);
        void assinarMidias(lista);
      })
      .catch(() => setErro('Não foi possível carregar as mensagens.'))
      .finally(() => setCarregandoMensagens(false));
    // Avatar: uma tentativa por sessão; o servidor ainda limita a uma por dia (e grupos não têm).
    if (c && c.kind === 'direct' && !c.avatar_url && !avataresPedidos.has(selecionada)) {
      avataresPedidos.add(selecionada);
      void refreshAvatar(selecionada).then((url) => { if (url) void carregarLista(); }).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selecionada]);

  async function carregarAntigas() {
    if (!selecionada || !mensagens.length) return;
    setCarregandoAntigas(true);
    const altura = rolagemRef.current?.scrollHeight ?? 0;
    try {
      const antigas = await listMessages(selecionada, mensagens.find((m) => !m.pending)?.createdAt);
      setTemMais(antigas.length === PAGE);
      setMensagens((m) => [...antigas, ...m]);
      void assinarMidias(antigas);
      requestAnimationFrame(() => {
        const el = rolagemRef.current;
        if (el) el.scrollTop = el.scrollHeight - altura;
      });
    } catch {
      setErro('Não foi possível carregar as mensagens anteriores.');
    } finally {
      setCarregandoAntigas(false);
    }
  }

  /* ----------------------------- Tempo real ----------------------------- */

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const parar = subscribeInbox(
      ({ table, conversationId }) => {
        clearTimeout(t);
        t = setTimeout(() => void carregarLista(), 250);
        const aberta = selecionadaRef.current;
        if (table === 'conv_messages' && aberta && conversationId === aberta) {
          // Chegou mensagem: o "digitando" daquela conversa acabou.
          presencaRef.current.delete(aberta);
          void recarregarMensagens(aberta);
        }
      },
      ({ conversationId, state }) => {
        applyPresenceEvent(presencaRef.current, { conversationId, state, nowMs: Date.now() });
        setTick((n) => n + 1);
      },
    );
    // Expira o "digitando" sem precisar de evento.
    const limpeza = setInterval(() => {
      if (pruneExpiredPresence(presencaRef.current, Date.now()) > 0) setTick((n) => n + 1);
    }, 2000);
    return () => { clearTimeout(t); clearInterval(limpeza); parar(); };
  }, [carregarLista, recarregarMensagens]);

  // Presença da equipe para o contato (só conversa direta; grupo não recebe "digitando").
  const sinalizar = useCallback(() => {
    const id = selecionadaRef.current;
    const c = conversasRef.current.find((x) => x.id === id);
    if (!id || !c || c.kind !== 'direct') return;
    const agora = Date.now();
    const estado = decidePresenceSignal({
      isTyping: digitandoRef.current, isRecording: gravandoRef.current,
      lastSentAtMs: saidaRef.current.at, nowMs: agora, lastState: saidaRef.current.state,
    });
    if (!estado) return;
    saidaRef.current = { state: estado, at: agora };
    void sendPresence(id, estado).catch(() => undefined);
  }, []);

  /* ----------------------------- Rolagem ----------------------------- */

  const ultimoId = mensagens[mensagens.length - 1]?.id;
  useEffect(() => {
    if (buscaNaConversa) return;
    fimRef.current?.scrollIntoView({ block: 'end' });
  }, [ultimoId, selecionada, buscaNaConversa]);

  // Quem lia o fim da conversa continua no fim quando a área encolhe (teclado, faixa de resposta, aviso).
  const noFimRef = useRef(true);
  useEffect(() => {
    const el = rolagemRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const aoRolar = () => { noFimRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; };
    const obs = new ResizeObserver(() => { if (noFimRef.current) el.scrollTop = el.scrollHeight; });
    el.addEventListener('scroll', aoRolar, { passive: true });
    obs.observe(el);
    return () => { el.removeEventListener('scroll', aoRolar); obs.disconnect(); };
  }, [atual?.id]);

  const achados = useMemo(() => {
    const q = buscaNaConversa?.trim().toLowerCase();
    if (!q) return [];
    return mensagens.filter((m) => !m.deletedAt && (m.body ?? '').toLowerCase().includes(q)).map((m) => m.id);
  }, [buscaNaConversa, mensagens]);

  useEffect(() => {
    const id = achados[achados.length - 1 - indiceBusca];
    if (id) document.getElementById(`msg-${id}`)?.scrollIntoView({ block: 'center' });
  }, [achados, indiceBusca]);

  // Divisor "não lidas": antes da primeira das N últimas do contato.
  const primeiraNaoLida = useMemo(() => {
    if (naoLidasAoAbrir <= 0) return null;
    const recebidas = mensagens.filter((m) => m.direction === 'inbound');
    return recebidas[Math.max(0, recebidas.length - naoLidasAoAbrir)]?.id ?? null;
  }, [mensagens, naoLidasAoAbrir]);

  const itens = useMemo(() => buildMessageTimelineItems(mensagens), [mensagens]);

  /* ----------------------------- Ações ----------------------------- */

  function mudarTexto(valor: string) {
    setTexto(valor);
    if (selecionada && !editando) setConversationDraft(rascunhos, selecionada, valor);
  }

  async function enviar(input: {
    requestId?: string; kind?: OutboundKind; body?: string | null; mediaPath?: string | null; mime?: string | null;
    fileName?: string | null; localUrl?: string; replyTo?: ConversationMessage | null; conversationId?: string;
  }) {
    const conversa = input.conversationId ?? selecionada;
    if (!conversa) return;
    const requestId = input.requestId ?? crypto.randomUUID();
    const naAberta = conversa === selecionada;
    if (naAberta) {
      setMensagens((m) => [...m.filter((x) => x.requestId !== requestId), otimista({
        requestId, kind: input.kind ?? 'text', body: input.body ?? null, mediaPath: input.mediaPath ?? null,
        mediaMime: input.mime ?? null, mediaName: input.fileName ?? null, localUrl: input.localUrl,
        replyPreview: input.replyTo ? (input.replyTo.body || 'Mídia').slice(0, 200) : null,
      })]);
    }
    try {
      await sendMessage({
        conversationId: conversa, idempotencyKey: requestId, kind: input.kind, body: input.body,
        mediaPath: input.mediaPath, mime: input.mime, fileName: input.fileName, replyToMessageId: input.replyTo?.id ?? null,
      });
    } catch (e) {
      setErro(describeConversationError(e));
    }
    if (naAberta) {
      await recarregarMensagens(conversa).catch(() => undefined);
      setMensagens((m) => m.filter((x) => !(x.pending && x.requestId === requestId)));
    }
    void carregarLista();
  }

  function enviarTexto(corpo: string) {
    if (!selecionada) return;
    const resposta = respondendo;
    setTexto('');
    clearConversationDraft(rascunhos, selecionada);
    setRespondendo(null);
    digitandoRef.current = false;
    sinalizar();
    void enviar({ body: corpo, replyTo: resposta });
  }

  async function enviarArquivos(files: File[], legenda: string) {
    if (!selecionada) return;
    clearConversationDraft(rascunhos, selecionada);
    const resposta = respondendo;
    setRespondendo(null);
    for (const [i, file] of files.entries()) {
      try {
        const path = await uploadOutbound(file, file.name);
        await enviar({
          kind: kindForFile(file), mediaPath: path, mime: file.type || null, fileName: file.name,
          body: i === 0 ? legenda || null : null, localUrl: URL.createObjectURL(file), replyTo: i === 0 ? resposta : null,
        });
      } catch (e) {
        setErro(e instanceof Error ? e.message : 'Não foi possível enviar o arquivo.');
      }
    }
  }

  async function enviarVoz(blob: Blob, mime: string) {
    const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'webm';
    try {
      const path = await uploadOutbound(blob, `audio.${ext}`);
      await enviar({ kind: 'ptt', mediaPath: path, mime: mime.split(';')[0], localUrl: URL.createObjectURL(blob), replyTo: respondendo });
      setRespondendo(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível enviar o áudio.');
    }
  }

  async function executar(acao: () => Promise<unknown>, sucesso?: string) {
    setErro(null);
    try {
      await acao();
      if (sucesso) setAviso(sucesso);
      if (selecionada) await recarregarMensagens(selecionada);
      void carregarLista();
    } catch (e) {
      setErro(describeConversationError(e));
    }
  }

  async function encaminhar(para: string[]) {
    const m = encaminhando;
    if (!m) return;
    for (const id of para) {
      await enviar({
        conversationId: id, kind: (m.kind === 'sticker' || m.kind === 'location' || m.kind === 'contact' || m.kind === 'other' ? 'text' : m.kind) as OutboundKind,
        body: m.kind === 'text' || !m.mediaPath ? m.body ?? '' : m.body, mediaPath: m.mediaPath, mime: m.mediaMime, fileName: m.mediaName,
      });
    }
    setAviso(`Mensagem encaminhada para ${para.length} conversa${para.length > 1 ? 's' : ''}.`);
  }

  async function alternarStatus() {
    if (!atual) return;
    setMudandoStatus(true);
    try {
      await setConversationStatus(atual.id, atual.status === 'open' ? 'closed' : 'open');
      if (atual.status === 'open') { setSelecionada(null); setPainel(false); }
      await carregarLista();
    } catch (e) {
      setErro(describeConversationError(e));
    } finally {
      setMudandoStatus(false);
    }
  }

  const telaCheia = useChatOverlay(Boolean(atual));

  const topBarRef = useRef<HTMLDivElement>(null);
  const [topBarHeight, setTopBarHeight] = useState<number>(0);

  useEffect(() => {
    const el = topBarRef.current;
    if (!el || !telaCheia) return;
    if (typeof ResizeObserver === 'undefined') {
      const rect = el.getBoundingClientRect();
      if (rect.height > 0) setTopBarHeight(Math.round(rect.height));
      return;
    }
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
        if (h > 0) setTopBarHeight(Math.round(h));
      }
    });
    ro.observe(el);
    const rect = el.getBoundingClientRect();
    if (rect.height > 0) setTopBarHeight(Math.round(rect.height));
    return () => ro.disconnect();
  }, [telaCheia, atual?.id, atual?.ai_status, atual?.handoff_note, buscaNaConversa]);

  const presencaDe = (c: ConversationSummary) => (c.kind === 'direct' ? getActivePresence(presencaRef.current, c.id, Date.now()) : null);
  const presencaAtual = atual ? presencaDe(atual) : null;

  const renderTopBar = () => {
    if (!atual) return null;
    return (
      <div ref={telaCheia ? topBarRef : undefined} className={cx('bg-white', telaCheia && 'conv-top-bar-floating')}>
        <header className="chat-overlay-header flex items-center gap-1.5 border-b border-stone-200 bg-white px-2 py-2 md:px-3">
          <button type="button" onClick={() => { setSelecionada(null); setPainel(false); }} aria-label="Voltar às conversas"
            className="grid h-10 w-10 place-items-center rounded-full outline-hidden hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-saibro-300 md:hidden"><ArrowLeft size={20} aria-hidden /></button>
          <button type="button" onClick={() => setPainel((v) => !v)} className="flex min-w-0 flex-1 items-center gap-2 rounded-xl p-1 text-left hover:bg-stone-50">
            <Avatar name={atual.title} url={atual.avatar_url} size={38} group={grupo} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold text-stone-800">{displayName(atual)}</span>
              <span className={cx('block truncate text-xs', presencaAtual ? 'font-semibold text-emerald-700' : 'text-stone-500')}>
                {presencaAtual ? formatPresenceLabel(presencaAtual) : grupo ? 'Grupo do WhatsApp' : formatWhatsAppDisplay(atual.destination)}
              </span>
            </span>
          </button>
          <AiControl status={atual.ai_status} compact={painel} onChange={(st) => void executar(() => setAiStatus(atual.id, st),
            st === 'ai' ? 'Conversa devolvida ao agente de IA.' : st === 'human' ? 'Você assumiu a conversa.' : 'IA pausada nesta conversa.')} />
          <button type="button" onClick={() => { setBuscaNaConversa((v) => (v === null ? '' : null)); setIndiceBusca(0); }} aria-label="Buscar na conversa"
            className="grid h-10 w-10 place-items-center rounded-full text-stone-600 outline-hidden hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-saibro-300"><Search size={18} aria-hidden /></button>
          {atual.unread_count > 0 ? (
            <button type="button" onClick={() => void executar(() => markConversationRead(atual.id), 'Conversa marcada como lida.')} aria-label="Marcar como lida"
              title="Marcar como lida" className="grid h-10 w-10 place-items-center rounded-full text-emerald-700 outline-hidden hover:bg-emerald-50 focus-visible:ring-2 focus-visible:ring-saibro-300"><Eye size={18} aria-hidden /></button>
          ) : (
            <button type="button" onClick={() => void executar(() => markConversationUnread(atual.id), 'Marcada como não lida.')} aria-label="Marcar como não lida"
              title="Marcar como não lida" className="grid h-10 w-10 place-items-center rounded-full text-stone-600 outline-hidden hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-saibro-300"><EyeOff size={18} aria-hidden /></button>
          )}
          <span className="hidden sm:block">
            <Button size="sm" variant="ghost" loading={mudandoStatus} onClick={() => void alternarStatus()}>
              {atual.status === 'open' ? <><Archive size={14} aria-hidden /> <span className={cx(painel && 'sr-only')}>Encerrar</span></> : <><RotateCcw size={14} aria-hidden /> <span className={cx(painel && 'sr-only')}>Reabrir</span></>}
            </Button>
          </span>
          <button type="button" onClick={() => setPainel((v) => !v)} aria-label="Painel do contato" aria-pressed={painel}
            className={cx('grid h-10 w-10 place-items-center rounded-full outline-hidden hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-saibro-300', painel ? 'text-saibro-700' : 'text-stone-600')}>
            <PanelRightOpen size={18} aria-hidden />
          </button>
        </header>

        {atual.ai_status === 'human' && atual.handoff_note && (
          <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <Hand size={14} className="mt-0.5 shrink-0" aria-hidden />
            <p className="min-w-0 flex-1"><strong>{atual.handoff_kind === 'soft' ? 'A IA pediu apoio: ' : 'Transferida pela IA: '}</strong>{atual.handoff_note}</p>
            <button type="button" onClick={() => void executar(() => setAiStatus(atual.id, 'ai'), 'Conversa devolvida ao agente de IA.')}
              className="shrink-0 rounded-full px-2 py-1 font-semibold text-amber-900 underline-offset-2 hover:underline">Devolver à IA</button>
          </div>
        )}
        {buscaNaConversa !== null && (
          <div className="flex items-center gap-2 border-b border-stone-200 bg-white px-3 py-2">
            <input autoFocus value={buscaNaConversa} onChange={(e) => { setBuscaNaConversa(e.target.value); setIndiceBusca(0); }}
              placeholder="Buscar nesta conversa" aria-label="Buscar nesta conversa"
              className="min-h-9 min-w-0 flex-1 rounded-lg border border-stone-200 px-3 text-sm outline-hidden focus:border-saibro-400" />
            <span className="shrink-0 text-xs text-stone-500 tabular-nums">{achados.length ? `${indiceBusca + 1}/${achados.length}` : '0'}</span>
            <button type="button" aria-label="Resultado anterior" disabled={!achados.length} onClick={() => setIndiceBusca((i) => Math.min(i + 1, achados.length - 1))}
              className="grid h-9 w-9 place-items-center rounded-full hover:bg-stone-100 disabled:opacity-40"><ChevronUp size={16} aria-hidden /></button>
            <button type="button" aria-label="Próximo resultado" disabled={!achados.length} onClick={() => setIndiceBusca((i) => Math.max(i - 1, 0))}
              className="grid h-9 w-9 place-items-center rounded-full hover:bg-stone-100 disabled:opacity-40"><ChevronDown size={16} aria-hidden /></button>
            <button type="button" aria-label="Fechar busca" onClick={() => setBuscaNaConversa(null)} className="grid h-9 w-9 place-items-center rounded-full hover:bg-stone-100"><X size={16} aria-hidden /></button>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {telaCheia && renderTopBar()}
      <div className={cx('conv-shell relative flex overflow-hidden bg-stone-50', standalone ? 'is-standalone h-full w-full' : 'rounded-3xl border border-stone-200', telaCheia && 'is-chat-overlay')}>
        {/* ------------------------------ Lista ------------------------------ */}
        <section aria-label="Conversas"
          className={cx('flex min-w-0 flex-col border-stone-200 md:w-[21rem] md:shrink-0 md:border-r lg:w-[23rem]', selecionada ? 'hidden md:flex' : 'flex w-full')}>
          <div className="grid gap-2 border-b border-stone-200 bg-white p-3">
            <div className="flex gap-2">
              <label className="relative block min-w-0 flex-1">
                <span className="sr-only">Buscar conversa</span>
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" aria-hidden />
                <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome, número ou etiqueta"
                  className="min-h-10 w-full rounded-xl border border-stone-200 bg-stone-50 pl-9 pr-3 text-sm outline-hidden focus:border-saibro-400 focus:ring-2 focus:ring-saibro-100" />
              </label>
              <button type="button" onClick={() => setNovaConversa(true)} aria-label="Nova conversa"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-saibro-600 text-white outline-hidden hover:bg-saibro-700 focus-visible:ring-2 focus-visible:ring-saibro-300">
                <MessageCirclePlus size={18} aria-hidden />
              </button>
            </div>
            {/* Controle segmentado com os 3 filtros principais + seletor nativo para os demais: nada rola na horizontal. */}
            <div className="flex items-center gap-1.5">
              <div className="grid min-w-0 flex-1 grid-cols-3 gap-0.5 rounded-xl bg-stone-100 p-0.5" role="group" aria-label="Filtro">
                {FILTROS_PRINCIPAIS.map((f) => (
                  <button key={f.id} type="button" aria-pressed={filtro === f.id} onClick={() => setFiltro(f.id)}
                    className={cx('min-h-9 truncate rounded-[10px] px-1 text-xs font-semibold outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-saibro-300',
                      filtro === f.id ? 'bg-white text-stone-900 shadow-xs' : 'text-stone-500 active:bg-stone-200')}>
                    {f.label}
                  </button>
                ))}
              </div>
              <label className="shrink-0">
                <span className="sr-only">Mais filtros</span>
                <select value={FILTROS_MAIS.some((f) => f.id === filtro) ? filtro : ''} onChange={(e) => { if (e.target.value) setFiltro(e.target.value as InboxFilter); }}
                  className={cx('h-10 max-w-[8.5rem] rounded-xl border px-2 text-xs font-semibold outline-hidden focus-visible:ring-2 focus-visible:ring-saibro-300',
                    FILTROS_MAIS.some((f) => f.id === filtro) ? 'border-saibro-300 bg-saibro-50 text-saibro-700' : 'border-stone-200 bg-stone-50 text-stone-600')}>
                  <option value="" disabled>Mais</option>
                  {FILTROS_MAIS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                </select>
              </label>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto py-2">
            {erroLista && <div className="px-3"><InlineAlert tone="error" title={erroLista} action={{ label: 'Tentar de novo', onClick: () => void carregarLista() }} /></div>}
            {carregandoLista && conversas.length === 0 ? (
              <div className="grid place-items-center py-10"><LoadingSpinner text="Carregando conversas…" /></div>
            ) : conversas.length === 0 && !erroLista ? (
              <div className="px-6 py-12 text-center">
                <MessageCircle size={28} className="mx-auto text-stone-300" aria-hidden />
                <p className="mt-2 text-sm font-semibold text-stone-800">{busca ? 'Nada encontrado' : 'Nada por aqui'}</p>
                <p className="mt-1 text-xs text-stone-500">{busca ? 'Confira o nome, a etiqueta ou digite ao menos 3 dígitos do número.' : VAZIO[filtro]}</p>
              </div>
            ) : conversas.map((c) => (
              <ConversationCard key={c.id} conversation={c} selected={c.id === selecionada}
                draft={c.id !== selecionada && hasConversationDraft(rascunhos, c.id)}
                presence={presencaDe(c)}
                onSelect={setSelecionada} />
            ))}
          </div>
        </section>

        {/* ------------------------------ Conversa ------------------------------ */}
        <section aria-label={atual ? `Conversa com ${atual.title}` : 'Conversa'}
          className={cx('relative min-w-0 flex-1 flex-col bg-[#efeae2]', selecionada ? 'flex' : 'hidden md:flex')}
          onDragOver={(e) => { if (atual && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setArrastando(true); } }}
          onDragLeave={(e) => { if (e.currentTarget === e.target) setArrastando(false); }}
          onDrop={(e) => { if (!atual) return; e.preventDefault(); setArrastando(false); setSoltos(Array.from(e.dataTransfer.files)); }}
        >
          {!atual ? (
            <div className="m-auto max-w-sm px-6 py-12 text-center select-none">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-linear-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/20">
                <MessageCircle size={32} aria-hidden />
              </div>
              <h3 className="text-base font-bold text-stone-800 md:text-lg">STC Conversas & WhatsApp</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-stone-500">
                Selecione uma conversa ao lado para visualizar as mensagens, responder aos sócios e interagir em tempo real pelo canal do clube.
              </p>
              <div className="mt-4 flex items-center justify-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50/80 px-3 py-1 text-[11px] font-semibold text-emerald-800">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" aria-hidden />
                  WhatsApp Integrado
                </span>
              </div>
            </div>
          ) : (
            <>
              {!telaCheia && renderTopBar()}
              {arrastando && (
                <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center border-4 border-dashed border-saibro-400 bg-saibro-50/80 text-sm font-bold text-saibro-800">
                  Solte para anexar
                </div>
              )}

              <div
                ref={rolagemRef}
                style={{ paddingTop: telaCheia ? (topBarHeight ? `${topBarHeight}px` : 'calc(3.5rem + env(safe-area-inset-top, 0px))') : undefined }}
                className="min-h-0 flex-1 overflow-y-auto px-2 py-3 md:px-6"
                aria-live="polite"
              >
                {temMais && !carregandoMensagens && (
                  <div className="mb-2 flex justify-center">
                    <Button size="sm" variant="secondary" loading={carregandoAntigas} onClick={() => void carregarAntigas()}>Carregar mensagens anteriores</Button>
                  </div>
                )}
                {carregandoMensagens && mensagens.length === 0 ? (
                  <div className="grid place-items-center py-10"><LoadingSpinner text="Carregando mensagens…" /></div>
                ) : (
                  <div className="grid gap-1.5">
                    {itens.map((item) => item.type === 'day-divider' ? (
                      <div key={item.key} className="my-2 flex justify-center">
                        <span className="rounded-lg bg-white/90 px-3 py-1 text-[11px] font-semibold text-stone-600 shadow-sm">{item.label}</span>
                      </div>
                    ) : (
                      <div key={item.key} id={`msg-${item.message.id}`}>
                        {item.message.id === primeiraNaoLida && (
                          <div className="my-2 flex items-center gap-2" role="separator" aria-label="Mensagens não lidas">
                            <span className="h-px flex-1 bg-emerald-400" />
                            <span className="rounded-full bg-emerald-500 px-2.5 py-0.5 text-[11px] font-bold text-white">{naoLidasAoAbrir} não lida{naoLidasAoAbrir > 1 ? 's' : ''}</span>
                            <span className="h-px flex-1 bg-emerald-400" />
                          </div>
                        )}
                        <MessageBubble
                          message={item.message}
                          mediaUrl={item.message.mediaPath ? urls.get(item.message.mediaPath) : null}
                          highlight={achados[achados.length - 1 - indiceBusca] === item.message.id}
                          canWrite
                          isGroup={grupo}
                          onReply={(m) => { setEditando(null); setRespondendo(m); }}
                          onReact={(m, emoji) => void executar(() => reactToMessage(m.id, emoji))}
                          onForward={setEncaminhando}
                          onEdit={(m) => { setRespondendo(null); setEditando(m); setTexto(m.body ?? ''); }}
                          onDelete={(m) => void confirm({ title: 'Apagar para todos?', description: 'Quem recebeu verá “mensagem apagada”. Não dá para desfazer.', confirmLabel: 'Apagar', tone: 'danger' })
                            .then((ok) => { if (ok) void executar(() => deleteMessage(m.id), 'Mensagem apagada para todos.'); })}
                          onRetry={(m) => void enviar({ requestId: m.requestId ?? undefined, kind: (m.kind as OutboundKind) ?? 'text', body: m.body, mediaPath: m.mediaPath, mime: m.mediaMime, fileName: m.mediaName })}
                          onSync={(m) => executar(() => syncMessage(m.id), 'Mensagem sincronizada do WhatsApp com sucesso.')}
                          onOpenImage={(url) => setFoto(url)}
                        />
                      </div>
                    ))}
                    {presencaAtual && (
                      <div className="px-1"><span className="inline-block rounded-2xl border border-[#b7e4b0] bg-[#dcf8c6] px-3 py-2 text-xs font-semibold italic text-emerald-800">{formatPresenceLabel(presencaAtual)}</span></div>
                    )}
                  </div>
                )}
                <div ref={fimRef} />
              </div>

              {(erro || aviso) && (
                <div className="bg-white px-3 pt-2">
                  {erro && <InlineAlert tone="error" title={erro} onDismiss={() => setErro(null)} />}
                  {aviso && !erro && <InlineAlert tone="success" title={aviso} onDismiss={() => setAviso(null)} />}
                </div>
              )}

              <div className="chat-overlay-footer bg-white">
                {grupo && (
                  <p className="border-t border-stone-200 bg-sky-50 px-3 py-1.5 text-[11px] text-sky-900">
                    Você está respondendo no grupo: todos os participantes veem.
                  </p>
                )}
                <Composer
                  contactName={displayName(atual)}
                  value={texto}
                  onChange={mudarTexto}
                  replyTo={respondendo}
                  editing={editando}
                  onCancelContext={() => { if (editando) setTexto(getConversationDraft(rascunhos, atual.id)); setRespondendo(null); setEditando(null); }}
                  quickReplies={respostas}
                  onManageQuickReplies={() => setGerirRespostas(true)}
                  onSendText={enviarTexto}
                  onSaveEdit={(corpo) => {
                    const alvo = editando;
                    setEditando(null);
                    setTexto(getConversationDraft(rascunhos, atual.id));
                    if (alvo && corpo !== alvo.body) void executar(() => editMessage(alvo.id, corpo), 'Mensagem editada.');
                  }}
                  onSendFiles={enviarArquivos}
                  onSendVoice={enviarVoz}
                  onTyping={(v) => { digitandoRef.current = v; sinalizar(); }}
                  onRecording={(v) => { gravandoRef.current = v; sinalizar(); }}
                  onError={setErro}
                  droppedFiles={soltos}
                  onDroppedConsumed={() => setSoltos(null)}
                />
              </div>
            </>
          )}
        </section>

        {/* ------------------------------ Contato ------------------------------ */}
        {atual && painel && (
          <div className={cx('flex bg-black/30 xl:static xl:z-auto xl:w-[21rem] xl:shrink-0 xl:border-l xl:border-stone-200 xl:bg-transparent', telaCheia ? 'fixed inset-0 z-[70]' : 'absolute inset-0 z-30')}
            onClick={(e) => { if (e.target === e.currentTarget) setPainel(false); }}>
            <div className="ml-auto h-full w-full max-w-sm xl:max-w-none">
              <ContactPanel conversation={atual} staff={equipe} currentUserId={currentUserId}
                onChanged={() => void carregarLista()} onClose={() => setPainel(false)}
                onToggleStatus={() => void alternarStatus()} />
            </div>
          </div>
        )}

        <NewConversationDialog open={novaConversa} onClose={() => setNovaConversa(false)}
          onOpened={(id) => { setNovaConversa(false); setFiltro('open'); setSelecionada(id); void carregarLista(); }} />
        <ForwardDialog open={encaminhando !== null} onClose={() => setEncaminhando(null)} excludeId={selecionada} onForward={encaminhar} />
        <QuickRepliesDialog open={gerirRespostas} onClose={() => setGerirRespostas(false)} replies={respostas} onChanged={carregarRespostas} />
        <ImageViewer url={foto} onClose={() => setFoto(null)} />
      </div>
    </>
  );
}

const AI_LABEL: Record<AiStatus, string> = { ai: 'IA atendendo', human: 'Equipe', paused: 'IA pausada' };

/** Quem responde esta conversa, e como trocar. */
/** `compact`: com o painel do contato aberto o cabeçalho é estreito e o rótulo cede o lugar ao nome. */
function AiControl({ status, onChange, compact }: { status: AiStatus; onChange: (s: AiStatus) => void; compact?: boolean }) {
  const [aberto, setAberto] = useState(false);
  const opcoes: { id: AiStatus; label: string; icon: typeof Bot }[] = [
    { id: 'ai', label: 'Devolver ao agente de IA', icon: Bot },
    { id: 'human', label: 'Assumir a conversa', icon: Hand },
    { id: 'paused', label: 'Pausar a IA nesta conversa', icon: Pause },
  ];
  return (
    <div className="relative">
      <button type="button" onClick={() => setAberto((v) => !v)} aria-expanded={aberto} aria-label={`Quem responde: ${AI_LABEL[status]}`}
        className={cx('flex min-h-9 items-center gap-1 rounded-full px-2.5 text-xs font-semibold outline-hidden focus-visible:ring-2 focus-visible:ring-saibro-300',
          status === 'ai' ? 'bg-emerald-100 text-emerald-800' : status === 'paused' ? 'bg-stone-100 text-stone-600' : 'bg-saibro-100 text-saibro-800')}>
        {status === 'ai' ? <Bot size={14} aria-hidden /> : status === 'paused' ? <Pause size={14} aria-hidden /> : <Hand size={14} aria-hidden />}
        <span className={cx('hidden', compact ? '2xl:inline' : 'lg:inline')}>{AI_LABEL[status]}</span>
      </button>
      {aberto && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-60 overflow-hidden rounded-xl border border-stone-200 bg-white py-1 shadow-lg">
          {opcoes.filter((o) => o.id !== status).map((o) => (
            <button key={o.id} type="button" role="menuitem" onClick={() => { setAberto(false); onChange(o.id); }}
              className="flex min-h-10 w-full items-center gap-2.5 px-3 text-left text-sm hover:bg-stone-50">
              <o.icon size={15} aria-hidden /> {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
