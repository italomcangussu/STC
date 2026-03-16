/**
 * Stadium Environment — Improved with crowd, fences, and atmosphere
 */

import React, { useMemo } from 'react';
import * as THREE from 'three';
import { COLORS, COURT } from '../constants';

const CROWD_COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#f97316', '#ffffff', '#ec4899', '#8b5cf6'];

export const Stadium: React.FC = React.memo(() => {
  // Generate crowd dots as instanced positions
  const crowdPositions = useMemo(() => {
    const positions: Array<{ x: number; y: number; z: number; color: string }> = [];
    // Left bleachers
    for (let row = 0; row < 3; row++) {
      const baseX = -12 - row * 2.5;
      const baseY = row * 1.2 + 1.2;
      for (let i = 0; i < 30; i++) {
        positions.push({
          x: baseX + (Math.random() - 0.5) * 1.2,
          y: baseY + Math.random() * 0.4,
          z: -12 + i * 0.85 + (Math.random() - 0.5) * 0.3,
          color: CROWD_COLORS[Math.floor(Math.random() * CROWD_COLORS.length)],
        });
      }
    }
    // Right bleachers
    for (let row = 0; row < 3; row++) {
      const baseX = 12 + row * 2.5;
      const baseY = row * 1.2 + 1.2;
      for (let i = 0; i < 30; i++) {
        positions.push({
          x: baseX + (Math.random() - 0.5) * 1.2,
          y: baseY + Math.random() * 0.4,
          z: -12 + i * 0.85 + (Math.random() - 0.5) * 0.3,
          color: CROWD_COLORS[Math.floor(Math.random() * CROWD_COLORS.length)],
        });
      }
    }
    return positions;
  }, []);

  // Fence geometry
  const fencePosts = useMemo(() => {
    const posts: Array<{ x: number; z: number }> = [];
    for (let i = -8; i <= 8; i += 2) {
      posts.push({ x: i, z: COURT.halfLength + 3 }); // behind player 1
      posts.push({ x: i, z: -COURT.halfLength - 3 }); // behind player 2
    }
    return posts;
  }, []);

  return (
    <group>
      {/* Ground plane */}
      <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color={COLORS.courtSurround} roughness={1} />
      </mesh>

      {/* Bleacher blocks (left) */}
      {[0, 1, 2].map(row => (
        <mesh key={`left-${row}`} position={[-12 - row * 2.5, row * 1.2 + 0.6, 0]} castShadow>
          <boxGeometry args={[2, 1.2 + row * 0.3, 30]} />
          <meshStandardMaterial color="#525252" roughness={0.85} />
        </mesh>
      ))}

      {/* Bleacher blocks (right) */}
      {[0, 1, 2].map(row => (
        <mesh key={`right-${row}`} position={[12 + row * 2.5, row * 1.2 + 0.6, 0]} castShadow>
          <boxGeometry args={[2, 1.2 + row * 0.3, 30]} />
          <meshStandardMaterial color="#525252" roughness={0.85} />
        </mesh>
      ))}

      {/* Crowd dots */}
      {crowdPositions.map((p, i) => (
        <mesh key={`crowd-${i}`} position={[p.x, p.y, p.z]}>
          <sphereGeometry args={[0.18, 4, 3]} />
          <meshStandardMaterial color={p.color} roughness={0.8} />
        </mesh>
      ))}

      {/* Back wall behind P2 */}
      <mesh position={[0, 2, -COURT.halfLength - 5]}>
        <boxGeometry args={[40, 4, 0.3]} />
        <meshStandardMaterial color="#374151" roughness={0.9} />
      </mesh>

      {/* Back wall behind P1 */}
      <mesh position={[0, 2, COURT.halfLength + 5]}>
        <boxGeometry args={[40, 4, 0.3]} />
        <meshStandardMaterial color="#374151" roughness={0.9} />
      </mesh>

      {/* Fence posts */}
      {fencePosts.map((p, i) => (
        <mesh key={`fence-${i}`} position={[p.x, 1.2, p.z]}>
          <cylinderGeometry args={[0.03, 0.03, 2.4, 4]} />
          <meshStandardMaterial color="#71717a" metalness={0.4} roughness={0.6} />
        </mesh>
      ))}

      {/* Fence mesh behind P1 */}
      <mesh position={[0, 1.2, COURT.halfLength + 3]}>
        <boxGeometry args={[18, 2.4, 0.02]} />
        <meshStandardMaterial color="#71717a" transparent opacity={0.3} side={THREE.DoubleSide} />
      </mesh>

      {/* Fence mesh behind P2 */}
      <mesh position={[0, 1.2, -COURT.halfLength - 3]}>
        <boxGeometry args={[18, 2.4, 0.02]} />
        <meshStandardMaterial color="#71717a" transparent opacity={0.3} side={THREE.DoubleSide} />
      </mesh>

      {/* Umpire chair (right side near net) */}
      <group position={[COURT.widthDoubles / 2 + 1.5, 0, 0]}>
        {/* Chair legs */}
        <mesh position={[0, 1.2, 0]}>
          <boxGeometry args={[0.6, 2.4, 0.6]} />
          <meshStandardMaterial color="#57534e" roughness={0.7} />
        </mesh>
        {/* Seat */}
        <mesh position={[0, 2.5, 0]}>
          <boxGeometry args={[0.8, 0.1, 0.6]} />
          <meshStandardMaterial color="#1c1917" roughness={0.5} />
        </mesh>
      </group>
    </group>
  );
});

Stadium.displayName = 'Stadium';
