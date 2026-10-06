import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, Eye, History, Pause, Pencil, Play, Plus, Send, Settings2, Square, Zap } from 'lucide-react';
import { cx } from '../../lib/conversations/cx';
import { useAsync } from '../finance/hooks';
import { useConfirm } from '../../hooks/useConfirm';
import { notify } from '../../lib/notifications';
import {
  approveRun, cancelRun, describeConversationError, getAutomationSettings, listAutomations, listChampionshipOptions, listRecipients, listRuns,
  prepareManualRun, previewAutomation, retryFailed, saveAutomation, saveAutomationSettings, setAutomationStatus, testAutomation,
  type Automation, type AutomationPreview, type AutomationRecipient, type AutomationRun, type AutomationSettings, type ChampionshipOption,
} from '../../lib/conversations/api';
import {
  AUDIENCES, EXAMPLE_VALUES, FINANCE_STAGES, SOURCE_LABEL, STATUS_LABEL, TEMPLATES, TRIGGERS_BY_SOURCE, TRIGGER_LABEL, VARS_BY_SOURCE, VAR_HELP, WEEKDAYS,
  describeProblem, describeReason, describeSchedule, draftProblems, renderExample, templateById,
  type AutomationDraft,
} from '../../lib/conversations/automationModel';
import { Badge, Button, Card, Empty, Field, InlineAlert, LoadingSpinner, Notice, Sheet, Spinner, fieldCls } from './ui';

/**
 * Automações de WhatsApp do clube. Cada uma nasce de um modelo guiado (nada de expressão livre),
 * lê dados REAIS do STC (financeiro, Card Mensal, campeonatos) e envia pela MESMA instância e pelo
 * MESMO histórico do chat. Ativar exige a configuração completa; disparo manual passa por revisão.
 * Quem decide se um envio sai — janela de horário, anti-spam, opt-out, revalidação — é o banco.
 */

const dataHora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const STATUS_TONE = { draft: 'muted', active: 'good', paused: 'warn', ended: 'neutral' } as const;
const RUN_LABEL: Record<AutomationRun['status'], string> = { review: 'Aguardando sua aprovação', running: 'Enviando', done: 'Concluída', canceled: 'Cancelada' };
const REC_LABEL: Record<AutomationRecipient['status'], string> = {
  review: 'Em revisão', pending: 'Na fila', processing: 'Enviando', sent: 'Enviada', failed: 'Falhou', skipped: 'Não enviada', canceled: 'Cancelada',
};

function blankDraft(): AutomationDraft {
  return { ...TEMPLATES[0].draft, definition: { ...TEMPLATES[0].draft.definition }, schedule: { ...TEMPLATES[0].draft.schedule } };
}

function toDraft(a: Automation): AutomationDraft {
  return {
    name: a.name, description: a.description, objective: a.objective, source: a.source, trigger_type: a.trigger_type,
    definition: { ...a.definition }, schedule: { ...a.schedule }, message_body: a.message_body,
  };
}

export default function AutomationsTab() {
  const confirm = useConfirm();
  const lista = useAsync(listAutomations, []);
  const ajustes = useAsync(getAutomationSettings, []);
  const [editor, setEditor] = useState<{ id: string | null; draft: AutomationDraft } | null>(null);
  const [previa, setPrevia] = useState<Automation | null>(null);
  const [historico, setHistorico] = useState<Automation | null>(null);
  const [regras, setRegras] = useState(false);
  const [ocupada, setOcupada] = useState<string | null>(null);

  async function mudarStatus(a: Automation, status: 'active' | 'paused' | 'ended') {
    const textos = {
      active: { title: 'Ativar esta automação?', description: a.trigger_type === 'manual' ? 'Ela poderá ser disparada por você.' : 'A partir de agora ela passa a enviar mensagens reais pelo WhatsApp do clube, dentro da janela de horário e dos limites por contato.', confirmLabel: 'Ativar' },
      paused: { title: 'Pausar esta automação?', description: 'Os envios ainda não feitos são cancelados. O que já saiu fica no histórico.', confirmLabel: 'Pausar' },
      ended: { title: 'Encerrar esta automação?', description: 'Não dá para reativar: é preciso criar outra. Os envios pendentes são cancelados.', confirmLabel: 'Encerrar' },
    }[status];
    if (!await confirm({ ...textos, ...(status === 'active' ? {} : { tone: 'danger' as const }) })) return;
    setOcupada(a.id);
    try {
      await setAutomationStatus(a.id, status);
      notify.success(status === 'active' ? 'Automação ativada.' : status === 'paused' ? 'Automação pausada.' : 'Automação encerrada.');
      lista.reload();
    } catch (e) {
      const msg = describeConversationError(e);
      notify.error('Não foi possível mudar o estado', { description: e instanceof Error && e.message.includes('AUTOMATION_INCOMPLETE') ? incompleteText(e.message) : msg });
    } finally { setOcupada(null); }
  }

  async function dispararManual(a: Automation) {
    setOcupada(a.id);
    try {
      const r = await prepareManualRun(a.id);
      notify.success(`Público preparado: ${r.recipients} destinatário${r.recipients === 1 ? '' : 's'}. Nada foi enviado ainda.`, { description: 'Revise a lista e aprove o envio.' });
      lista.reload();
      setHistorico(a);
    } catch (e) {
      notify.error('Não foi possível preparar o envio', { description: e instanceof Error && e.message.includes('AUTOMATION_INCOMPLETE') ? incompleteText(e.message) : describeConversationError(e) });
    } finally { setOcupada(null); }
  }

  if (lista.error) return <Notice tone="bad" title="Não foi possível carregar as automações">{describeConversationError(lista.error)}</Notice>;
  if (!lista.data) return <Spinner label="Carregando automações…" />;

  const itens = lista.data;
  const geralDesligado = ajustes.data && ajustes.data.enabled === false;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-black text-stone-800">Automações</h2>
          <p className="text-xs text-stone-500">Mensalidades, Card Mensal e campeonatos, com os dados reais do STC.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setRegras(true)}><Settings2 size={16} aria-hidden /> Regras de envio</Button>
          <Button variant="primary" onClick={() => setEditor({ id: null, draft: blankDraft() })}><Plus size={16} aria-hidden /> Nova automação</Button>
        </div>
      </div>

      {geralDesligado && <Notice tone="warn" title="Envio automático desligado">Nada sai enquanto o interruptor geral estiver desligado em “Regras de envio”.</Notice>}
      <Notice tone="info" title="Como os envios acontecem">
        Automações agendadas, condicionais e por evento só rodam se o disparo periódico (função <code>conversations-dispatch</code>) estiver agendado no servidor — veja <em>docs/conversas/OPERACAO_E_MIGRATIONS.md</em>. A coluna “última execução” mostra se está rodando.
        Respeitam a janela de horário, o limite por contato e quem pediu para não receber; a IA e as automações nunca alteram pagamento, comprovante ou resultado.
      </Notice>

      {itens.length === 0 ? (
        <Empty title="Nenhuma automação ainda" hint="Comece por um modelo pronto: aviso de mensalidade, Card Mensal ou resultado de campeonato." icon={<Zap size={28} />}
          action={<Button variant="primary" onClick={() => setEditor({ id: null, draft: blankDraft() })}><Plus size={16} aria-hidden /> Nova automação</Button>} />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {itens.map((a) => (
            <li key={a.id}>
              <Card className={cx(a.status === 'ended' && 'opacity-70')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-black text-stone-800">{a.name}</h3>
                    <p className="text-xs text-stone-500">{SOURCE_LABEL[a.source]} · {TRIGGER_LABEL[a.trigger_type].split(' (')[0]}</p>
                  </div>
                  <Badge tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Badge>
                </div>
                <p className="mt-2 flex items-center gap-1.5 text-xs text-stone-600"><CalendarClock size={13} aria-hidden /> {describeSchedule(a)}</p>
                <p className="mt-2 line-clamp-3 whitespace-pre-wrap rounded-xl bg-stone-50 p-2.5 text-xs text-stone-700">{a.message_body || '(sem mensagem)'}</p>
                {a.problems.length > 0 && a.status !== 'ended' && (
                  <ul className="mt-2 grid gap-1">
                    {a.problems.map((p) => (
                      <li key={p} className="flex items-start gap-1.5 text-xs text-amber-800"><AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden /> {describeProblem(p)}</li>
                    ))}
                  </ul>
                )}
                <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
                  <Count label="Enviadas" value={a.sent} tone="good" />
                  <Count label="Na fila" value={a.pending} />
                  <Count label="Falhas" value={a.failed} tone={a.failed ? 'bad' : undefined} />
                  <Count label="Puladas" value={a.skipped} />
                </dl>
                <p className="mt-2 text-[11px] text-stone-400">Versão {a.version} · {a.last_run_at ? `última execução ${dataHora.format(new Date(a.last_run_at))}` : 'ainda não executou'}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {a.status !== 'ended' && <Button size="sm" variant="secondary" onClick={() => setEditor({ id: a.id, draft: toDraft(a) })}><Pencil size={13} aria-hidden /> Editar</Button>}
                  <Button size="sm" variant="secondary" onClick={() => setPrevia(a)}><Eye size={13} aria-hidden /> Prévia</Button>
                  <Button size="sm" variant="secondary" onClick={() => setHistorico(a)}><History size={13} aria-hidden /> Execuções</Button>
                  {a.status === 'active' && a.trigger_type === 'manual' && (
                    <Button size="sm" variant="primary" loading={ocupada === a.id} onClick={() => void dispararManual(a)}><Send size={13} aria-hidden /> Preparar envio</Button>
                  )}
                  {(a.status === 'draft' || a.status === 'paused') && (
                    <Button size="sm" variant="primary" loading={ocupada === a.id} onClick={() => void mudarStatus(a, 'active')}><Play size={13} aria-hidden /> {a.status === 'paused' ? 'Reativar' : 'Ativar'}</Button>
                  )}
                  {a.status === 'active' && <Button size="sm" variant="secondary" loading={ocupada === a.id} onClick={() => void mudarStatus(a, 'paused')}><Pause size={13} aria-hidden /> Pausar</Button>}
                  {a.status !== 'ended' && <Button size="sm" variant="danger" loading={ocupada === a.id} onClick={() => void mudarStatus(a, 'ended')}><Square size={13} aria-hidden /> Encerrar</Button>}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {editor && <EditorSheet initial={editor} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); lista.reload(); }} />}
      {previa && <PreviewSheet automation={previa} onClose={() => setPrevia(null)} />}
      {historico && <RunsSheet automation={historico} onClose={() => { setHistorico(null); lista.reload(); }} />}
      {regras && ajustes.data && <RulesSheet settings={ajustes.data} onClose={() => setRegras(false)} onSaved={() => { setRegras(false); ajustes.reload(); }} />}
    </div>
  );
}

/** `AUTOMATION_INCOMPLETE: A,B` (mensagem do banco) → frases. */
function incompleteText(message: string): string {
  const lista = message.split('AUTOMATION_INCOMPLETE:')[1]?.trim().split(/[,\s]+/).filter(Boolean) ?? [];
  return lista.length ? lista.map(describeProblem).join(' ') : describeConversationError(new Error('AUTOMATION_INCOMPLETE'));
}

const Count = ({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'bad' }) => (
  <div className="rounded-xl bg-stone-50 px-1 py-1.5">
    <dt className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">{label}</dt>
    <dd className={cx('text-base font-black tabular-nums', tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-red-600' : 'text-stone-800')}>{value}</dd>
  </div>
);

/* ------------------------------------------------------------------ editor */

function EditorSheet({ initial, onClose, onSaved }: { initial: { id: string | null; draft: AutomationDraft }; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<AutomationDraft>(initial.draft);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [problemasBanco, setProblemasBanco] = useState<string[]>([]);
  const [campeonatos, setCampeonatos] = useState<ChampionshipOption[]>([]);
  const novo = initial.id === null;
  const set = (patch: Partial<AutomationDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const def = (patch: Record<string, unknown>) => setDraft((d) => ({ ...d, definition: { ...d.definition, ...patch } }));
  const horario = (patch: Partial<AutomationDraft['schedule']>) => setDraft((d) => ({ ...d, schedule: { ...d.schedule, ...patch } }));

  useEffect(() => { listChampionshipOptions().then(setCampeonatos).catch(() => undefined); }, []);

  const problemas = useMemo(() => draftProblems(draft), [draft]);
  const precisaCampeonato = draft.source === 'championship_notice' || (draft.source === 'audience' && draft.definition.audience === 'championship_participants')
    || draft.source === 'championship_result' || draft.source === 'championship_advance';
  const campeonatoObrigatorio = precisaCampeonato && draft.source !== 'championship_result' && draft.source !== 'championship_advance';

  function escolherModelo(id: string) {
    const t = templateById(id);
    if (t) setDraft({ ...t.draft, definition: { ...t.draft.definition }, schedule: { ...t.draft.schedule } });
  }

  function mudarOrigem(source: AutomationDraft['source']) {
    const permitido = TRIGGERS_BY_SOURCE[source];
    set({ source, trigger_type: permitido.includes(draft.trigger_type) ? draft.trigger_type : permitido[0], definition: {}, schedule: permitido[0] === 'event' ? {} : draft.schedule });
  }

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      const r = await saveAutomation(initial.id, {
        name: draft.name, description: draft.description, objective: draft.objective, source: draft.source, trigger_type: draft.trigger_type,
        definition: draft.definition, schedule: draft.trigger_type === 'scheduled' ? draft.schedule : {}, message_body: draft.message_body,
      });
      if (r.problems?.length) {
        setProblemasBanco(r.problems);
        notify.success('Rascunho salvo', { description: 'Ainda há pendências: resolva-as para poder ativar.' });
      } else {
        notify.success(novo ? 'Automação criada.' : 'Automação salva.', { description: 'Ela só passa a enviar depois de ativada.' });
      }
      onSaved();
    } catch (e) {
      setErro(describeConversationError(e));
    } finally { setSalvando(false); }
  }

  const exemplo = renderExample(draft.message_body, EXAMPLE_VALUES);

  return (
    <Sheet open onClose={onClose} wide title={novo ? 'Nova automação' : 'Editar automação'}
      subtitle={novo ? 'Escolha um modelo e ajuste. Nada é enviado até você ativar.' : 'Editar uma automação ativa cria uma nova versão; o histórico fica.'}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" loading={salvando} disabled={problemas.length > 0} onClick={() => void salvar()}>Salvar</Button>
      </>}>
      {erro && <InlineAlert tone="error" title={erro} onDismiss={() => setErro(null)} />}
      {problemasBanco.length > 0 && (
        <InlineAlert tone="warning" title="Pendências para ativar" description={<ul className="list-disc pl-4">{problemasBanco.map((p) => <li key={p}>{describeProblem(p)}</li>)}</ul>} />
      )}

      {novo && (
        <Field label="Modelo">
          <select className={fieldCls} value="" onChange={(e) => e.target.value && escolherModelo(e.target.value)} aria-label="Modelo">
            <option value="">Começar de um modelo…</option>
            {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </Field>
      )}

      <Field label="Nome"><input className={fieldCls} value={draft.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} aria-label="Nome da automação" /></Field>
      <Field label="Objetivo" hint="Opcional. Para a equipe lembrar por que ela existe."><input className={fieldCls} value={draft.objective} maxLength={300} onChange={(e) => set({ objective: e.target.value })} /></Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="O que dispara" hint="A origem dos dados não muda depois de criada.">
          <select className={fieldCls} value={draft.source} disabled={!novo} onChange={(e) => mudarOrigem(e.target.value as AutomationDraft['source'])} aria-label="Origem">
            {(Object.keys(SOURCE_LABEL) as AutomationDraft['source'][]).map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
          </select>
        </Field>
        <Field label="Como roda">
          <select className={fieldCls} value={draft.trigger_type} disabled={!novo || TRIGGERS_BY_SOURCE[draft.source].length === 1}
            onChange={(e) => set({ trigger_type: e.target.value as AutomationDraft['trigger_type'] })} aria-label="Tipo de disparo">
            {TRIGGERS_BY_SOURCE[draft.source].map((t) => <option key={t} value={t}>{TRIGGER_LABEL[t]}</option>)}
          </select>
        </Field>
      </div>

      {draft.source === 'finance_charge' && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Momento">
            <select className={fieldCls} value={String(draft.definition.stage ?? '')} aria-label="Momento da mensalidade"
              onChange={(e) => { const s = FINANCE_STAGES.find((x) => x.id === e.target.value); def({ stage: e.target.value, days: s?.defaultDays ?? 1 }); }}>
              {FINANCE_STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </Field>
          <Field label="Dias (N)" hint={FINANCE_STAGES.find((s) => s.id === draft.definition.stage)?.help}>
            <input type="number" min={0} max={365} className={fieldCls} value={Number(draft.definition.days ?? 1)} onChange={(e) => def({ days: Number(e.target.value) })} />
          </Field>
          {draft.definition.stage === 'overdue' && (
            <Field label="Repetir a cada (dias)"><input type="number" min={1} max={90} className={fieldCls} value={Number(draft.definition.repeat_days ?? 7)} onChange={(e) => def({ repeat_days: Number(e.target.value) })} /></Field>
          )}
          {draft.definition.stage !== 'in_review' && (
            <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-3">
              <input type="checkbox" className="h-4 w-4 accent-saibro-600" checked={draft.definition.exclude_in_review !== false} onChange={(e) => def({ exclude_in_review: e.target.checked })} />
              Não cobrar quem já enviou comprovante em análise
            </label>
          )}
        </div>
      )}

      {draft.source === 'card_mensal' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Avisar até N dias antes do vencimento"><input type="number" min={0} max={90} className={fieldCls} value={Number(draft.definition.days_before ?? 7)} onChange={(e) => def({ days_before: Number(e.target.value) })} /></Field>
          <Field label="Avisar até N dias depois de vencer"><input type="number" min={0} max={90} className={fieldCls} value={Number(draft.definition.days_after ?? 0)} onChange={(e) => def({ days_after: Number(e.target.value) })} /></Field>
        </div>
      )}

      {draft.source === 'audience' && (
        <Field label="Público">
          <select className={fieldCls} value={String(draft.definition.audience ?? '')} aria-label="Público" onChange={(e) => def({ audience: e.target.value })}>
            {AUDIENCES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </Field>
      )}

      {precisaCampeonato && (
        <Field label={campeonatoObrigatorio ? 'Campeonato' : 'Campeonato (opcional: vazio = todos em andamento)'}>
          <select className={fieldCls} value={String(draft.definition.championship_id ?? '')} aria-label="Campeonato" onChange={(e) => def({ championship_id: e.target.value })}>
            <option value="">{campeonatoObrigatorio ? 'Escolha…' : 'Todos em andamento'}</option>
            {campeonatos.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      )}

      {(draft.source === 'championship_result' || draft.source === 'championship_advance') && (
        <Field label="Esperar o resultado assentar (minutos)" hint="Só avisa depois desse tempo sem alteração — evita avisar um placar corrigido logo em seguida.">
          <input type="number" min={0} max={240} className={fieldCls} value={Number(draft.definition.settle_minutes ?? 10)} onChange={(e) => def({ settle_minutes: Number(e.target.value) })} />
        </Field>
      )}

      {draft.trigger_type === 'scheduled' && (
        <div className="grid gap-3 rounded-2xl border border-stone-100 p-3">
          <Field label="Horário (Fortaleza)"><input type="time" className={fieldCls} value={draft.schedule.time ?? ''} onChange={(e) => horario({ time: e.target.value })} aria-label="Horário" /></Field>
          <div>
            <span className="text-[11px] font-black uppercase tracking-wider text-stone-400">Dias da semana</span>
            <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label="Dias da semana">
              {WEEKDAYS.map((nome, i) => {
                const on = (draft.schedule.weekdays ?? []).includes(i);
                return (
                  <button key={nome} type="button" aria-pressed={on}
                    onClick={() => horario({ weekdays: on ? (draft.schedule.weekdays ?? []).filter((x) => x !== i) : [...(draft.schedule.weekdays ?? []), i].sort() })}
                    className={cx('min-h-10 min-w-12 rounded-full border px-3 text-xs font-bold', on ? 'border-saibro-300 bg-saibro-50 text-saibro-700' : 'border-stone-200 bg-white text-stone-500')}>{nome}</button>
                );
              })}
            </div>
          </div>
          <Field label="Datas específicas (opcional)" hint="Se preencher, vale no lugar dos dias da semana. Separe por vírgula: 2026-10-20, 2026-11-03.">
            <input className={fieldCls} value={(draft.schedule.dates ?? []).join(', ')}
              onChange={(e) => horario({ dates: e.target.value.split(/[,\s]+/).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) })} />
          </Field>
          <Field label="Encerrar em (opcional)"><input type="date" className={fieldCls} value={draft.schedule.end_date ?? ''} onChange={(e) => horario({ end_date: e.target.value || undefined })} /></Field>
        </div>
      )}

      <Field label="Mensagem" hint="Use variáveis entre chaves duplas. Se alguma variável ficar sem valor para uma pessoa, a mensagem dela NÃO sai (nunca vai texto com lacuna).">
        <textarea className={cx(fieldCls, 'py-2')} rows={5} maxLength={1000} value={draft.message_body} onChange={(e) => set({ message_body: e.target.value })} aria-label="Mensagem" />
      </Field>
      <div className="flex flex-wrap gap-1.5" aria-label="Variáveis">
        {VARS_BY_SOURCE[draft.source].map((v) => (
          <button key={v} type="button" title={VAR_HELP[v]} onClick={() => set({ message_body: `${draft.message_body}{{${v}}}`.slice(0, 1000) })}
            className="min-h-8 rounded-full border border-stone-200 bg-white px-2.5 font-mono text-[11px] text-stone-600 hover:bg-stone-50">{`{{${v}}}`}</button>
        ))}
      </div>
      <div className="rounded-2xl bg-[#dcf8c6] p-3 text-sm text-[#17301c]">
        <p className="mb-1 text-[10px] font-black uppercase tracking-wider text-emerald-800">Exemplo com valores fictícios</p>
        <p className="whitespace-pre-wrap">{exemplo || '…'}</p>
      </div>

      {problemas.length > 0 && (
        <InlineAlert tone="warning" title="Antes de salvar" description={<ul className="list-disc pl-4">{problemas.map((p) => <li key={p}>{p}</li>)}</ul>} />
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ prévia */

function PreviewSheet({ automation, onClose }: { automation: Automation; onClose: () => void }) {
  const dados = useAsync<AutomationPreview>(() => previewAutomation(automation.id), [automation.id]);
  const [testando, setTestando] = useState(false);

  async function testar() {
    setTestando(true);
    try { await testAutomation(automation.id); notify.success('Mensagem de teste enviada para o seu WhatsApp.'); }
    catch (e) { notify.error('Não foi possível enviar o teste', { description: describeConversationError(e) }); }
    finally { setTestando(false); }
  }

  const p = dados.data;
  return (
    <Sheet open onClose={onClose} title="Prévia com dados reais" subtitle={automation.name}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Fechar</Button>
        <Button variant="secondary" loading={testando} disabled={!p || !p.rendered_example} onClick={() => void testar()}><Send size={14} aria-hidden /> Enviar teste para mim</Button>
      </>}>
      {dados.loading && !p && <Spinner />}
      {dados.error != null && <Notice tone="bad" title="Não foi possível montar a prévia">{describeConversationError(dados.error)}</Notice>}
      {p && (
        <>
          <p className="text-sm text-stone-700">Se rodasse agora: <strong>{p.estimated_recipients}</strong> destinatário{p.estimated_recipients === 1 ? '' : 's'}.</p>
          {p.problems.length > 0 && <InlineAlert tone="warning" title="Pendências" description={<ul className="list-disc pl-4">{p.problems.map((x) => <li key={x}>{describeProblem(x)}</li>)}</ul>} />}
          {p.sample.length > 0 && <p className="text-xs text-stone-500">Exemplos: {p.sample.join(', ')}</p>}
          {Object.keys(p.excluded_by_reason).length > 0 && (
            <div>
              <p className="text-[11px] font-black uppercase tracking-wider text-stone-400">Fora do público</p>
              <ul className="mt-1 grid gap-1 text-xs text-stone-600">
                {Object.entries(p.excluded_by_reason).map(([k, n]) => <li key={k} className="flex justify-between gap-2"><span>{describeReason(k)}</span><span className="tabular-nums">{n}</span></li>)}
              </ul>
            </div>
          )}
          <div className="rounded-2xl bg-[#dcf8c6] p-3 text-sm text-[#17301c]">
            <p className="mb-1 text-[10px] font-black uppercase tracking-wider text-emerald-800">Mensagem montada com os dados de {p.rendered_for ?? 'um destinatário real'}</p>
            <p className="whitespace-pre-wrap">{p.rendered_example ?? 'Ninguém no público agora, ou faltou algum dado para montar a mensagem.'}</p>
          </div>
          <p className="text-[11px] text-stone-400">O teste vai só para o telefone do seu perfil, com a marca “[TESTE]”.</p>
        </>
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ execuções */

function RunsSheet({ automation, onClose }: { automation: Automation; onClose: () => void }) {
  const confirm = useConfirm();
  const runs = useAsync(() => listRuns(automation.id), [automation.id]);
  const [aberta, setAberta] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState(false);
  const inicial = runs.data?.find((r) => r.status === 'review')?.id ?? runs.data?.[0]?.id ?? null;
  const atual = aberta ?? inicial;
  const quem = useAsync<AutomationRecipient[]>(() => (atual ? listRecipients(atual) : Promise.resolve([])), [atual]);
  const run = runs.data?.find((r) => r.id === atual) ?? null;

  const contagem = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of quem.data ?? []) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [quem.data]);

  const recarregar = useCallback(() => { runs.reload(); quem.reload(); }, [runs, quem]);

  async function agir(fn: () => Promise<unknown>, ok: string) {
    setOcupada(true);
    try { await fn(); notify.success(ok); recarregar(); }
    catch (e) { notify.error('Não foi possível concluir', { description: describeConversationError(e) }); }
    finally { setOcupada(false); }
  }

  async function aprovar() {
    if (!run) return;
    const n = contagem.review ?? 0;
    if (!await confirm({ title: `Enviar para ${n} pessoa${n === 1 ? '' : 's'}?`, description: 'As mensagens saem pelo WhatsApp do clube, respeitando a janela de horário e os limites por contato. Cada envio é conferido de novo na hora de sair.', confirmLabel: 'Aprovar e enviar' })) return;
    await agir(() => approveRun(run.id), 'Envio aprovado: as mensagens entram na fila.');
  }

  return (
    <Sheet open onClose={onClose} wide title="Execuções" subtitle={automation.name}>
      {runs.loading && !runs.data && <Spinner />}
      {runs.data && runs.data.length === 0 && <Empty title="Nenhuma execução ainda" hint={automation.trigger_type === 'manual' ? 'Use “Preparar envio” para montar o público e revisar antes de enviar.' : 'Quando o disparo periódico rodar, as execuções aparecem aqui.'} />}
      {runs.data && runs.data.length > 0 && (
        <>
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Execuções">
            {runs.data.map((r) => (
              <button key={r.id} role="tab" aria-selected={r.id === atual} onClick={() => setAberta(r.id)}
                className={cx('min-h-10 rounded-full border px-3 text-xs font-bold', r.id === atual ? 'border-saibro-300 bg-saibro-50 text-saibro-700' : 'border-stone-200 bg-white text-stone-500')}>
                {dataHora.format(new Date(r.created_at))} · {RUN_LABEL[r.status]}
              </button>
            ))}
          </div>
          {run && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={run.status === 'review' ? 'warn' : run.status === 'done' ? 'good' : run.status === 'canceled' ? 'muted' : 'info'}>{RUN_LABEL[run.status]}</Badge>
              {Object.entries(contagem).map(([k, n]) => <span key={k} className="text-xs text-stone-500">{REC_LABEL[k as AutomationRecipient['status']]}: <strong className="tabular-nums">{n}</strong></span>)}
              <span className="ml-auto flex gap-2">
                {run.status === 'review' && (
                  <>
                    <Button size="sm" variant="danger" disabled={ocupada} onClick={() => void agir(() => cancelRun(run.id), 'Execução cancelada.')}>Cancelar</Button>
                    <Button size="sm" variant="primary" loading={ocupada} disabled={!(contagem.review > 0)} onClick={() => void aprovar()}><CheckCircle2 size={14} aria-hidden /> Aprovar e enviar</Button>
                  </>
                )}
                {(contagem.failed ?? 0) > 0 && run.status !== 'review' && (
                  <Button size="sm" variant="secondary" loading={ocupada} onClick={() => void agir(() => retryFailed(run.id), 'Falhas devolvidas à fila.')}>Reenviar falhas</Button>
                )}
              </span>
            </div>
          )}
          {quem.loading && !quem.data ? <LoadingSpinner /> : (
            <ul className="grid gap-1">
              {(quem.data ?? []).map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-2 rounded-xl border border-stone-100 px-3 py-2 text-xs">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-stone-800">{r.display_name ?? 'Sem nome'}</span>
                    {r.body && <span className="block truncate text-stone-500">{r.body}</span>}
                    {(r.skip_reason || r.last_error) && <span className="block text-amber-700">{describeReason(r.skip_reason ?? r.last_error)}</span>}
                  </span>
                  <span className="shrink-0 text-right">
                    <Badge tone={r.status === 'sent' ? 'good' : r.status === 'failed' ? 'bad' : r.status === 'skipped' || r.status === 'canceled' ? 'muted' : 'info'}>{REC_LABEL[r.status]}</Badge>
                    {r.sent_at && <span className="block text-[10px] text-stone-400">{dataHora.format(new Date(r.sent_at))}</span>}
                  </span>
                </li>
              ))}
              {(quem.data ?? []).length === 0 && <li className="py-4 text-center text-xs text-stone-500">Ninguém nesta execução.</li>}
            </ul>
          )}
        </>
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ regras gerais */

function RulesSheet({ settings, onClose, onSaved }: { settings: AutomationSettings; onClose: () => void; onSaved: () => void }) {
  const [s, setS] = useState<AutomationSettings>({ ...settings, window_start: settings.window_start.slice(0, 5), window_end: settings.window_end.slice(0, 5) });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      await saveAutomationSettings({
        enabled: s.enabled, window_start: s.window_start, window_end: s.window_end, days: s.days,
        min_hours_between: s.min_hours_between, daily_cap: s.daily_cap, weekly_cap: s.weekly_cap,
      });
      notify.success('Regras de envio salvas.');
      onSaved();
    } catch (e) { setErro(describeConversationError(e)); } finally { setSalvando(false); }
  }

  return (
    <Sheet open onClose={onClose} title="Regras de envio" subtitle="Valem para TODAS as automações, somadas."
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={salvando} onClick={() => void salvar()}>Salvar</Button></>}>
      {erro && <InlineAlert tone="error" title={erro} onDismiss={() => setErro(null)} />}
      <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
        <input type="checkbox" className="h-4 w-4 accent-saibro-600" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} />
        Envio automático ligado (interruptor geral)
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Não enviar antes de"><input type="time" className={fieldCls} value={s.window_start} onChange={(e) => setS({ ...s, window_start: e.target.value })} /></Field>
        <Field label="Não enviar depois de"><input type="time" className={fieldCls} value={s.window_end} onChange={(e) => setS({ ...s, window_end: e.target.value })} /></Field>
      </div>
      <div>
        <span className="text-[11px] font-black uppercase tracking-wider text-stone-400">Dias em que pode enviar</span>
        <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label="Dias de envio">
          {WEEKDAYS.map((nome, i) => {
            const on = s.days.includes(i);
            return <button key={nome} type="button" aria-pressed={on} onClick={() => setS({ ...s, days: on ? s.days.filter((x) => x !== i) : [...s.days, i].sort() })}
              className={cx('min-h-10 min-w-12 rounded-full border px-3 text-xs font-bold', on ? 'border-saibro-300 bg-saibro-50 text-saibro-700' : 'border-stone-200 bg-white text-stone-500')}>{nome}</button>;
          })}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Horas entre mensagens"><input type="number" min={0} max={720} className={fieldCls} value={s.min_hours_between} onChange={(e) => setS({ ...s, min_hours_between: Number(e.target.value) })} /></Field>
        <Field label="Máx. por dia"><input type="number" min={1} max={10} className={fieldCls} value={s.daily_cap} onChange={(e) => setS({ ...s, daily_cap: Number(e.target.value) })} /></Field>
        <Field label="Máx. por semana"><input type="number" min={1} max={30} className={fieldCls} value={s.weekly_cap} onChange={(e) => setS({ ...s, weekly_cap: Number(e.target.value) })} /></Field>
      </div>
      <p className="text-xs text-stone-500">Limites por contato. Quem responde “parar” é marcado para não receber mais, e as mensagens pendentes dele são canceladas.</p>
    </Sheet>
  );
}
