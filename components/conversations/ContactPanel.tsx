import { useCallback, useEffect, useState } from 'react';
import { AlarmClock, BellOff, Check, Link2, Plus, Search, StickyNote, Tag, Unlink, UserRound, Users, X } from 'lucide-react';
import { cx } from '../../lib/conversations/cx';
import { formatWhatsAppDisplay } from '../../lib/conversations/phone';
import {
  addFollowup, addNote, describeConversationError, linkContact, listFollowups, listNotes, searchPeople, setConversationMeta,
  setFollowupStatus, setOptOut,
  type ChatFollowup, type ChatNote, type ConversationSummary, type PersonHit, type StaffOption,
} from '../../lib/conversations/api';
import { Avatar, displayName, linkLabel } from './ConversationCard';
import { Button, InlineAlert, fieldCls } from './ui';

/**
 * O contato ao lado da conversa: quem é no cadastro do clube e o que a equipe combinou com ele.
 * Vínculo com sócio/aluno (automático só quando o telefone é único; aqui o administrador confirma
 * ou corrige), opt-out de automações, etiquetas, responsável, retornos e notas internas.
 */

const dataHora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Valor `datetime-local` de Fortaleza → ISO em UTC. */
function localParaIso(v: string): string {
  return new Date(`${v}:00-03:00`).toISOString();
}
function isoParaLocal(d: Date): string {
  const f = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Fortaleza', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  return f.format(d).replace(' ', 'T');
}

type Props = {
  conversation: ConversationSummary;
  staff: StaffOption[];
  currentUserId: string;
  onChanged: () => void;
  onClose: () => void;
  /** Encerrar/reabrir — no celular, o cabeçalho da conversa não tem espaço para ele. */
  onToggleStatus?: () => void;
};

export default function ContactPanel({ conversation: c, staff, currentUserId, onChanged, onClose, onToggleStatus }: Props) {
  const [notas, setNotas] = useState<ChatNote[]>([]);
  const [retornos, setRetornos] = useState<ChatFollowup[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [novaNota, setNovaNota] = useState('');
  const [novaTag, setNovaTag] = useState('');
  const [formRetorno, setFormRetorno] = useState(false);
  const [quando, setQuando] = useState(() => isoParaLocal(new Date(Date.now() + 24 * 3600 * 1000)));
  const [obs, setObs] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [vinculando, setVinculando] = useState(false);
  const [buscaPessoa, setBuscaPessoa] = useState('');
  const [pessoas, setPessoas] = useState<PersonHit[]>([]);
  const grupo = c.kind === 'group';
  const vinculo = linkLabel(c);

  const carregar = useCallback(async () => {
    setErro(null);
    const [n, f] = await Promise.allSettled([listNotes(c.id), listFollowups(c.id)]);
    if (n.status === 'fulfilled') setNotas(n.value);
    if (f.status === 'fulfilled') setRetornos(f.value);
  }, [c.id]);

  useEffect(() => { void carregar(); }, [carregar]);

  useEffect(() => {
    if (!vinculando || buscaPessoa.trim().length < 2) { setPessoas([]); return; }
    const t = setTimeout(() => { searchPeople(buscaPessoa).then(setPessoas).catch(() => setPessoas([])); }, 300);
    return () => clearTimeout(t);
  }, [buscaPessoa, vinculando]);

  async function meta(m: { tags?: string[]; assignedTo?: string | null }) {
    setErro(null);
    try { await setConversationMeta(c.id, m); onChanged(); } catch (e) { setErro(describeConversationError(e)); }
  }

  async function salvar(fn: () => Promise<void>) {
    setSalvando(true);
    setErro(null);
    try { await fn(); await carregar(); onChanged(); } catch (e) { setErro(e instanceof Error ? e.message : describeConversationError(e)); } finally { setSalvando(false); }
  }

  const pendentes = retornos.filter((r) => r.status === 'pending');

  return (
    <aside aria-label="Contato" className="flex h-full min-h-0 w-full flex-col overflow-y-auto bg-white">
      <div className="flex items-center justify-between border-b border-stone-200 px-4 py-2">
        <span className="text-sm font-bold text-stone-800">{grupo ? 'Grupo' : 'Contato'}</span>
        <button type="button" onClick={onClose} aria-label="Fechar painel do contato" className="grid h-9 w-9 place-items-center rounded-full outline-hidden hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-saibro-300">
          <X size={18} aria-hidden />
        </button>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 p-4">
        {erro && <InlineAlert tone="error" title={erro} onDismiss={() => setErro(null)} />}

        <div className="flex flex-col items-center text-center">
          <Avatar name={c.title} url={c.avatar_url} size={72} group={grupo} />
          <p className="mt-2 text-base font-bold text-stone-800">{displayName(c)}</p>
          <p className="text-sm text-stone-500">{grupo ? 'Grupo do WhatsApp' : formatWhatsAppDisplay(c.destination)}</p>
          {onToggleStatus && (
            <Button size="sm" variant="secondary" className="mt-2 sm:hidden" onClick={onToggleStatus}>
              {c.status === 'open' ? 'Encerrar conversa' : 'Reabrir conversa'}
            </Button>
          )}
        </div>

        {c.ai_status === 'human' && c.handoff_note && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <p className="font-bold">{c.handoff_kind === 'soft' ? 'A IA pediu apoio' : 'Transferida pela IA'}</p>
            <p className="mt-0.5">{c.handoff_note}</p>
          </div>
        )}

        {!grupo && (
          <Secao titulo="Cadastro no clube" icone={Link2}>
            <div className="flex flex-wrap items-center gap-2">
              {vinculo && <span className={cx('rounded-full px-2.5 py-1 text-xs font-bold', vinculo.tone)}>{vinculo.text}</span>}
              {c.profile_name && <span className="text-sm font-semibold text-stone-800">{c.profile_name}</span>}
            </div>
            {c.link_status === 'ambiguous' && (
              <p className="mt-1 text-xs text-amber-800">Mais de um cadastro usa este telefone. Nada é ligado sozinho: confirme abaixo. Enquanto isso, a IA e as automações não tratam este contato como sócio ou aluno.</p>
            )}
            {c.link_status === 'none' && !c.profile_id && !c.student_id && (
              <p className="mt-1 text-xs text-stone-500">Nenhum sócio ou aluno com este telefone. A IA não faz reserva sem cadastro identificado.</p>
            )}
            {c.contact_id && (vinculando ? (
              <div className="mt-2 grid gap-2 rounded-lg border border-stone-200 p-2">
                <label className="relative block">
                  <span className="sr-only">Buscar cadastro</span>
                  <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" aria-hidden />
                  <input value={buscaPessoa} onChange={(e) => setBuscaPessoa(e.target.value)} placeholder="Nome do sócio ou aluno" className={cx(fieldCls, 'min-h-9 pl-8')} />
                </label>
                <ul className="grid gap-1">
                  {pessoas.map((p) => (
                    <li key={`${p.kind}:${p.id}`}>
                      <button type="button" disabled={salvando}
                        onClick={() => void salvar(async () => {
                          await linkContact(c.contact_id as string, p.kind === 'profile' ? { profileId: p.id } : { studentId: p.id });
                          setVinculando(false); setBuscaPessoa('');
                        })}
                        className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-stone-50">
                        <span className="min-w-0 truncate font-semibold">{p.name}</span>
                        <span className="shrink-0 text-xs text-stone-500">{p.kind === 'profile' ? 'Sócio' : 'Aluno'}{p.hint ? ` · ${p.hint}` : ''}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <Button size="sm" variant="ghost" onClick={() => setVinculando(false)}>Cancelar</Button>
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => setVinculando(true)}><Link2 size={14} aria-hidden /> {c.profile_id || c.student_id ? 'Trocar vínculo' : 'Vincular cadastro'}</Button>
                {(c.profile_id || c.student_id) && (
                  <Button size="sm" variant="ghost" loading={salvando} onClick={() => void salvar(() => linkContact(c.contact_id as string, {}))}><Unlink size={14} aria-hidden /> Desvincular</Button>
                )}
              </div>
            ))}
          </Secao>
        )}

        {!grupo && c.contact_id && (
          <Secao titulo="Automações" icone={BellOff}>
            <label className="flex min-h-10 items-center gap-2 text-sm">
              <input type="checkbox" checked={c.opt_out} disabled={salvando}
                onChange={(e) => void salvar(() => setOptOut(c.contact_id as string, e.target.checked))} className="h-4 w-4 accent-saibro-600" />
              Não enviar mensagens automáticas a este contato
            </label>
            <p className="text-[11px] text-stone-500">Marcado sozinho quando a pessoa pede para parar (“parar”, “não quero receber”).</p>
          </Secao>
        )}

        {grupo && (
          <Secao titulo="Grupo" icone={Users}>
            <p className="text-xs text-stone-600">Grupos só são gravados depois de permitidos em <strong>Canal</strong>. A IA só atende quem chamar a conta institucional por menção direta.</p>
          </Secao>
        )}

        <Secao titulo="Etiquetas" icone={Tag}>
          <div className="flex flex-wrap gap-1.5">
            {c.tags.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-xs">
                #{t}
                <button type="button" aria-label={`Remover etiqueta ${t}`} onClick={() => void meta({ tags: c.tags.filter((x) => x !== t) })}
                  className="text-stone-400 hover:text-red-600"><X size={12} aria-hidden /></button>
              </span>
            ))}
            {c.tags.length === 0 && <span className="text-xs text-stone-500">Nenhuma</span>}
          </div>
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); const t = novaTag.trim().toLowerCase(); if (t) { void meta({ tags: [...c.tags, t] }); setNovaTag(''); } }}>
            <input value={novaTag} onChange={(e) => setNovaTag(e.target.value)} maxLength={30} placeholder="aula, torneio, reclamação…"
              className={cx(fieldCls, 'min-h-9 min-w-0 flex-1 px-2')} aria-label="Nova etiqueta" />
            <Button size="sm" variant="secondary" type="submit" disabled={!novaTag.trim()} aria-label="Adicionar etiqueta"><Plus size={14} aria-hidden /></Button>
          </form>
        </Secao>

        <Secao titulo="Responsável" icone={UserRound}>
          <select value={c.assigned_to ?? ''} onChange={(e) => void meta({ assignedTo: e.target.value || null })}
            className={cx(fieldCls, 'min-h-9 px-2')} aria-label="Responsável pela conversa">
            <option value="">Sem responsável</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}{s.id === currentUserId ? ' (você)' : ''}</option>)}
          </select>
        </Secao>

        <Secao titulo="Retornos" icone={AlarmClock}>
          {pendentes.length === 0 && !formRetorno && <p className="text-xs text-stone-500">Nenhum retorno agendado.</p>}
          <ul className="grid gap-1.5">
            {pendentes.map((r) => {
              const vencido = new Date(r.due_at) <= new Date();
              return (
                <li key={r.id} className={cx('rounded-lg border p-2 text-xs', vencido ? 'border-red-200 bg-red-50' : 'border-stone-200')}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={cx('font-semibold', vencido && 'text-red-700')}>{dataHora.format(new Date(r.due_at))}</span>
                    <span className="flex gap-1">
                      <button type="button" onClick={() => void salvar(() => setFollowupStatus(r.id, 'done'))} aria-label="Concluir retorno" className="grid h-8 w-8 place-items-center rounded-full text-emerald-700 hover:bg-emerald-100"><Check size={14} aria-hidden /></button>
                      <button type="button" onClick={() => void salvar(() => setFollowupStatus(r.id, 'canceled'))} aria-label="Cancelar retorno" className="grid h-8 w-8 place-items-center rounded-full text-stone-500 hover:bg-stone-100"><X size={14} aria-hidden /></button>
                    </span>
                  </div>
                  {r.note && <p className="mt-0.5 text-stone-700">{r.note}</p>}
                  {r.send_body && <p className="mt-0.5 italic text-stone-500">Envia: “{r.send_body}”</p>}
                </li>
              );
            })}
          </ul>
          {formRetorno ? (
            <form className="mt-2 grid gap-2 rounded-lg border border-stone-200 p-2" onSubmit={(e) => {
              e.preventDefault();
              void salvar(async () => {
                await addFollowup({ conversationId: c.id, dueAt: localParaIso(quando), note: obs, sendBody: mensagem || null });
                setFormRetorno(false); setObs(''); setMensagem('');
              });
            }}>
              <label className="text-xs font-semibold">Quando
                <input type="datetime-local" required value={quando} onChange={(e) => setQuando(e.target.value)} className={cx(fieldCls, 'mt-1 min-h-9 px-2 font-normal')} />
              </label>
              <label className="text-xs font-semibold">Lembrete para a equipe
                <input value={obs} onChange={(e) => setObs(e.target.value)} maxLength={500} placeholder="Confirmar horário da aula"
                  className={cx(fieldCls, 'mt-1 min-h-9 px-2 font-normal')} />
              </label>
              <label className="text-xs font-semibold">Mensagem automática (opcional)
                <textarea value={mensagem} onChange={(e) => setMensagem(e.target.value)} rows={2} maxLength={4096}
                  placeholder="Oi, {nome}! Conseguiu ver a quadra?" className={cx(fieldCls, 'mt-1 py-1.5 font-normal')} />
                <span className="mt-0.5 block font-normal text-stone-500">Se preencher, sai sozinha no WhatsApp na hora marcada.</span>
              </label>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" type="button" onClick={() => setFormRetorno(false)}>Cancelar</Button>
                <Button size="sm" variant="primary" type="submit" loading={salvando}>Agendar</Button>
              </div>
            </form>
          ) : (
            <Button size="sm" variant="secondary" className="mt-2" onClick={() => setFormRetorno(true)}><Plus size={14} aria-hidden /> Agendar retorno</Button>
          )}
        </Secao>

        <Secao titulo="Notas internas" icone={StickyNote}>
          <p className="-mt-1 mb-2 text-[11px] text-stone-500">Só administradores veem. Ficam assinadas e não podem ser editadas.</p>
          <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); if (novaNota.trim()) void salvar(async () => { await addNote(c.id, novaNota); setNovaNota(''); }); }}>
            <textarea value={novaNota} onChange={(e) => setNovaNota(e.target.value)} rows={2} maxLength={4000} placeholder="Prefere jogar à noite…"
              className={cx(fieldCls, 'py-1.5')} aria-label="Nova nota" />
            <Button size="sm" variant="secondary" type="submit" className="justify-self-end" disabled={!novaNota.trim()} loading={salvando}>Salvar nota</Button>
          </form>
          <ul className="mt-2 grid gap-2">
            {notas.map((n) => (
              <li key={n.id} className="rounded-lg bg-amber-50 p-2 text-sm">
                <p className="whitespace-pre-wrap">{n.body}</p>
                <p className="mt-1 text-[11px] text-stone-500">{n.author?.name ?? 'Equipe'} · {dataHora.format(new Date(n.created_at))}</p>
              </li>
            ))}
          </ul>
        </Secao>
      </div>
    </aside>
  );
}

function Secao({ titulo, icone: Icone, children }: { titulo: string; icone?: typeof Tag; children: React.ReactNode }) {
  return (
    <section className="min-w-0 break-words border-t border-stone-200 pt-3">
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-stone-500">
        {Icone && <Icone size={13} aria-hidden />} {titulo}
      </h3>
      {children}
    </section>
  );
}
