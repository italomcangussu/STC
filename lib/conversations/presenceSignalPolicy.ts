// Portado do CRM Ibiapaba (`pages/crm/presenceSignalPolicy.ts`) sem mudanças.
// Decides when the attendant's typing/recording presence should be emitted to
// the contact (chat-best-practices ux-parity §4). Re-sends the same active
// state at most every throttleMs; sends a state change immediately; emits a
// single `paused` when typing/recording stops. Pure — no I/O.

export type PresenceState = 'composing' | 'recording' | 'paused' | 'available';

export const PRESENCE_THROTTLE_MS = 3500;

export function decidePresenceSignal(input: {
  isTyping: boolean;
  isRecording: boolean;
  lastSentAtMs: number | null;
  nowMs: number;
  lastState: PresenceState | null;
  throttleMs?: number;
}): PresenceState | null {
  const throttleMs = input.throttleMs ?? PRESENCE_THROTTLE_MS;
  const desired: PresenceState | null = input.isRecording
    ? 'recording'
    : input.isTyping
      ? 'composing'
      : null;

  if (desired === null) {
    // Stopped: emit a single pause, then stay quiet.
    if (input.lastState && input.lastState !== 'paused' && input.lastState !== 'available') {
      return 'paused';
    }
    return null;
  }

  // State change (e.g. composing → recording) goes out immediately.
  if (desired !== input.lastState) {
    return desired;
  }

  // Same active state: re-send only past the throttle window.
  if (input.lastSentAtMs === null || input.nowMs - input.lastSentAtMs >= throttleMs) {
    return desired;
  }
  return null;
}
