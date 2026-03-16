/**
 * Unified Player Input (Keyboard + Touch)
 * With acceleration/deceleration for smooth movement
 */

import { useRef, useEffect, useCallback } from 'react';
import type { ShotType } from '../constants';

export interface InputState {
  moveX: number; // -1 to 1
  moveZ: number; // -1 to 1
  shot: ShotType | null;
}

export interface JoystickState {
  active: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  dx: number;
  dy: number;
}

export function usePlayerInput() {
  const keysRef = useRef<Set<string>>(new Set());
  const joystickRef = useRef<JoystickState>({ active: false, startX: 0, startY: 0, currentX: 0, currentY: 0, dx: 0, dy: 0 });
  const shotRef = useRef<ShotType | null>(null);
  const joystickTouchId = useRef<number | null>(null);
  const shotTouchId = useRef<number | null>(null);

  // Smooth velocity state for acceleration/deceleration
  const velocityRef = useRef({ vx: 0, vz: 0 });

  // Keyboard listeners
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      keysRef.current.add(e.key.toLowerCase());
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(e.key.toLowerCase())) {
        e.preventDefault();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.key.toLowerCase());
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, []);

  const getInput = useCallback((): InputState => {
    const keys = keysRef.current;
    const js = joystickRef.current;

    let inputX = 0;
    let inputZ = 0;

    // Keyboard
    if (keys.has('a') || keys.has('arrowleft')) inputX -= 1;
    if (keys.has('d') || keys.has('arrowright')) inputX += 1;
    if (keys.has('w') || keys.has('arrowup')) inputZ -= 1;
    if (keys.has('s') || keys.has('arrowdown')) inputZ += 1;

    // Joystick
    if (js.active) {
      inputX += js.dx;
      inputZ += js.dy; // joystick Y maps to court Z (forward/back)
    }

    // Normalize raw input
    const mag = Math.sqrt(inputX * inputX + inputZ * inputZ);
    if (mag > 1) {
      inputX /= mag;
      inputZ /= mag;
    }

    // Acceleration / deceleration
    const vel = velocityRef.current;
    const accelRate = 0.15; // how fast to reach target (lerp factor per frame)
    const decelRate = 0.1;

    if (Math.abs(inputX) > 0.01) {
      vel.vx += (inputX - vel.vx) * accelRate;
    } else {
      vel.vx *= (1 - decelRate);
      if (Math.abs(vel.vx) < 0.01) vel.vx = 0;
    }

    if (Math.abs(inputZ) > 0.01) {
      vel.vz += (inputZ - vel.vz) * accelRate;
    } else {
      vel.vz *= (1 - decelRate);
      if (Math.abs(vel.vz) < 0.01) vel.vz = 0;
    }

    // Shot from keyboard
    let shot: ShotType | null = null;
    if (keys.has(' ') || keys.has('space')) shot = 'normal';
    else if (keys.has('q')) shot = 'lob';
    else if (keys.has('e')) shot = 'slice';
    else if (shotRef.current) shot = shotRef.current;

    return { moveX: vel.vx, moveZ: vel.vz, shot };
  }, []);

  // Touch handlers for joystick (called from TouchControls component)
  const onJoystickStart = useCallback((x: number, y: number, touchId: number) => {
    joystickTouchId.current = touchId;
    joystickRef.current = {
      active: true,
      startX: x, startY: y,
      currentX: x, currentY: y,
      dx: 0, dy: 0,
    };
    try { navigator.vibrate?.(10); } catch { /* ignore */ }
  }, []);

  const onJoystickMove = useCallback((x: number, y: number, touchId: number) => {
    if (touchId !== joystickTouchId.current) return;
    const js = joystickRef.current;
    const maxDist = 60;
    let dx = x - js.startX;
    let dy = y - js.startY;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > maxDist) {
      dx = (dx / d) * maxDist;
      dy = (dy / d) * maxDist;
    }
    js.currentX = js.startX + dx;
    js.currentY = js.startY + dy;
    js.dx = dx / maxDist;
    js.dy = dy / maxDist;
  }, []);

  const onJoystickEnd = useCallback((touchId: number) => {
    if (touchId !== joystickTouchId.current) return;
    joystickRef.current = { active: false, startX: 0, startY: 0, currentX: 0, currentY: 0, dx: 0, dy: 0 };
    joystickTouchId.current = null;
  }, []);

  const onShotStart = useCallback((type: ShotType, touchId: number) => {
    shotRef.current = type;
    shotTouchId.current = touchId;
    try { navigator.vibrate?.(8); } catch { /* ignore */ }
  }, []);

  const onShotEnd = useCallback((touchId: number) => {
    if (touchId !== shotTouchId.current) return;
    shotRef.current = null;
    shotTouchId.current = null;
  }, []);

  return {
    getInput,
    joystickRef,
    velocityRef,
    onJoystickStart, onJoystickMove, onJoystickEnd,
    onShotStart, onShotEnd,
  };
}
