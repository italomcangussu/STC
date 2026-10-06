import { describe, expect, it } from 'vitest';
import {
  PRESENCE_TTL_MS,
  applyPresenceEvent,
  formatPresenceLabel,
  getActivePresence,
  pruneExpiredPresence,
  type PresenceEntry,
} from '@/lib/conversations/conversationPresenceState';

describe('conversationPresenceState', () => {
  it('stores composing/recording with a TTL and reads it back', () => {
    const map = new Map<string, PresenceEntry>();
    applyPresenceEvent(map, { conversationId: 'c1', state: 'composing', nowMs: 1000 });
    expect(getActivePresence(map, 'c1', 1500)).toBe('composing');
  });

  it('expires presence after the TTL', () => {
    const map = new Map<string, PresenceEntry>();
    applyPresenceEvent(map, { conversationId: 'c1', state: 'recording', nowMs: 1000 });
    expect(getActivePresence(map, 'c1', 1000 + PRESENCE_TTL_MS + 1)).toBe(null);
    expect(map.has('c1')).toBe(false);
  });

  it('clears presence on paused/available', () => {
    const map = new Map<string, PresenceEntry>();
    applyPresenceEvent(map, { conversationId: 'c1', state: 'composing', nowMs: 1000 });
    applyPresenceEvent(map, { conversationId: 'c1', state: 'paused', nowMs: 1100 });
    expect(getActivePresence(map, 'c1', 1200)).toBe(null);
  });

  it('ignores blank conversation ids', () => {
    const map = new Map<string, PresenceEntry>();
    applyPresenceEvent(map, { conversationId: '  ', state: 'composing', nowMs: 1000 });
    expect(map.size).toBe(0);
  });

  it('prunes only the expired entries and reports how many were removed', () => {
    const map = new Map<string, PresenceEntry>();
    applyPresenceEvent(map, { conversationId: 'c1', state: 'composing', nowMs: 1000 });
    applyPresenceEvent(map, { conversationId: 'c2', state: 'recording', nowMs: 5000 });

    expect(pruneExpiredPresence(map, 1000 + PRESENCE_TTL_MS + 1)).toBe(1);
    expect(map.has('c1')).toBe(false);
    expect(map.has('c2')).toBe(true);
    expect(pruneExpiredPresence(map, 5000)).toBe(0);
  });

  it('formats labels', () => {
    expect(formatPresenceLabel('composing')).toBe('digitando…');
    expect(formatPresenceLabel('recording')).toBe('gravando áudio…');
    expect(formatPresenceLabel(null)).toBe('');
    expect(formatPresenceLabel('paused')).toBe('');
  });
});
