/**
 * 3D Tennis Court (Procedural)
 * Clay surface with white lines, net, and posts
 */

import React, { useMemo } from 'react';
import * as THREE from 'three';
import { COURT, COLORS } from '../constants';

const CourtLine: React.FC<{ width: number; depth: number; x: number; z: number }> = ({ width, depth, x, z }) => (
  <mesh position={[x, 0.005, z]} rotation={[-Math.PI / 2, 0, 0]}>
    <planeGeometry args={[width, depth]} />
    <meshStandardMaterial color={COLORS.lineWhite} />
  </mesh>
);

export const Court: React.FC = React.memo(() => {
  const halfL = COURT.halfLength;
  const halfS = COURT.widthSingles / 2;
  const halfD = COURT.widthDoubles / 2;
  const svcDist = COURT.serviceLineDistance;
  const lineW = 0.05; // line width in meters

  // Court surface texture (subtle noise pattern)
  const courtTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    // Base clay color
    ctx.fillStyle = COLORS.courtClay;
    ctx.fillRect(0, 0, 256, 256);

    // Add subtle noise
    for (let i = 0; i < 3000; i++) {
      const x = Math.random() * 256;
      const y = Math.random() * 256;
      const brightness = Math.random() * 30 - 15;
      ctx.fillStyle = `rgba(${194 + brightness}, ${65 + brightness * 0.5}, ${12 + brightness * 0.3}, 0.3)`;
      ctx.fillRect(x, y, Math.random() * 3 + 1, Math.random() * 3 + 1);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(8, 16);
    return tex;
  }, []);

  return (
    <group>
      {/* Court surface */}
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[COURT.widthDoubles + 4, COURT.length + 8]} />
        <meshStandardMaterial map={courtTexture} roughness={0.9} />
      </mesh>

      {/* Surround area */}
      <mesh position={[0, -0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[COURT.widthDoubles + 16, COURT.length + 20]} />
        <meshStandardMaterial color={COLORS.courtSurround} roughness={0.95} />
      </mesh>

      {/* === COURT LINES === */}
      {/* Baselines */}
      <CourtLine width={COURT.widthSingles} depth={lineW} x={0} z={halfL} />
      <CourtLine width={COURT.widthSingles} depth={lineW} x={0} z={-halfL} />

      {/* Singles sidelines */}
      <CourtLine width={lineW} depth={COURT.length} x={halfS} z={0} />
      <CourtLine width={lineW} depth={COURT.length} x={-halfS} z={0} />

      {/* Doubles sidelines */}
      <CourtLine width={lineW} depth={COURT.length} x={halfD} z={0} />
      <CourtLine width={lineW} depth={COURT.length} x={-halfD} z={0} />

      {/* Service lines */}
      <CourtLine width={COURT.widthSingles} depth={lineW} x={0} z={svcDist} />
      <CourtLine width={COURT.widthSingles} depth={lineW} x={0} z={-svcDist} />

      {/* Center service line */}
      <CourtLine width={lineW} depth={svcDist * 2} x={0} z={0} />

      {/* Center marks on baselines */}
      <CourtLine width={lineW} depth={0.3} x={0} z={halfL - 0.15} />
      <CourtLine width={lineW} depth={0.3} x={0} z={-halfL + 0.15} />

      {/* === NET === */}
      {/* Net mesh */}
      <mesh position={[0, COURT.netHeight / 2, 0]}>
        <boxGeometry args={[COURT.widthDoubles + 1.8, COURT.netHeight, 0.03]} />
        <meshStandardMaterial
          color={COLORS.netGray}
          transparent
          opacity={0.6}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Net top cable */}
      <mesh position={[0, COURT.netHeight, 0]}>
        <boxGeometry args={[COURT.widthDoubles + 1.8, 0.03, 0.03]} />
        <meshStandardMaterial color="#fff" />
      </mesh>

      {/* Net posts */}
      {[-1, 1].map(side => (
        <mesh key={side} position={[side * (COURT.widthDoubles / 2 + 0.9), COURT.netHeightPosts / 2, 0]}>
          <cylinderGeometry args={[0.04, 0.04, COURT.netHeightPosts, 8]} />
          <meshStandardMaterial color={COLORS.netPost} metalness={0.6} roughness={0.4} />
        </mesh>
      ))}

      {/* Center strap */}
      <mesh position={[0, COURT.netHeight / 2 - 0.02, 0]}>
        <boxGeometry args={[0.05, COURT.netHeight, 0.02]} />
        <meshStandardMaterial color="#fff" />
      </mesh>
    </group>
  );
});

Court.displayName = 'Court';
