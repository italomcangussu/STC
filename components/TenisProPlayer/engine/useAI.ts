/**
 * AI Controller for 3D Tennis
 * With net approach behavior and better ball prediction
 */

import { useRef, useCallback } from 'react';
import { COURT, PLAYER, BALL, DIFFICULTY_CONFIG } from '../constants';
import type { Difficulty, ShotType } from '../constants';
import type { BallState } from './useBallPhysics';

export interface AIState {
  x: number;
  z: number;
  reactionTimer: number;
  shotDecided: boolean;
  shotType: ShotType;
  swingTimer: number;
  approachingNet: boolean;
}

function createAIState(): AIState {
  return {
    x: 0,
    z: -COURT.halfLength + 2,
    reactionTimer: 0.3,
    shotDecided: false,
    shotType: 'normal',
    swingTimer: 0,
    approachingNet: false,
  };
}

/**
 * Predict where the ball will land using physics simulation
 */
function predictLanding(ball: BallState): { x: number; z: number; time: number } {
  let x = ball.x, y = ball.y, z = ball.z;
  let vx = ball.vx, vy = ball.vy, vz = ball.vz;
  let t = 0;
  const maxTime = 3;
  const step = 0.02;

  while (t < maxTime) {
    vy += BALL.gravity * step;
    x += vx * step;
    y += vy * step;
    z += vz * step;
    t += step;

    if (y <= BALL.radius) {
      return { x, z, time: t };
    }
  }

  return { x, z, time: t };
}

export function useAI(difficulty: Difficulty) {
  const aiRef = useRef<AIState>(createAIState());

  const reset = useCallback(() => {
    aiRef.current = createAIState();
  }, []);

  const update = useCallback((
    dt: number,
    ball: BallState,
    hitBall: (side: 1 | 2, px: number, pz: number, shot: ShotType) => boolean,
  ) => {
    const ai = aiRef.current;
    const config = DIFFICULTY_CONFIG[difficulty];
    const speed = PLAYER.speed * config.moveSpeed;

    ai.swingTimer = Math.max(0, ai.swingTimer - dt);

    // Reaction delay
    ai.reactionTimer -= dt;
    if (ai.reactionTimer > 0 && ball.inPlay) {
      // Slowly drift to center while thinking
      ai.x += (0 - ai.x) * 0.5 * dt;
      return;
    }

    if (!ball.inPlay) {
      // Return to ready position
      const homeX = 0;
      const homeZ = -COURT.halfLength + 2;
      ai.x += (homeX - ai.x) * 2 * dt;
      ai.z += (homeZ - ai.z) * 2 * dt;
      ai.reactionTimer = (1 - config.reactionSpeed) * 0.5;
      ai.shotDecided = false;
      ai.approachingNet = false;
      return;
    }

    // Predict ball landing position
    const landing = predictLanding(ball);

    // Inaccuracy
    const inaccuracy = (1 - config.accuracy) * COURT.widthSingles * 0.1;
    const targetX = landing.x + (Math.random() - 0.5) * inaccuracy;

    // Net approach decision: if the ball is landing short (near net), approach
    if (config.netApproach > 0 && !ai.approachingNet) {
      const isShortBall = Math.abs(landing.z) < COURT.serviceLineDistance * 0.8 && landing.z < 0;
      if (isShortBall && Math.random() < config.netApproach) {
        ai.approachingNet = true;
      }
    }

    // Move towards predicted position if ball is coming to AI's side
    if (ball.vz < 0 || ball.lastHitter === 1) {
      const dx = targetX - ai.x;
      const moveAmount = speed * dt;
      if (Math.abs(dx) > 0.2) {
        ai.x += Math.sign(dx) * Math.min(Math.abs(dx), moveAmount);
      }

      // Depth positioning
      let idealZ: number;
      if (ai.approachingNet) {
        // Move forward to volley position
        idealZ = Math.max(-COURT.serviceLineDistance + 1, Math.min(-2, landing.z));
      } else {
        idealZ = Math.max(-COURT.halfLength + 1, Math.min(-1.5, landing.z));
      }
      ai.z += (idealZ - ai.z) * 2 * dt;
    } else {
      // Return to center — smart positioning based on approach state
      ai.x += (0 - ai.x) * 1.5 * dt;
      const returnZ = ai.approachingNet ? -COURT.serviceLineDistance + 1 : -COURT.halfLength + 2;
      ai.z += (returnZ - ai.z) * 1.5 * dt;
    }

    // Clamp
    const halfSingles = COURT.widthSingles / 2 - 0.5;
    ai.x = Math.max(-halfSingles, Math.min(halfSingles, ai.x));
    ai.z = Math.max(-COURT.halfLength + 0.5, Math.min(-1, ai.z));

    // Try to hit
    if (ball.inPlay && ball.lastHitter !== 2) {
      const dx = ball.x - ai.x;
      const dz = ball.z - ai.z;
      const dy = ball.y - 1;
      const dist = Math.sqrt(dx * dx + dz * dz + dy * dy);

      if (dist < 2.2) {
        if (!ai.shotDecided) {
          const r = Math.random();
          if (ai.approachingNet) {
            // At net: prefer volleys (normal) and drop shots
            ai.shotType = r < 0.3 ? 'slice' : 'normal';
          } else if (r < config.shotVariety * 0.3) {
            ai.shotType = 'lob';
          } else if (r < config.shotVariety * 0.5) {
            ai.shotType = 'slice';
          } else {
            ai.shotType = 'normal';
          }
          ai.shotDecided = true;
        }
        const hit = hitBall(2, ai.x, ai.z, ai.shotType);
        if (hit) {
          ai.swingTimer = 0.25;
          ai.reactionTimer = (1 - config.reactionSpeed) * 0.3;
          ai.shotDecided = false;
          // Reset net approach after hitting
          if (ai.approachingNet && Math.random() > 0.5) {
            ai.approachingNet = false;
          }
        }
      }
    }
  }, [difficulty]);

  return { aiRef, reset, update };
}
