/**
 * Web Audio API Sound Effects
 */

import { useRef, useCallback } from 'react';

export function useSounds() {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const enabledRef = useRef(true);

  const setEnabled = useCallback((enabled: boolean) => {
    enabledRef.current = enabled;
  }, []);

  const play = useCallback((freq: number, duration: number, type: OscillatorType = 'sine') => {
    if (!enabledRef.current) return;
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
      const ctx = audioCtxRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.value = 0.08;
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch { /* ignore */ }
  }, []);

  const hitNormal = useCallback(() => play(700, 0.08, 'square'), [play]);
  const hitLob = useCallback(() => play(600, 0.1, 'square'), [play]);
  const hitSlice = useCallback(() => play(400, 0.08, 'square'), [play]);
  const bounce = useCallback(() => play(500, 0.05, 'sine'), [play]);
  const netHit = useCallback(() => play(200, 0.2, 'sawtooth'), [play]);
  const outBall = useCallback(() => play(300, 0.15, 'sawtooth'), [play]);
  const pointWon = useCallback(() => play(880, 0.15, 'sine'), [play]);
  const serve = useCallback(() => play(800, 0.1, 'square'), [play]);

  return { setEnabled, hitNormal, hitLob, hitSlice, bounce, netHit, outBall, pointWon, serve };
}
