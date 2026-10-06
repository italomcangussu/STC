import { describe, expect, it } from 'vitest';

import type { TimelineMessage as CRMMessage } from '@/lib/conversations/messageTimeline';
import { buildMessageTimelineItems, formatMessageDayDividerLabel } from '@/lib/conversations/messageTimeline';

function createMessage(id: string, sentAt: string): CRMMessage {
  return { id, createdAt: sentAt, sentAt };
}

describe('formatMessageDayDividerLabel', () => {
  const now = new Date('2026-03-13T15:00:00-03:00');

  it('returns Hoje for current-day messages', () => {
    expect(formatMessageDayDividerLabel(new Date('2026-03-13T08:30:00-03:00'), now)).toBe('Hoje');
  });

  it('returns Ontem for previous-day messages', () => {
    expect(formatMessageDayDividerLabel(new Date('2026-03-12T21:00:00-03:00'), now)).toBe('Ontem');
  });

  it('formats older messages with weekday and short month', () => {
    expect(formatMessageDayDividerLabel(new Date('2026-03-11T09:00:00-03:00'), now)).toBe('Qua, 11 de Mar');
  });
});

describe('buildMessageTimelineItems', () => {
  it('inserts a divider before the first message of each day', () => {
    const items = buildMessageTimelineItems([
      createMessage('msg-1', '2026-03-11T09:00:00-03:00'),
      createMessage('msg-2', '2026-03-11T10:00:00-03:00'),
      createMessage('msg-3', '2026-03-12T08:00:00-03:00'),
      createMessage('msg-4', '2026-03-13T08:00:00-03:00'),
    ], new Date('2026-03-13T15:00:00-03:00'));

    expect(items.map((item) => item.type === 'day-divider' ? item.label : item.message.id)).toEqual([
      'Qua, 11 de Mar',
      'msg-1',
      'msg-2',
      'Ontem',
      'msg-3',
      'Hoje',
      'msg-4',
    ]);
  });
});
