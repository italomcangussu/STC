/**
 * 3D Ball Physics Engine
 * Coordinates: X=lateral, Y=height, Z=court depth
 * Net at Z=0, Player1 baseline at Z=+halfLength, Player2 at Z=-halfLength
 */

import { useRef, useCallback } from 'react';
import { BALL, COURT, SHOTS } from '../constants';
import type { ShotType } from '../constants';

export interface BallState {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  speed: number;
  spin: number; // positive = topspin, negative = backspin
  inPlay: boolean;
  lastHitter: 0 | 1 | 2;
  bounceCount: number;
  bounceSide: number; // 0=none, 1=player1 side (z>0), 2=player2 side (z<0)
  trail: Array<{ x: number; y: number; z: number }>;
  lastBouncePos: { x: number; z: number } | null; // for dust particles
  justBounced: boolean; // frame-flag for particles
}

export interface PointResult {
  winner: 1 | 2;
  reason: 'net' | 'out' | 'double_bounce' | 'dead_ball';
  message: string;
}

function createBall(): BallState {
  return {
    x: 0, y: 1, z: 0,
    vx: 0, vy: 0, vz: 0,
    speed: 0, spin: 0, inPlay: false,
    lastHitter: 0, bounceCount: 0, bounceSide: 0,
    trail: [],
    lastBouncePos: null,
    justBounced: false,
  };
}

export function useBallPhysics() {
  const ballRef = useRef<BallState>(createBall());

  const reset = useCallback(() => {
    ballRef.current = createBall();
  }, []);

  const serveBall = useCallback((serverSide: 1 | 2, serverX: number) => {
    const b = ballRef.current;
    const serveZ = serverSide === 1 ? COURT.halfLength - 1 : -COURT.halfLength + 1;
    b.x = serverX;
    b.y = 2.5; // toss height
    b.z = serveZ;
    b.inPlay = true;
    b.bounceCount = 0;
    b.bounceSide = 0;
    b.lastHitter = serverSide;
    b.spin = 0.3; // slight topspin on serve
    b.trail = [];
    b.lastBouncePos = null;
    b.justBounced = false;

    // Serve towards opponent's service box
    const targetX = (Math.random() - 0.5) * COURT.widthSingles * 0.4;
    const targetZ = serverSide === 1 ? -COURT.serviceLineDistance * 0.7 : COURT.serviceLineDistance * 0.7;
    const dx = targetX - b.x;
    const dz = targetZ - b.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const speed = 20 + Math.random() * 5; // varied serve speed
    b.vx = (dx / dist) * speed;
    b.vz = (dz / dist) * speed;
    b.vy = 3; // slight upward for serve arc
    b.speed = speed;
  }, []);

  const hitBall = useCallback((
    playerSide: 1 | 2,
    playerX: number,
    playerZ: number,
    shotType: ShotType
  ) => {
    const b = ballRef.current;
    if (!b.inPlay) return false;

    // Check if close enough
    const dx = b.x - playerX;
    const dz = b.z - playerZ;
    const dy = b.y - 1; // approximate player hand height
    const dist = Math.sqrt(dx * dx + dz * dz + dy * dy);
    if (dist > 2.2) return false;

    const shot = SHOTS[shotType];
    b.lastHitter = playerSide;
    b.bounceCount = 0;
    b.bounceSide = 0;
    b.justBounced = false;

    // Timing-based power: closer = more power & accuracy
    const distanceFactor = 1 - (dist / 2.2); // 1 = perfect, 0 = edge
    const powerMult = 0.7 + distanceFactor * 0.4; // 0.7 to 1.1
    const accuracyMult = 0.5 + distanceFactor * 0.5; // 0.5 to 1.0

    // Apply spin from shot type
    b.spin = shot.spin;

    // Aim towards opponent's court
    const depthFactor = 0.5 + accuracyMult * 0.2; // 0.5 to 0.7
    const targetZ = playerSide === 1 ? -COURT.halfLength * depthFactor : COURT.halfLength * depthFactor;
    const spread = shotType === 'lob' ? 0.3 : 0.6;
    const inaccuracy = (1 - accuracyMult) * COURT.widthSingles * 0.15;
    const targetX = (Math.random() - 0.5) * COURT.widthSingles * spread + (Math.random() - 0.5) * inaccuracy;

    const tdx = targetX - b.x;
    const tdz = targetZ - b.z;
    const tDist = Math.sqrt(tdx * tdx + tdz * tdz);

    const finalSpeed = shot.speed * powerMult;
    const hSpeed = finalSpeed * Math.cos(shot.angleY);
    b.vx = (tdx / tDist) * hSpeed;
    b.vz = (tdz / tDist) * hSpeed;
    b.vy = finalSpeed * Math.sin(shot.angleY);
    b.speed = finalSpeed;

    return true;
  }, []);

  const update = useCallback((dt: number): PointResult | null => {
    const b = ballRef.current;
    if (!b.inPlay) return null;

    // Clear per-frame flags
    b.justBounced = false;

    // Trail
    b.trail.push({ x: b.x, y: b.y, z: b.z });
    if (b.trail.length > BALL.trailLength) b.trail.shift();

    // Apply gravity + spin effect (topspin makes ball dip faster, backspin = floats)
    const spinGravityMod = b.spin * BALL.spinFactor * BALL.gravity;
    b.vy += (BALL.gravity + spinGravityMod) * dt;

    // Move
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;

    // Check net collision
    const prevZ = b.z - b.vz * dt;
    if ((prevZ > 0 && b.z <= 0) || (prevZ < 0 && b.z >= 0)) {
      if (b.y < COURT.netHeight) {
        b.inPlay = false;
        const winner: 1 | 2 = b.lastHitter === 1 ? 2 : 1;
        return {
          winner,
          reason: 'net',
          message: winner === 1 ? 'REDE! Seu Ponto' : 'REDE! Ponto Oponente',
        };
      }
    }

    // Check bounce (ball hits ground)
    if (b.y <= BALL.radius) {
      b.y = BALL.radius;

      // Spin affects bounce angle: topspin = lower bounce, backspin = higher
      const spinBounceMod = 1 + b.spin * 0.3;
      b.vy *= -BALL.restitution * Math.max(0.4, spinBounceMod);

      // Store bounce position for particles
      b.lastBouncePos = { x: b.x, z: b.z };
      b.justBounced = true;

      // Determine side
      const side: 1 | 2 = b.z > 0 ? 1 : 2;

      // Check if out of bounds
      const inX = Math.abs(b.x) <= COURT.widthSingles / 2 + 0.1;
      const inZ = Math.abs(b.z) <= COURT.halfLength + 0.1;

      if (!inX || !inZ) {
        b.inPlay = false;
        const winner: 1 | 2 = b.lastHitter === 1 ? 2 : 1;
        return {
          winner,
          reason: 'out',
          message: winner === 1 ? 'FORA! Seu Ponto' : 'FORA! Ponto Oponente',
        };
      }

      // Count bounces on each side
      if (b.bounceSide !== side) {
        b.bounceSide = side;
        b.bounceCount = 1;
      } else {
        b.bounceCount++;
      }

      if (b.bounceCount >= 2) {
        b.inPlay = false;
        const winner: 1 | 2 = side === 1 ? 2 : 1;
        return {
          winner,
          reason: 'double_bounce',
          message: winner === 1 ? 'Duplo Quique! Seu Ponto' : 'Duplo Quique! Ponto Oponente',
        };
      }

      // Slow down after bounce
      b.vx *= 0.85;
      b.vz *= 0.85;
      b.speed *= 0.85;
      // Reduce spin on bounce
      b.spin *= 0.6;

      return null; // bounce sound should be played by caller
    }

    // Air drag
    const dragFactor = 1 - BALL.drag * dt;
    b.vx *= dragFactor;
    b.vz *= dragFactor;
    b.speed = Math.sqrt(b.vx * b.vx + b.vz * b.vz);

    // Dead ball
    if (b.speed < BALL.minSpeed && b.y <= BALL.radius + 0.5) {
      b.inPlay = false;
      const side: 1 | 2 = b.z > 0 ? 1 : 2;
      const winner: 1 | 2 = side === 1 ? 2 : 1;
      return {
        winner,
        reason: 'dead_ball',
        message: winner === 1 ? 'Bola Morta! Seu Ponto' : 'Bola Morta! Ponto Oponente',
      };
    }

    return null;
  }, []);

  return { ballRef, reset, serveBall, hitBall, update };
}
