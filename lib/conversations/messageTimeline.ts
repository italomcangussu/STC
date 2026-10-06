// Portado do North Jato (`features/conversations/messageTimeline.ts`), que veio do CRM Ibiapaba.

const DIA_LOCAL = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza', year: 'numeric', month: '2-digit', day: '2-digit' });
/** Dia de calendário de um instante, no fuso do clube. */
const diaLocalDe = (iso: string): string => DIA_LOCAL.format(new Date(iso));

/** O que a linha do tempo precisa de uma mensagem. */
export type TimelineMessage = { id: string; sentAt?: string | null; createdAt: string };

const toFortalezaDateKey = (date: Date) => diaLocalDe(date.toISOString());

const TIMEZONE = 'America/Fortaleza';

export interface MessageTimelineDividerItem {
  type: 'day-divider';
  key: string;
  label: string;
}

export interface MessageTimelineMessageItem<M extends TimelineMessage = TimelineMessage> {
  type: 'message';
  key: string;
  message: M;
}

export type MessageTimelineItem<M extends TimelineMessage = TimelineMessage> = MessageTimelineDividerItem | MessageTimelineMessageItem<M>;

function getCalendarDayKey(date: Date): string {
  return toFortalezaDateKey(date);
}

function getPreviousDayKey(dayKey: string): string {
  const [year, month, day] = dayKey.split('-').map(Number);
  const previous = new Date(Date.UTC(year, month - 1, day));
  previous.setUTCDate(previous.getUTCDate() - 1);
  return [
    previous.getUTCFullYear(),
    String(previous.getUTCMonth() + 1).padStart(2, '0'),
    String(previous.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function normalizeShortLabel(value: string): string {
  const withoutTrailingDot = value.replace(/\.$/, '');
  return withoutTrailingDot.charAt(0).toUpperCase() + withoutTrailingDot.slice(1);
}

/**
 * Formats the day divider label used in the CRM message timeline.
 */
export function formatMessageDayDividerLabel(
  date: Date,
  now: Date = new Date(),
  locale: string = 'pt-BR'
): string {
  const dateKey = getCalendarDayKey(date);
  const nowKey = getCalendarDayKey(now);

  if (dateKey === nowKey) return 'Hoje';
  if (dateKey === getPreviousDayKey(nowKey)) return 'Ontem';

  const weekday = normalizeShortLabel(
    new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: TIMEZONE }).format(date)
  );
  const day = new Intl.DateTimeFormat(locale, { day: '2-digit', timeZone: TIMEZONE }).format(date);
  const month = normalizeShortLabel(
    new Intl.DateTimeFormat(locale, { month: 'short', timeZone: TIMEZONE }).format(date)
  );

  return `${weekday}, ${day} de ${month}`;
}

/**
 * Builds a render-friendly timeline with day dividers inserted before the first
 * message of each calendar day.
 */
export function buildMessageTimelineItems<M extends TimelineMessage>(
  messages: M[],
  now: Date = new Date()
): MessageTimelineItem<M>[] {
  let previousDayKey = '';

  return messages.flatMap((message) => {
    const messageDate = new Date(message.sentAt || message.createdAt);
    const dayKey = getCalendarDayKey(messageDate);
    const items: MessageTimelineItem<M>[] = [];

    if (dayKey !== previousDayKey) {
      previousDayKey = dayKey;
      items.push({
        type: 'day-divider',
        key: `day-divider-${dayKey}`,
        label: formatMessageDayDividerLabel(messageDate, now),
      });
    }

    items.push({
      type: 'message',
      key: message.id,
      message,
    });

    return items;
  });
}
