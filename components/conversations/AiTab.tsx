import { useState } from 'react';
import { Bot, CalendarCheck, ShieldCheck } from 'lucide-react';
import { cx } from '../../lib/conversations/cx';
import { useAsync } from '../finance/hooks';
import { notify } from '../../lib/notifications';
import { aiHealth, describeConversationError, getAiSettings, listProposals, saveAiSettings, type AiSettings, type BookingProposal } from '../../lib/conversations/api';
import { ACTION_LABEL, PROPOSAL_STATUS_LABEL, describeFailure, proposalSummary } from '../../lib/conversations/aiModel';
import { Badge, Button, Card, Empty, Field, InlineAlert, Notice, Spinner, fieldCls } from './ui';

/**
 * Agente de atendimento por WhatsApp. O agente ENTENDE o pedido; quem confere disponibilidade,
 * regras e grava a reserva é o sistema, e só depois de a pessoa confirmar de forma explícita.
 * Esta aba configura o agente (versionado) e mostra o que ele propôs e o que o sistema gravou.
 */

const dataHora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const TONE: Record<BookingProposal['status'], 'info' | 'good' | 'bad' | 'muted' | 'warn'> = { open: 'info', confirmed: 'good', failed: 'bad', expired: 'muted', canceled: 'muted' };

export default function AiTab() {
  const ajustes = useAsync(getAiSettings, []);
  const propostas = useAsync(listProposals, []);
  const saude = useAsync(aiHealth, []);

  if (ajustes.error) return <Notice tone="bad" title="Não foi possível carregar a IA">{describeConversationError(ajustes.error)}</Notice>;
  if (!ajustes.data) return <Spinner label="Carregando agente…" />;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-black text-stone-800">Agente de IA</h2>
        <p className="text-xs text-stone-500">Atende o WhatsApp do clube e grava reservas na mesma tabela do aplicativo, com as mesmas regras (conferidas pelo servidor).</p>
      </div>
      {saude.data?.aiConfigured === false && (
        <Notice tone="warn" title="Provedor de IA sem chave no servidor">Defina <code>STC_AI_API_KEY</code> nos segredos das funções. Sem ela, o agente transfere tudo para a equipe.</Notice>
      )}
      <Guardrails />
      <SettingsCard settings={ajustes.data} onSaved={ajustes.reload} />
      <Card title="Reservas propostas pelo agente" subtitle="Cada reserva exige confirmação explícita; o sistema revalida na hora de gravar." right={<Button size="sm" variant="secondary" onClick={propostas.reload}>Atualizar</Button>}>
        {propostas.loading && !propostas.data ? <Spinner /> : (propostas.data ?? []).length === 0 ? (
          <Empty title="Nenhuma proposta ainda" hint="Quando o agente montar uma reserva para alguém confirmar, ela aparece aqui." icon={<CalendarCheck size={26} />} />
        ) : (
          <ul className="grid gap-2">
            {(propostas.data ?? []).map((p) => (
              <li key={p.id} className="rounded-2xl border border-stone-100 p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-stone-800">{ACTION_LABEL[p.action]} · {proposalSummary(p)}</p>
                    <p className="text-[11px] text-stone-400">{dataHora.format(new Date(p.created_at))}{p.confirmed_at ? ` · confirmada ${dataHora.format(new Date(p.confirmed_at))}` : ''} · origem WhatsApp</p>
                  </div>
                  <Badge tone={TONE[p.status]}>{PROPOSAL_STATUS_LABEL[p.status]}</Badge>
                </div>
                {p.status === 'failed' && p.failure_code && <p className="mt-1 text-xs text-red-700">O sistema recusou: {describeFailure(p.failure_code)}.</p>}
                {p.reservation_id && <p className="mt-1 text-[11px] text-stone-400">Reserva #{p.reservation_id.slice(0, 8)}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Guardrails() {
  return (
    <Card title="O que o agente faz — e o que nunca faz" right={<ShieldCheck size={20} className="text-emerald-600" aria-hidden />}>
      <div className="grid gap-3 text-xs text-stone-700 sm:grid-cols-2">
        <div>
          <p className="font-black text-stone-800">Faz</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            <li>Reservar quadra (Play) e, para professor ou administrador, aula.</li>
            <li>Consultar, cancelar e remarcar reservas da própria pessoa.</li>
            <li>Responder dúvidas só com o texto “Contexto do clube” abaixo.</li>
            <li>Transferir para a equipe quando não souber ou pedirem.</li>
          </ul>
        </div>
        <div>
          <p className="font-black text-stone-800">Nunca faz</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            <li>Confirmar reserva sem “sim” explícito do solicitante.</li>
            <li>Dizer que reservou antes de o sistema gravar.</li>
            <li>Mexer em pagamentos, comprovantes, placares ou resultados.</li>
            <li>Falar de dados, cobranças ou resultados de outras pessoas, sobretudo em grupo.</li>
          </ul>
        </div>
      </div>
    </Card>
  );
}

function SettingsCard({ settings, onSaved }: { settings: AiSettings; onSaved: () => void }) {
  const [s, setS] = useState<AiSettings>(settings);
  const [palavras, setPalavras] = useState(settings.handoff_keywords.join(', '));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const sujo = JSON.stringify({ ...s, handoff_keywords: undefined }) !== JSON.stringify({ ...settings, handoff_keywords: undefined }) || palavras !== settings.handoff_keywords.join(', ');
  const semModelo = s.active && !s.model.trim();

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      await saveAiSettings({
        active: s.active, persona_name: s.persona_name, model: s.model.trim(), instructions: s.instructions, business_context: s.business_context,
        buffer_seconds: s.buffer_seconds, max_turns: s.max_turns, daily_turn_budget: s.daily_turn_budget, proposal_ttl_minutes: s.proposal_ttl_minutes,
        handoff_keywords: palavras.split(',').map((x) => x.trim()).filter(Boolean),
      });
      notify.success('Agente salvo (nova versão).');
      onSaved();
    } catch (e) { setErro(describeConversationError(e)); } finally { setSalvando(false); }
  }

  const num = (k: keyof AiSettings, min: number, max: number) => (
    <input type="number" min={min} max={max} className={fieldCls} value={Number(s[k])} onChange={(e) => setS({ ...s, [k]: Number(e.target.value) })} />
  );

  return (
    <Card title={`Configuração (versão ${settings.version})`} subtitle="Salvar cria uma versão nova; as decisões antigas continuam ligadas à versão que as produziu."
      right={<Bot size={20} className={cx(s.active ? 'text-emerald-600' : 'text-stone-300')} aria-hidden />}>
      {erro && <InlineAlert tone="error" title={erro} onDismiss={() => setErro(null)} />}
      <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
        <input type="checkbox" className="h-4 w-4 accent-saibro-600" checked={s.active} onChange={(e) => setS({ ...s, active: e.target.checked })} />
        Agente ligado
      </label>
      {semModelo && <p className="text-xs text-amber-700">Escolha o modelo para poder ligar o agente.</p>}
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <Field label="Nome da assistente"><input className={fieldCls} value={s.persona_name} maxLength={40} onChange={(e) => setS({ ...s, persona_name: e.target.value })} /></Field>
        <Field label="Modelo" hint="Identificador do modelo no provedor (ex.: openai/gpt-4o-mini). Vazio = agente desligado."><input className={fieldCls} value={s.model} maxLength={120} onChange={(e) => setS({ ...s, model: e.target.value })} aria-label="Modelo" /></Field>
      </div>
      <Field className="mt-3" label="Contexto do clube" hint="Horários, endereço, valores, regras… A IA só responde dúvidas com o que estiver escrito aqui."><textarea className={cx(fieldCls, 'py-2')} rows={5} maxLength={6000} value={s.business_context} onChange={(e) => setS({ ...s, business_context: e.target.value })} /></Field>
      <Field className="mt-3" label="Regras da casa" hint="Instruções extras de tom e de atendimento. Não afrouxam as proteções acima."><textarea className={cx(fieldCls, 'py-2')} rows={4} maxLength={6000} value={s.instructions} onChange={(e) => setS({ ...s, instructions: e.target.value })} /></Field>
      <Field className="mt-3" label="Palavras que transferem para a equipe" hint="Separe por vírgula."><input className={fieldCls} value={palavras} onChange={(e) => setPalavras(e.target.value)} /></Field>
      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        <Field label="Espera para juntar mensagens (s)">{num('buffer_seconds', 0, 60)}</Field>
        <Field label="Máx. de turnos por conversa">{num('max_turns', 1, 100)}</Field>
        <Field label="Teto de turnos por dia" hint="Controla o custo.">{num('daily_turn_budget', 1, 5000)}</Field>
        <Field label="Validade da proposta (min)">{num('proposal_ttl_minutes', 2, 120)}</Field>
      </div>
      <Button className="mt-4" variant="primary" loading={salvando} disabled={!sujo || semModelo} onClick={() => void salvar()}>Salvar nova versão</Button>
    </Card>
  );
}
