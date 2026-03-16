/**
 * Procedural Low-Poly Tennis Player Model
 * Body + Head + Legs + Two Arms + Racket + Movement Dust
 */

import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PLAYER } from '../constants';

interface PlayerModelProps {
  positionRef: React.MutableRefObject<{ x: number; z: number }>;
  color: string;
  lightColor: string;
  label: string;
  swingTimerRef: React.MutableRefObject<number>;
  side: 1 | 2; // 1=bottom (z>0), 2=top (z<0)
}

const DUST_POOL = 6;

export const PlayerModel: React.FC<PlayerModelProps> = ({
  positionRef, color, lightColor, swingTimerRef, side
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const racketRef = useRef<THREE.Group>(null);
  const leftArmRef = useRef<THREE.Group>(null);
  const leftLegRef = useRef<THREE.Mesh>(null);
  const rightLegRef = useRef<THREE.Mesh>(null);
  const lastX = useRef(0);
  const lastZ = useRef(0);
  const runCycle = useRef(0);

  // Movement dust particle pool
  const dustPool = useMemo(() => {
    return Array.from({ length: DUST_POOL }, () => ({
      mesh: null as THREE.Mesh | null,
      x: 0, y: 0, z: 0,
      vy: 0,
      life: 0,
      maxLife: 0,
    }));
  }, []);
  const dustTimer = useRef(0);

  useFrame((_, dt) => {
    if (!groupRef.current) return;
    const pos = positionRef.current;
    groupRef.current.position.set(pos.x, 0, pos.z);

    // Movement speed calculation
    const dx = pos.x - lastX.current;
    const dz = pos.z - lastZ.current;
    const moveSpeed = Math.sqrt(dx * dx + dz * dz) / Math.max(dt, 0.001);

    // Rotate body: face opponent + lean into movement
    const targetRotY = side === 1 ? Math.PI : 0;
    groupRef.current.rotation.y = THREE.MathUtils.lerp(
      groupRef.current.rotation.y,
      targetRotY + dx * 0.5,
      0.1
    );

    // Running leg animation
    if (moveSpeed > 1) {
      runCycle.current += dt * moveSpeed * 0.8;
      const legSwing = Math.sin(runCycle.current) * 0.3;
      if (leftLegRef.current) leftLegRef.current.rotation.x = legSwing;
      if (rightLegRef.current) rightLegRef.current.rotation.x = -legSwing;
    } else {
      // Idle: legs return to neutral
      if (leftLegRef.current) leftLegRef.current.rotation.x = THREE.MathUtils.lerp(leftLegRef.current.rotation.x, 0, 0.1);
      if (rightLegRef.current) rightLegRef.current.rotation.x = THREE.MathUtils.lerp(rightLegRef.current.rotation.x, 0, 0.1);
    }

    // Racket swing animation
    if (racketRef.current) {
      const swing = swingTimerRef.current;
      if (swing > 0) {
        racketRef.current.rotation.x = -Math.PI * 0.5 + Math.sin(swing * 12) * 1.2;
        racketRef.current.rotation.z = Math.sin(swing * 8) * 0.3;
      } else {
        racketRef.current.rotation.x = THREE.MathUtils.lerp(racketRef.current.rotation.x, -0.3, 0.1);
        racketRef.current.rotation.z = THREE.MathUtils.lerp(racketRef.current.rotation.z, 0, 0.1);
      }
    }

    // Left arm: subtle swing counter to racket arm
    if (leftArmRef.current) {
      const swing = swingTimerRef.current;
      if (swing > 0) {
        leftArmRef.current.rotation.x = Math.sin(swing * 10) * -0.6;
      } else {
        leftArmRef.current.rotation.x = THREE.MathUtils.lerp(leftArmRef.current.rotation.x, -0.15, 0.1);
      }
    }

    // Movement dust spawning
    dustTimer.current -= dt;
    if (moveSpeed > 3 && dustTimer.current <= 0) {
      for (const p of dustPool) {
        if (p.life <= 0) {
          p.x = pos.x + (Math.random() - 0.5) * 0.3;
          p.y = 0.02;
          p.z = pos.z + (Math.random() - 0.5) * 0.3;
          p.vy = 0.5 + Math.random() * 0.5;
          p.life = 0.3 + Math.random() * 0.2;
          p.maxLife = p.life;
          dustTimer.current = 0.08;
          break;
        }
      }
    }

    // Update dust
    for (const p of dustPool) {
      if (p.life > 0) {
        p.life -= dt;
        p.y += p.vy * dt;
        p.vy -= 2 * dt;
        if (p.mesh) {
          p.mesh.visible = p.life > 0;
          p.mesh.position.set(p.x, p.y, p.z);
          const ratio = p.life / p.maxLife;
          p.mesh.scale.setScalar(ratio * 0.12);
          (p.mesh.material as THREE.MeshBasicMaterial).opacity = ratio * 0.35;
        }
      } else if (p.mesh) {
        p.mesh.visible = false;
      }
    }

    lastX.current = pos.x;
    lastZ.current = pos.z;
  });

  return (
    <group ref={groupRef}>
      {/* Body (capsule) */}
      <mesh position={[0, PLAYER.height * 0.45, 0]} castShadow>
        <capsuleGeometry args={[PLAYER.bodyRadius, PLAYER.height * 0.4, 4, 8]} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>

      {/* Head */}
      <mesh position={[0, PLAYER.height * 0.85, 0]} castShadow>
        <sphereGeometry args={[PLAYER.headRadius, 12, 8]} />
        <meshStandardMaterial color={lightColor} roughness={0.5} />
      </mesh>

      {/* Legs */}
      <mesh ref={leftLegRef} position={[-0.12, PLAYER.height * 0.15, 0]} castShadow>
        <capsuleGeometry args={[0.08, PLAYER.height * 0.2, 4, 6]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>
      <mesh ref={rightLegRef} position={[0.12, PLAYER.height * 0.15, 0]} castShadow>
        <capsuleGeometry args={[0.08, PLAYER.height * 0.2, 4, 6]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>

      {/* Right Arm + Racket */}
      <group position={[0.35, PLAYER.height * 0.6, 0]} ref={racketRef}>
        {/* Arm */}
        <mesh position={[0, -0.15, 0]}>
          <capsuleGeometry args={[0.06, 0.3, 4, 6]} />
          <meshStandardMaterial color={lightColor} roughness={0.6} />
        </mesh>

        {/* Racket handle */}
        <mesh position={[0, -0.45, 0]}>
          <cylinderGeometry args={[0.02, 0.02, 0.2, 6]} />
          <meshStandardMaterial color="#4a3728" roughness={0.4} />
        </mesh>

        {/* Racket head */}
        <mesh position={[0, -0.62, 0]}>
          <cylinderGeometry args={[0.15, 0.13, 0.02, 12]} />
          <meshStandardMaterial color={lightColor} roughness={0.3} metalness={0.2} />
        </mesh>

        {/* Racket strings */}
        <mesh position={[0, -0.62, 0]}>
          <cylinderGeometry args={[0.12, 0.1, 0.01, 12]} />
          <meshStandardMaterial color="#fff" transparent opacity={0.4} />
        </mesh>
      </group>

      {/* Left Arm */}
      <group position={[-0.35, PLAYER.height * 0.6, 0]} ref={leftArmRef}>
        <mesh position={[0, -0.15, 0]}>
          <capsuleGeometry args={[0.06, 0.3, 4, 6]} />
          <meshStandardMaterial color={lightColor} roughness={0.6} />
        </mesh>
        {/* Hand */}
        <mesh position={[0, -0.35, 0]}>
          <sphereGeometry args={[0.06, 6, 4]} />
          <meshStandardMaterial color={lightColor} roughness={0.5} />
        </mesh>
      </group>

      {/* Shadow circle on ground */}
      <mesh position={[0, 0.003, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.5, 16]} />
        <meshBasicMaterial color="#000" transparent opacity={0.15} />
      </mesh>

      {/* Movement dust particles */}
      {dustPool.map((p, i) => (
        <mesh
          key={`pdust-${i}`}
          ref={el => { p.mesh = el; }}
          visible={false}
        >
          <sphereGeometry args={[0.08, 4, 4]} />
          <meshBasicMaterial color="#c8956a" transparent opacity={0.3} />
        </mesh>
      ))}
    </group>
  );
};
