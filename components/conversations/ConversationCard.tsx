/* eslint-disable react-refresh/only-export-components -- helpers puros exportados junto do componente (padrão do módulo financeiro) */
import { memo, useState } from 'react';
import { AlarmClock, AlertTriangle, Bot, CheckCheck, Hand, Mic, Users } from 'lucide-react';
import { cx } from '../../lib/conversations/cx';
import { formatWhatsAppDisplay } from '../../lib/conversations/phone';
import type { ConversationSummary, MessageKind } from '../../lib/conversations/api';
import type { PresenceState } from '../../lib/conversations/presenceSignalPolicy';
import { formatPresenceLabel } from '../../lib/conversations/conversationPresenceState';

/**
 * Cartão da lista, no desenho do cartão do chat do North Jato: avatar, nome, horário relativo,
 * prévia da última mensagem, "digitando…", vínculo com o cadastro do STC, etiquetas, retorno
 * pendente e não lidas. Grupo e automação aparecem identificados.
 */

const TZ = 'America/Fortaleza';
const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const semana = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'short' });
const data = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' });
const DIA = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

const diaLocalDe = (iso: string) => DIA.format(new Date(iso));
function somaDias(dia: string, n: number): string {
  const [a, m, d] = dia.split('-').map(Number);
  const t = new Date(Date.UTC(a, m - 1, d));
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** "14:32", "Ontem", "qua", "12/09" — como o WhatsApp mostra. */
export function formatLastInteraction(iso: string, now: Date = new Date()): string {
  const quando = new Date(iso);
  const dia = diaLocalDe(iso);
  const hoje = diaLocalDe(now.toISOString());
  if (dia === hoje) return hora.format(quando);
  if (dia === somaDias(hoje, -1)) return 'Ontem';
  if (dia > somaDias(hoje, -7)) return semana.format(quando).replace('.', '');
  return data.format(quando);
}

export function initials(name: string): string {
  const partes = name.replace(/^\+?\d[\d\s()-]*$/, '').trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '#';
  return ((partes[0][0] ?? '') + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase();
}

export const KIND_PREVIEW: Partial<Record<MessageKind, string>> = {
  image: '📷 Foto', video: '🎥 Vídeo', audio: '🎵 Áudio', ptt: '🎤 Áudio', document: '📄 Documento',
  sticker: '🌟 Figurinha', location: '📍 Localização', contact: '👤 Contato',
};

/** Nome que ainda é só o número (contato que nunca se identificou) aparece formatado. */
export const displayName = (c: Pick<ConversationSummary, 'title' | 'destination'>) =>
  c.title.replace(/\D/g, '') === c.destination.replace(/\D/g, '') && c.destination.replace(/\D/g, '').length >= 8
    ? formatWhatsAppDisplay(c.destination) : c.title;

export function Avatar({ name, url, size = 40, group }: { name: string; url: string | null; size?: number; group?: boolean }) {
  const [falhou, setFalhou] = useState(false);
  return url && !falhou ? (
    <img src={url} alt="" onError={() => setFalhou(true)} className="shrink-0 rounded-full border border-stone-200 object-cover" style={{ width: size, height: size }} />
  ) : (
    <div aria-hidden className="grid shrink-0 place-items-center rounded-full bg-linear-to-br from-saibro-700 to-saibro-400 font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.35 }}>
      {group ? <Users size={size * 0.45} /> : initials(name)}
    </div>
  );
}

/** Rótulo curto do vínculo com o cadastro do clube. */
export function linkLabel(c: Pick<ConversationSummary, 'kind' | 'profile_id' | 'student_id' | 'link_status'>): { text: string; tone: string } | null {
  if (c.kind === 'group') return null;
  if (c.profile_id) return { text: 'Sócio', tone: 'bg-emerald-100 text-emerald-800' };
  if (c.student_id) return { text: 'Aluno', tone: 'bg-violet-100 text-violet-800' };
  if (c.link_status === 'ambiguous') return { text: 'Cadastro a confirmar', tone: 'bg-amber-100 text-amber-800' };
  return { text: 'Sem cadastro', tone: 'bg-stone-100 text-stone-600' };
}

const AUTOR: Record<string, string> = { ai: 'IA: ', automation: 'Automação: ', staff: 'Você: ', system: '' };

type Props = {
  conversation: ConversationSummary;
  selected: boolean;
  draft: boolean;
  presence: PresenceState | null;
  onSelect: (id: string) => void;
};

function ConversationCard({ conversation: c, selected, draft, presence, onSelect }: Props) {
  const naoLidas = c.unread_count > 0;
  const retornoVencido = c.next_followup_at && new Date(c.next_followup_at) <= new Date();
  const previa = c.last_deleted ? '🚫 Mensagem apagada' : c.last_body || (c.last_message_kind && KIND_PREVIEW[c.last_message_kind]) || 'Sem mensagens';
  const digitando = formatPresenceLabel(presence);
  const transferida = c.ai_status === 'human' && Boolean(c.handoff_at) && c.last_direction !== 'outbound';
  const vinculo = linkLabel(c);

  return (
    <button
      type="button"
      onClick={() => onSelect(c.id)}
      aria-current={selected ? 'true' : undefined}
      className={cx(
        'mx-2 mb-1 flex w-[calc(100%-1rem)] min-h-[76px] items-start gap-2.5 rounded-[18px] border px-3 py-2.5 text-left outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-saibro-300',
        selected ? 'border-saibro-300 bg-saibro-50 shadow-sm' : 'border-transparent hover:border-stone-200 hover:bg-white',
      )}
    >
      <Avatar name={c.title} url={c.avatar_url} group={c.kind === 'group'} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-2">
          <span className={cx('flex min-w-0 items-center gap-1 text-stone-800', naoLidas ? 'font-bold' : 'font-semibold')}>
            <span className="truncate">{displayName(c)}</span>
            {c.ai_status === 'ai' && c.ai_session_open && <Bot size={13} className="shrink-0 text-emerald-600" aria-label="Agente de IA atendendo" />}
          </span>
          <span className={cx('shrink-0 text-[11px]', naoLidas ? 'font-semibold text-saibro-700' : 'text-stone-500')}>
            {formatLastInteraction(c.last_message_at)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className={cx('min-w-0 truncate text-[13px]', naoLidas ? 'font-medium text-stone-800' : 'text-stone-500')}>
            {digitando ? (
              <span className="font-semibold text-emerald-700">{presence === 'recording' && <Mic size={12} className="mr-0.5 inline" aria-hidden />}{digitando}</span>
            ) : draft ? (
              <><span className="font-semibold text-emerald-700">Rascunho: </span>continue de onde parou</>
            ) : (
              <>
                {c.last_direction === 'outbound' && c.last_status === 'failed' && <AlertTriangle size={12} className="mr-1 inline text-red-500" aria-label="Não enviada" />}
                {c.last_direction === 'outbound' && c.last_status !== 'failed' && !c.last_deleted && (
                  <CheckCheck size={13} className={cx('mr-1 inline', c.last_status === 'read' ? 'text-blue-500' : 'text-gray-400')} aria-hidden />
                )}
                {c.last_direction === 'outbound' ? AUTOR[c.last_origin ?? 'staff'] ?? '' : ''}{previa}
              </>
            )}
          </p>
          {naoLidas && (
            <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-bold text-white"
              aria-label={`${c.unread_count} não lida${c.unread_count > 1 ? 's' : ''}`}>
              {c.unread_count > 99 ? '99+' : c.unread_count}
            </span>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {c.kind === 'group' && <span className="inline-flex items-center gap-0.5 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-800"><Users size={10} aria-hidden /> Grupo</span>}
          {transferida && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800" title={c.handoff_note ?? undefined}>
              <Hand size={10} aria-hidden /> Transferida pela IA
            </span>
          )}
          {vinculo && <span className={cx('rounded-full px-2 py-0.5 text-[10px] font-semibold', vinculo.tone)}>{vinculo.text}</span>}
          {c.opt_out && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">Não receber automações</span>}
          {c.tags.slice(0, 3).map((t) => (
            <span key={t} className="rounded-full border border-stone-200 bg-white px-2 py-0.5 text-[10px] font-medium text-stone-600">#{t}</span>
          ))}
          {c.next_followup_at && (
            <span className={cx('inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold',
              retornoVencido ? 'bg-red-100 text-red-700' : 'bg-stone-100 text-stone-600')}>
              <AlarmClock size={10} aria-hidden /> {retornoVencido ? 'Retorno vencido' : `Retorno ${formatLastInteraction(c.next_followup_at)}`}
            </span>
          )}
          {c.assigned_name && <span className="text-[10px] text-stone-500">· {c.assigned_name}</span>}
        </div>
      </div>
    </button>
  );
}

export default memo(ConversationCard);
