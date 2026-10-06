import { useCallback, useEffect, useState } from 'react';
import { AtSign, CheckCircle2, Link2, Plug, PlugZap, QrCode, RefreshCw, ShieldCheck, ShieldOff, Users } from 'lucide-react';
import { cx } from '../../lib/conversations/cx';
import { useAsync } from '../finance/hooks';
import { useConfirm } from '../../hooks/useConfirm';
import { notify } from '../../lib/notifications';
import {
  aiHealth, describeConversationError, getChannel, instanceConnect, instanceDisconnect, instanceStatus, listGroups, listMentionSamples,
  registerWebhook, saveChannel, setAiChannel, setGroup, setMentionVerified,
  type Channel, type ChannelGroup, type WhatsappConnection,
} from '../../lib/conversations/api';
import { Badge, Button, Card, Empty, Field, InlineAlert, Notice, Spinner, fieldCls } from './ui';

/**
 * Canal: a instância de WhatsApp do clube (UazAPI), o webhook, a identidade da conta institucional,
 * a verificação da menção direta e os grupos. O token da instância e o do webhook NUNCA chegam
 * aqui — o servidor guarda e só devolve o estado já traduzido.
 */

const dataHora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const GROUP_STATUS = { detected: ['Detectado', 'info'], allowed: ['Permitido', 'good'], blocked: ['Bloqueado', 'bad'] } as const;

export default function ChannelTab() {
  const canal = useAsync(getChannel, []);
  const grupos = useAsync(listGroups, []);
  const saude = useAsync(aiHealth, []);
  const amostras = useAsync(listMentionSamples, []);

  const recarregarTudo = useCallback(() => { canal.reload(); grupos.reload(); amostras.reload(); }, [canal, grupos, amostras]);

  if (canal.error) return <Notice tone="bad" title="Não foi possível carregar o canal">{describeConversationError(canal.error)}</Notice>;
  if (!canal.data) return <Spinner label="Carregando canal…" />;
  const c = canal.data;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-black text-stone-800">Canal do WhatsApp</h2>
        <p className="text-xs text-stone-500">Uma única conexão alimenta o chat, as automações e a IA.</p>
      </div>
      <InstanceCard configured={saude.data?.whatsappConfigured} />
      <WebhookCard canal={c} onDone={canal.reload} />
      <IdentityCard canal={c} onSaved={canal.reload} />
      <MentionCard canal={c} amostras={amostras.data ?? []} onChanged={recarregarTudo} onRefresh={amostras.reload} />
      <AiChannelCard canal={c} aiConfigured={saude.data?.aiConfigured} onChanged={recarregarTudo} />
      <GroupsCard canal={c} grupos={grupos.data ?? []} loading={grupos.loading && !grupos.data} onChanged={recarregarTudo} />
    </div>
  );
}

/* ------------------------------------------------------------------ instância */

function InstanceCard({ configured }: { configured?: boolean }) {
  const [con, setCon] = useState<WhatsappConnection | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const atualizar = useCallback(async () => {
    setErro(null);
    try { setCon(await instanceStatus()); } catch (e) { setCon(null); setErro(describeConversationError(e)); }
  }, []);
  useEffect(() => { void atualizar(); }, [atualizar]);
  // Enquanto espera a leitura do QR, confere a cada 5s.
  useEffect(() => {
    if (con?.state !== 'connecting') return;
    const t = setInterval(() => void atualizar(), 5000);
    return () => clearInterval(t);
  }, [con?.state, atualizar]);

  async function agir(fn: () => Promise<WhatsappConnection>) {
    setOcupado(true);
    setErro(null);
    try { setCon(await fn()); } catch (e) { setErro(describeConversationError(e)); } finally { setOcupado(false); }
  }

  const estado = con?.state === 'connected' ? ['Conectado', 'good'] as const : con?.state === 'connecting' ? ['Aguardando leitura do QR', 'warn'] as const : ['Desconectado', 'bad'] as const;

  return (
    <Card title="Instância do WhatsApp" subtitle="O número do clube, conectado por QR Code (UazAPI)." right={con ? <Badge tone={estado[1]}>{estado[0]}</Badge> : undefined}>
      {configured === false && (
        <Notice tone="warn" title="Servidor sem credenciais do provedor">Defina <code>UAZAPI_SERVER_URL</code> e <code>STC_UAZAPI_INSTANCE_TOKEN</code> nos segredos das funções. Sem elas nada é enviado nem recebido.</Notice>
      )}
      {erro && <InlineAlert tone="error" title={erro} onDismiss={() => setErro(null)} />}
      {con?.state === 'connected' && <p className="mt-2 text-sm text-stone-700">{con.profileName ?? 'Conta conectada'}{con.phone ? ` · +${con.phone}` : ''}</p>}
      {con?.state === 'connecting' && con.qrcode && (
        <div className="mt-3 flex flex-col items-center gap-2">
          <img src={con.qrcode} alt="QR Code para conectar o WhatsApp" className="h-56 w-56 rounded-xl border border-stone-200" />
          <p className="max-w-xs text-center text-xs text-stone-500">No celular do clube: WhatsApp → Aparelhos conectados → Conectar um aparelho.</p>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" loading={ocupado} onClick={() => void atualizar()}><RefreshCw size={14} aria-hidden /> Atualizar</Button>
        {con?.state !== 'connected' && <Button variant="primary" loading={ocupado} onClick={() => void agir(instanceConnect)}><QrCode size={14} aria-hidden /> Conectar</Button>}
        {con?.state === 'connected' && <Button variant="danger" loading={ocupado} onClick={() => void agir(instanceDisconnect)}><PlugZap size={14} aria-hidden /> Desconectar</Button>}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ webhook */

function WebhookCard({ canal, onDone }: { canal: Channel; onDone: () => void }) {
  const confirm = useConfirm();
  const [ocupado, setOcupado] = useState(false);

  async function registrar() {
    if (!await confirm({
      title: 'Registrar o webhook agora?',
      description: 'Gera um token novo e aponta a instância para a função de recebimento. A URL anterior deixa de valer.',
      confirmLabel: 'Registrar',
    })) return;
    setOcupado(true);
    try { await registerWebhook(); notify.success('Webhook registrado na instância.'); onDone(); }
    catch (e) { notify.error('Não foi possível registrar o webhook', { description: describeConversationError(e) }); }
    finally { setOcupado(false); }
  }

  return (
    <Card title="Recebimento (webhook)" subtitle="Como as mensagens chegam ao STC.">
      <p className="text-sm text-stone-700">
        {canal.inbound_token_rotated_at ? <>Registrado em {dataHora.format(new Date(canal.inbound_token_rotated_at))}.</> : <>Ainda não registrado: o STC não recebe mensagens.</>}
      </p>
      <p className="mt-1 text-xs text-stone-500">O token da URL fica só no servidor (no banco guarda-se apenas o hash) e não é exibido aqui. A instância é configurada <strong>sem</strong> filtrar grupos: quem decide gravar um grupo é você, abaixo.</p>
      <Button className="mt-3" variant="primary" loading={ocupado} onClick={() => void registrar()}><Link2 size={14} aria-hidden /> {canal.inbound_token_rotated_at ? 'Registrar de novo (novo token)' : 'Registrar webhook'}</Button>
    </Card>
  );
}

/* ------------------------------------------------------------------ identidade */

function IdentityCard({ canal, onSaved }: { canal: Channel; onSaved: () => void }) {
  const [nome, setNome] = useState(canal.institutional_name);
  const [fone, setFone] = useState(canal.bot_phone ?? '');
  const [lids, setLids] = useState(canal.bot_lids.join(', '));
  const [min, setMin] = useState(canal.group_session_minutes);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      await saveChannel({
        institutional_name: nome, bot_phone: fone.replace(/\D/g, '') || null,
        bot_lids: lids.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean), group_session_minutes: min,
      });
      notify.success('Identidade da conta salva.');
      onSaved();
    } catch (e) { setErro(describeConversationError(e)); } finally { setSalvando(false); }
  }

  return (
    <Card title="Conta institucional" subtitle="Como o WhatsApp identifica a conta do clube nas menções dos grupos.">
      {erro && <InlineAlert tone="error" title={erro} onDismiss={() => setErro(null)} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nome da conta" hint="Só informativo: a IA NUNCA reconhece menção pelo nome digitado no texto."><input className={fieldCls} value={nome} maxLength={80} onChange={(e) => setNome(e.target.value)} /></Field>
        <Field label="Telefone da conta (com DDI)" hint="Ex.: 5588999990000"><input className={fieldCls} inputMode="numeric" value={fone} onChange={(e) => setFone(e.target.value)} placeholder="5588999990000" /></Field>
        <Field label="LIDs da conta (opcional)" hint="Identificador interno que o WhatsApp usa em grupos. Separe por vírgula."><input className={fieldCls} value={lids} onChange={(e) => setLids(e.target.value)} /></Field>
        <Field label="A IA segue atendendo quem a chamou no grupo por (min)"><input type="number" min={2} max={120} className={fieldCls} value={min} onChange={(e) => setMin(Number(e.target.value))} /></Field>
      </div>
      <Button className="mt-3" variant="primary" loading={salvando} onClick={() => void salvar()}>Salvar identidade</Button>
    </Card>
  );
}

/* ------------------------------------------------------------------ menção */

function MentionCard({ canal, amostras, onChanged, onRefresh }: {
  canal: Channel; amostras: Awaited<ReturnType<typeof listMentionSamples>>; onChanged: () => void; onRefresh: () => void;
}) {
  const confirm = useConfirm();
  const [ocupado, setOcupado] = useState(false);
  const verificada = Boolean(canal.mention_verified_at);
  const temIdentidade = Boolean(canal.bot_phone) || canal.bot_lids.length > 0;

  async function alternar() {
    if (!verificada && !await confirm({
      title: 'Marcar a menção como verificada?',
      description: 'Confirme que, com mensagens REAIS de um grupo de teste, a coluna abaixo mostrou “chamou o STC” só quando a conta institucional foi marcada de verdade — e “sem menção direta” para @todos, outras pessoas e o nome digitado. Sem essa conferência, a IA não deve atender grupos.',
      confirmLabel: 'Já conferi',
    })) return;
    setOcupado(true);
    try { await setMentionVerified(!verificada); notify.success(verificada ? 'Verificação removida: a IA em grupos foi desligada.' : 'Menção marcada como verificada.'); onChanged(); }
    catch (e) { notify.error('Não foi possível alterar', { description: describeConversationError(e) }); }
    finally { setOcupado(false); }
  }

  return (
    <Card title="Menção direta em grupos" subtitle="A IA só responde em grupo quando a conta institucional é marcada de verdade."
      right={<Badge tone={verificada ? 'good' : 'warn'}>{verificada ? 'Verificada' : 'Não verificada'}</Badge>}>
      <Notice tone="info" title="Como verificar (uma vez)">
        <ol className="list-decimal space-y-0.5 pl-4">
          <li>Informe o telefone (ou LID) da conta acima e registre o webhook.</li>
          <li>Num grupo de teste, <strong>permita</strong> o grupo (seção abaixo).</li>
          <li>De outro celular, envie: uma mensagem marcando a conta institucional; outra com <em>@todos</em>; outra marcando uma pessoa; outra só digitando “STC Institucional”.</li>
          <li>Confira abaixo: só a primeira deve aparecer como <strong>chamou o STC</strong>. Se o provedor não entregar a lista de menções, nenhuma será reconhecida (o sistema não adivinha).</li>
        </ol>
      </Notice>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant={verificada ? 'danger' : 'primary'} loading={ocupado} disabled={!verificada && !temIdentidade} onClick={() => void alternar()}>
          {verificada ? <><ShieldOff size={14} aria-hidden /> Remover verificação</> : <><ShieldCheck size={14} aria-hidden /> Marcar como verificada</>}
        </Button>
        <Button variant="secondary" onClick={onRefresh}><RefreshCw size={14} aria-hidden /> Atualizar amostras</Button>
        {!verificada && !temIdentidade && <span className="text-xs text-amber-700">Informe o telefone ou LID da conta primeiro.</span>}
        {verificada && canal.mention_verified_at && <span className="text-xs text-stone-500">desde {dataHora.format(new Date(canal.mention_verified_at))}</span>}
      </div>
      <h4 className="mt-4 text-[11px] font-black uppercase tracking-wider text-stone-400">Últimas mensagens de grupo e como foram classificadas</h4>
      {amostras.length === 0 ? (
        <p className="mt-1 text-xs text-stone-500">Nenhuma mensagem de grupo gravada ainda (grupos só são gravados depois de permitidos).</p>
      ) : (
        <ul className="mt-1 grid gap-1">
          {amostras.map((m) => (
            <li key={m.id} className="flex items-start justify-between gap-2 rounded-xl border border-stone-100 px-3 py-2 text-xs">
              <span className="min-w-0">
                <span className="block truncate text-stone-700">{m.body ?? '(sem texto)'}</span>
                <span className="text-[10px] text-stone-400">{dataHora.format(new Date(m.created_at))}{m.mention_evidence ? ` · evidência: ${m.mention_evidence}` : ''}</span>
              </span>
              <span className={cx('inline-flex shrink-0 items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold', m.mention_direct ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-100 text-stone-500')}>
                <AtSign size={10} aria-hidden /> {m.mention_direct ? 'chamou o STC' : 'sem menção direta'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ IA no canal */

function AiChannelCard({ canal, aiConfigured, onChanged }: { canal: Channel; aiConfigured?: boolean; onChanged: () => void }) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const verificada = Boolean(canal.mention_verified_at);

  async function mudar(direct: boolean, group: boolean) {
    setOcupado(true);
    setErro(null);
    try { await setAiChannel(direct, group); notify.success('Chaves da IA atualizadas.'); onChanged(); }
    catch (e) { setErro(describeConversationError(e)); } finally { setOcupado(false); }
  }

  return (
    <Card title="IA neste canal" subtitle="Duas chaves separadas. Os modelos e regras ficam na aba IA.">
      {aiConfigured === false && <Notice tone="warn" title="Provedor de IA sem chave no servidor">Defina <code>STC_AI_API_KEY</code> (e, se não for OpenRouter, <code>STC_AI_BASE_URL</code>) nos segredos das funções. Sem isso a IA transfere para a equipe.</Notice>}
      {erro && <InlineAlert tone="error" title={erro} onDismiss={() => setErro(null)} />}
      <label className="mt-2 flex min-h-11 items-center gap-2 text-sm font-semibold">
        <input type="checkbox" className="h-4 w-4 accent-saibro-600" checked={canal.ai_direct_enabled} disabled={ocupado} onChange={(e) => void mudar(e.target.checked, canal.ai_group_enabled)} />
        IA atende conversas individuais
      </label>
      <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
        <input type="checkbox" className="h-4 w-4 accent-saibro-600" checked={canal.ai_group_enabled} disabled={ocupado || !verificada} onChange={(e) => void mudar(canal.ai_direct_enabled, e.target.checked)} />
        IA atende grupos (só quem a marcar diretamente)
      </label>
      {!verificada && <p className="text-xs text-amber-700">Grupos ficam bloqueados enquanto a menção direta não estiver verificada.</p>}
    </Card>
  );
}

/* ------------------------------------------------------------------ grupos */

function GroupsCard({ canal, grupos, loading, onChanged }: { canal: Channel; grupos: ChannelGroup[]; loading: boolean; onChanged: () => void }) {
  const [ocupado, setOcupado] = useState<string | null>(null);

  async function mudar(g: ChannelGroup, status: ChannelGroup['status'], ai: boolean) {
    setOcupado(g.id);
    try { await setGroup(g.id, status, ai); onChanged(); }
    catch (e) { notify.error('Não foi possível alterar o grupo', { description: describeConversationError(e) }); }
    finally { setOcupado(null); }
  }

  return (
    <Card title="Grupos" subtitle="Um grupo só é gravado depois de permitido. Detectados aparecem aqui sem guardar mensagens.">
      {loading ? <Spinner /> : grupos.length === 0 ? (
        <Empty title="Nenhum grupo detectado" hint="Quando alguém escrever num grupo do número do clube, ele aparece aqui para você permitir ou bloquear." icon={<Users size={26} />} />
      ) : (
        <ul className="grid gap-2">
          {grupos.map((g) => {
            const [rotulo, tom] = GROUP_STATUS[g.status];
            return (
              <li key={g.id} className="rounded-2xl border border-stone-100 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-stone-800">{g.name ?? 'Grupo sem nome'}</p>
                    <p className="text-[11px] text-stone-400">{g.events_seen} evento{g.events_seen === 1 ? '' : 's'} · último {dataHora.format(new Date(g.last_seen_at))}</p>
                  </div>
                  <Badge tone={tom}>{rotulo}</Badge>
                </div>
                {g.last_payload_shape && (
                  <details className="mt-2 text-xs text-stone-500">
                    <summary className="cursor-pointer font-semibold">Campos que o provedor entregou no último evento</summary>
                    <pre className="mt-1 max-h-40 overflow-auto rounded-lg bg-stone-50 p-2 text-[10px]">{JSON.stringify(g.last_payload_shape, null, 1)}</pre>
                    <p className="mt-1">Só nomes de campos (nunca o conteúdo): serve para conferir se a lista de menções existe no payload.</p>
                  </details>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {g.status !== 'allowed' && <Button size="sm" variant="primary" loading={ocupado === g.id} onClick={() => void mudar(g, 'allowed', false)}><CheckCircle2 size={13} aria-hidden /> Permitir</Button>}
                  {g.status !== 'blocked' && <Button size="sm" variant="danger" loading={ocupado === g.id} onClick={() => void mudar(g, 'blocked', false)}><Plug size={13} aria-hidden /> Bloquear</Button>}
                  {g.status === 'allowed' && (
                    <label className="flex min-h-9 items-center gap-1.5 text-xs font-semibold">
                      <input type="checkbox" className="h-4 w-4 accent-saibro-600" checked={g.ai_enabled} disabled={ocupado === g.id || !canal.ai_group_enabled}
                        onChange={(e) => void mudar(g, 'allowed', e.target.checked)} />
                      IA neste grupo
                    </label>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
