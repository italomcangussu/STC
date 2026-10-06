// Portado do CRM Ibiapaba (`pages/crm/conversationPresenceState.ts`) sem mudanças.
// Ephemeral per-conversation presence (chat-best-practices ux-parity §4).
// Incoming presence is held with a TTL and never persisted. Pure map ops.

import type { PresenceState } from './presenceSignalPolicy';

export const PRESENCE_TTL_MS = 8000;

export interface PresenceEntry {
  state: PresenceState;
  expiresAtMs: number;
}

export function applyPresenceEvent(
  map: Map<string, PresenceEntry>,
  input: { conversationId: string; state: PresenceState; nowMs: number; ttlMs?: number },
): void {
  const id = String(input.conversationId || '').trim();
  if (!id) return;
  // Only "actively doing something" states are shown; pause/available clear it.
  if (input.state === 'composing' || input.state === 'recording') {
    map.set(id, { state: input.state, expiresAtMs: input.nowMs + (input.ttlMs ?? PRESENCE_TTL_MS) });
  } else {
    map.delete(id);
  }
}

export function getActivePresence(
  map: Map<string, PresenceEntry>,
  conversationId: string,
  nowMs: number,
): PresenceState | null {
  const id = String(conversationId || '').trim();
  if (!id) return null;
  const entry = map.get(id);
  if (!entry) return null;
  if (entry.expiresAtMs <= nowMs) {
    map.delete(id);
    return null;
  }
  return entry.state;
}

export function pruneExpiredPresence(
  map: Map<string, PresenceEntry>,
  nowMs: number,
): number {
  let removed = 0;
  for (const [id, entry] of map) {
    if (entry.expiresAtMs <= nowMs) {
      map.delete(id);
      removed += 1;
    }
  }
  return removed;
}

export function formatPresenceLabel(state: PresenceState | null): string {
  if (state === 'composing') return 'digitando…';
  if (state === 'recording') return 'gravando áudio…';
  return '';
}
