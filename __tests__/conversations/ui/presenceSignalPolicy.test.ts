import { describe, expect, it } from 'vitest';
import { PRESENCE_THROTTLE_MS, decidePresenceSignal } from '@/lib/conversations/presenceSignalPolicy';

const base = {
  isTyping: false,
  isRecording: false,
  lastSentAtMs: null as number | null,
  nowMs: 100_000,
  lastState: null as null | 'composing' | 'recording' | 'paused' | 'available',
};

describe('decidePresenceSignal', () => {
  it('emits composing when typing starts', () => {
    expect(decidePresenceSignal({ ...base, isTyping: true })).toBe('composing');
  });

  it('emits recording immediately when switching from composing', () => {
    expect(decidePresenceSignal({
      ...base, isRecording: true, lastState: 'composing', lastSentAtMs: base.nowMs,
    })).toBe('recording');
  });

  it('throttles re-sending the same active state', () => {
    expect(decidePresenceSignal({
      ...base, isTyping: true, lastState: 'composing',
      lastSentAtMs: base.nowMs - (PRESENCE_THROTTLE_MS - 1),
    })).toBe(null);
  });

  it('re-sends the same state after the throttle window', () => {
    expect(decidePresenceSignal({
      ...base, isTyping: true, lastState: 'composing',
      lastSentAtMs: base.nowMs - (PRESENCE_THROTTLE_MS + 1),
    })).toBe('composing');
  });

  it('emits a single paused when typing stops', () => {
    expect(decidePresenceSignal({ ...base, lastState: 'composing' })).toBe('paused');
  });

  it('stays quiet once already paused/idle', () => {
    expect(decidePresenceSignal({ ...base, lastState: 'paused' })).toBe(null);
    expect(decidePresenceSignal({ ...base, lastState: null })).toBe(null);
  });
});
