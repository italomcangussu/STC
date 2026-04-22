/**
 * Game3D - Main 3D Scene orchestrator
 * Uses React Three Fiber with game loop via useFrame
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Court } from './components/Court';
import { Ball } from './components/Ball';
import { PlayerModel } from './components/PlayerModel';
import { Stadium } from './components/Stadium';
import { HUD } from './ui/HUD';
import { TouchControls } from './ui/TouchControls';
import { PointOverlay } from './ui/PointOverlay';
import { useScoring, type MatchScore } from './engine/useScoring';
import { useBallPhysics } from './engine/useBallPhysics';
import { useAI } from './engine/useAI';
import { usePlayerInput } from './engine/usePlayerInput';
import { useSounds } from './engine/useSounds';
import { COURT, PLAYER, CAMERA, TIMING } from './constants';
import type { Difficulty, GameState } from './constants';

interface Game3DProps {
  difficulty: Difficulty;
  soundEnabled: boolean;
  isTouchDevice: boolean;
  isLandscape: boolean;
  onGameOver: () => void;
}

// Dynamic camera FOV adjuster based on orientation
const CameraController: React.FC<{ isLandscape: boolean }> = ({ isLandscape }) => {
  const { camera } = useThree();

  useFrame(() => {
    const targetFov = isLandscape ? CAMERA.fovLandscape : CAMERA.fovPortrait;
    const cam = camera as THREE.PerspectiveCamera;
    if (Math.abs(cam.fov - targetFov) > 0.5) {
      cam.fov = THREE.MathUtils.lerp(cam.fov, targetFov, 0.05);
      cam.updateProjectionMatrix();
    }
  });

  return null;
};

// Inner component that runs inside R3F Canvas context
const GameScene: React.FC<{
  difficulty: Difficulty;
  isLandscape: boolean;
  gameStateRef: React.MutableRefObject<GameState>;
  p1PosRef: React.MutableRefObject<{ x: number; z: number }>;
  p1SwingRef: React.MutableRefObject<number>;
  p2PosRef: React.MutableRefObject<{ x: number; z: number }>;
  p2SwingRef: React.MutableRefObject<number>;
  getInput: () => { moveX: number; moveZ: number; shot: import('./constants').ShotType | null };
  ballPhysics: ReturnType<typeof useBallPhysics>;
  scoring: ReturnType<typeof useScoring>;
  ai: ReturnType<typeof useAI>;
  sounds: ReturnType<typeof useSounds>;
  onPointResult: (msg: string) => void;
}> = ({
  difficulty: _difficulty, isLandscape, gameStateRef, p1PosRef, p1SwingRef, p2PosRef, p2SwingRef,
  getInput, ballPhysics, scoring, ai, sounds, onPointResult,
}) => {
  const servingRef = useRef(true);
  const serveTimerRef = useRef(TIMING.serveDelayMs / 1000);
  const pointTimerRef = useRef(0);

  useFrame(({ camera }, dt) => {
    dt = Math.min(dt, 0.05);
    const gs = gameStateRef.current;
    const ball = ballPhysics.ballRef.current;
    const score = scoring.scoreRef.current;

    // Camera follow player X
    const targetX = p1PosRef.current.x * CAMERA.followStrength * 10;
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetX, 0.03);

    if (gs === 'playing') {
      // ─── SERVE ───
      if (servingRef.current && !ball.inPlay) {
        serveTimerRef.current -= dt;
        if (serveTimerRef.current <= 0) {
          const serverSide = score.server;
          const serverPos = serverSide === 1 ? p1PosRef.current : ai.aiRef.current;
          ballPhysics.serveBall(serverSide, serverPos.x);
          sounds.serve();
          servingRef.current = false;
        }
      }

      // ─── PLAYER INPUT ───
      const input = getInput();
      const p1 = p1PosRef.current;
      p1.x += input.moveX * PLAYER.speed * dt;
      p1.z += input.moveZ * PLAYER.speed * dt;

      // Clamp player to their half
      const halfSingles = COURT.widthSingles / 2 - 0.5;
      p1.x = Math.max(-halfSingles, Math.min(halfSingles, p1.x));
      p1.z = Math.max(1.5, Math.min(COURT.halfLength - 0.5, p1.z));

      // Player hit
      if (input.shot && ball.inPlay && ball.lastHitter !== 1) {
        const hit = ballPhysics.hitBall(1, p1.x, p1.z, input.shot);
        if (hit) {
          p1SwingRef.current = TIMING.swingDuration;
          if (input.shot === 'lob') sounds.hitLob();
          else if (input.shot === 'slice') sounds.hitSlice();
          else sounds.hitNormal();
        }
      }

      // ─── AI ───
      ai.update(dt, ball, (side, px, pz, shot) => {
        const hit = ballPhysics.hitBall(side, px, pz, shot);
        if (hit) {
          p2SwingRef.current = TIMING.swingDuration;
          if (shot === 'lob') sounds.hitLob();
          else if (shot === 'slice') sounds.hitSlice();
          else sounds.hitNormal();
        }
        return hit;
      });

      // Sync AI position
      p2PosRef.current.x = ai.aiRef.current.x;
      p2PosRef.current.z = ai.aiRef.current.z;

      // ─── BALL PHYSICS ───
      const prevY = ball.y;
      const result = ballPhysics.update(dt);

      // Bounce sound
      if (ball.inPlay && prevY > 0.16 && ball.y <= 0.16) {
        sounds.bounce();
      }

      if (result) {
        if (result.reason === 'net') sounds.netHit();
        else if (result.reason === 'out') sounds.outBall();
        else sounds.outBall();

        scoring.scorePoint(result.winner);
        onPointResult(result.message);
        gameStateRef.current = 'point_scored';
        pointTimerRef.current = TIMING.pointDisplayMs / 1000;
      }

      // Swing timers
      p1SwingRef.current = Math.max(0, p1SwingRef.current - dt);
      p2SwingRef.current = Math.max(0, p2SwingRef.current - dt);
    }

    // ─── POINT SCORED STATE ───
    if (gs === 'point_scored') {
      pointTimerRef.current -= dt;
      if (pointTimerRef.current <= 0) {
        if (score.matchOver) {
          gameStateRef.current = 'game_over';
          onPointResult('');
        } else {
          // Reset for next point
          servingRef.current = true;
          serveTimerRef.current = TIMING.serveDelayMs / 1000;
          ballPhysics.reset();
          onPointResult('');

          // Position players
          p1PosRef.current.x = 0;
          p1PosRef.current.z = COURT.halfLength - 2;
          ai.reset();

          gameStateRef.current = 'playing';
        }
      }
    }
  });

  return (
    <>
      <CameraController isLandscape={isLandscape} />

      {/* Lighting */}
      <ambientLight intensity={0.5} />
      <hemisphereLight args={['#87CEEB', '#5a3e28', 0.4]} />
      <directionalLight
        position={[10, 20, 10]}
        intensity={1.2}
        castShadow
        shadow-mapSize-width={512}
        shadow-mapSize-height={512}
        shadow-camera-far={60}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
      />

      {/* Scene */}
      <Stadium />
      <Court />
      <Ball ballRef={ballPhysics.ballRef} />

      {/* Player 1 (You) */}
      <PlayerModel
        positionRef={p1PosRef}
        color="#2563eb"
        lightColor="#3b82f6"
        label="YOU"
        swingTimerRef={p1SwingRef}
        side={1}
      />

      {/* Player 2 (AI) */}
      <PlayerModel
        positionRef={p2PosRef}
        color="#dc2626"
        lightColor="#ef4444"
        label="AI"
        swingTimerRef={p2SwingRef}
        side={2}
      />
    </>
  );
};

export const Game3D: React.FC<Game3DProps> = ({
  difficulty, soundEnabled, isTouchDevice, isLandscape, onGameOver
}) => {
  const gameStateRef = useRef<GameState>('playing');
  const p1PosRef = useRef({ x: 0, z: COURT.halfLength - 2 });
  const p1SwingRef = useRef(0);
  const p2PosRef = useRef({ x: 0, z: -COURT.halfLength + 2 });
  const p2SwingRef = useRef(0);

  const [pointMessage, setPointMessage] = useState('');
  const [scoreSnapshot, setScoreSnapshot] = useState<MatchScore | null>(null);
  const [pointsDisplay, setPointsDisplay] = useState('0 - 0');

  const scoring = useScoring();
  const ballPhysics = useBallPhysics();
  const ai = useAI(difficulty);
  const input = usePlayerInput();
  const sounds = useSounds();

  useEffect(() => {
    sounds.setEnabled(soundEnabled);
  }, [soundEnabled, sounds]);

  // Poll score for HUD updates
  useEffect(() => {
    const interval = setInterval(() => {
      setScoreSnapshot({ ...scoring.scoreRef.current });
      setPointsDisplay(scoring.getPointsDisplay());
    }, 100);
    return () => clearInterval(interval);
  }, [scoring]);

  const handlePointResult = useCallback((msg: string) => {
    setPointMessage(msg);
    // Force score update
    setScoreSnapshot({ ...scoring.scoreRef.current });
    setPointsDisplay(scoring.getPointsDisplay());
  }, [scoring]);

  const handleBackToMenu = useCallback(() => {
    onGameOver();
  }, [onGameOver]);

  const isMatchOver = scoreSnapshot?.matchOver ?? false;

  return (
    <div className="relative w-full h-dvh bg-stone-900 overflow-hidden select-none" style={{ touchAction: 'none' }}>
      {/* 3D Canvas */}
      <Canvas
        dpr={[1, 1.5]}
        shadows={{ type: THREE.PCFShadowMap }}
        camera={{
          position: [CAMERA.positionX, CAMERA.positionY, CAMERA.positionZ],
          fov: isLandscape ? CAMERA.fovLandscape : CAMERA.fovPortrait,
          near: 0.1,
          far: 200,
        }}
        gl={{
          antialias: true,
          powerPreference: 'high-performance',
          alpha: false,
        }}
        style={{ touchAction: 'none' }}
        onCreated={({ camera }) => {
          camera.lookAt(0, CAMERA.lookAtY, 0);
        }}
      >
        <color attach="background" args={['#87CEEB']} />
        <fog attach="fog" args={['#87CEEB', 40, 120]} />

        <GameScene
          difficulty={difficulty}
          isLandscape={isLandscape}
          gameStateRef={gameStateRef}
          p1PosRef={p1PosRef}
          p1SwingRef={p1SwingRef}
          p2PosRef={p2PosRef}
          p2SwingRef={p2SwingRef}
          getInput={input.getInput}
          ballPhysics={ballPhysics}
          scoring={scoring}
          ai={ai}
          sounds={sounds}
          onPointResult={handlePointResult}
        />
      </Canvas>

      {/* HUD */}
      {scoreSnapshot && (
        <HUD score={scoreSnapshot} pointsDisplay={pointsDisplay} isLandscape={isLandscape} />
      )}

      {/* Touch Controls */}
      {isTouchDevice && !isMatchOver && (
        <TouchControls
          joystickRef={input.joystickRef}
          onJoystickStart={input.onJoystickStart}
          onJoystickMove={input.onJoystickMove}
          onJoystickEnd={input.onJoystickEnd}
          onShotStart={input.onShotStart}
          onShotEnd={input.onShotEnd}
          isLandscape={isLandscape}
        />
      )}

      {/* Point message / Match over */}
      <PointOverlay
        message={pointMessage}
        matchOver={isMatchOver}
        winner={scoreSnapshot?.winner ?? 0}
        setHistory={scoreSnapshot?.setHistory ?? []}
        onBackToMenu={handleBackToMenu}
      />

      {/* Back button */}
      {!isMatchOver && (
        <button
          onClick={handleBackToMenu}
          className="absolute top-3 left-3 z-30 w-9 h-9 bg-black/40 backdrop-blur-sm rounded-full flex items-center justify-center text-white/60 hover:text-white border border-white/10 transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        </button>
      )}
    </div>
  );
};
