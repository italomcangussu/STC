/**
 * 3D Tennis Ball with improved trail, shadow, and dust particles
 */

import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { COLORS, BALL } from '../constants';
import type { BallState } from '../engine/useBallPhysics';

interface BallProps {
  ballRef: React.MutableRefObject<BallState>;
}

const DUST_COUNT = 8;

export const Ball: React.FC<BallProps> = ({ ballRef }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const shadowRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);

  // Dust particle pool
  const dustParticles = useMemo(() => {
    return Array.from({ length: DUST_COUNT }, () => ({
      mesh: null as THREE.Mesh | null,
      x: 0, y: 0, z: 0,
      vx: 0, vy: 0, vz: 0,
      life: 0,
      maxLife: 0,
    }));
  }, []);

  // Trail spheres for gradient fade effect
  const trailSpheres = useMemo(() => {
    return Array.from({ length: BALL.trailLength }, () => ({
      mesh: null as THREE.Mesh | null,
    }));
  }, []);

  const trailGeo = useMemo(() => new THREE.SphereGeometry(BALL.radius * 0.6, 6, 4), []);

  useFrame((_, dt) => {
    const b = ballRef.current;
    if (!meshRef.current) return;

    if (b.inPlay) {
      meshRef.current.visible = true;
      meshRef.current.position.set(b.x, b.y, b.z);
      meshRef.current.rotation.x += 0.15 * (1 + Math.abs(b.spin));
      meshRef.current.rotation.z += 0.05;

      // Glow ring (speed indicator)
      if (glowRef.current) {
        glowRef.current.visible = true;
        glowRef.current.position.set(b.x, b.y, b.z);
        const glowScale = 1 + (b.speed / 30) * 0.8;
        glowRef.current.scale.setScalar(glowScale);
        (glowRef.current.material as THREE.MeshBasicMaterial).opacity = Math.min(0.25, b.speed * 0.008);
      }

      // Shadow on ground
      if (shadowRef.current) {
        shadowRef.current.visible = true;
        shadowRef.current.position.set(b.x, 0.005, b.z);
        const scale = Math.max(0.3, 1 - b.y * 0.05);
        shadowRef.current.scale.set(scale, scale, scale);
        (shadowRef.current.material as THREE.MeshBasicMaterial).opacity = Math.max(0.05, 0.25 - b.y * 0.02);
      }

      // Trail spheres (gradient fade)
      for (let i = 0; i < BALL.trailLength; i++) {
        const sphere = trailSpheres[i];
        if (!sphere.mesh) continue;
        if (i < b.trail.length) {
          sphere.mesh.visible = true;
          const t = b.trail[i];
          sphere.mesh.position.set(t.x, t.y, t.z);
          const progress = i / b.trail.length;
          const s = 0.2 + progress * 0.8;
          sphere.mesh.scale.setScalar(s);
          (sphere.mesh.material as THREE.MeshBasicMaterial).opacity = progress * 0.3 * (b.speed / 25);
        } else {
          sphere.mesh.visible = false;
        }
      }

      // Dust particles on bounce
      if (b.justBounced && b.lastBouncePos) {
        for (const p of dustParticles) {
          if (p.life <= 0) {
            p.x = b.lastBouncePos.x;
            p.y = 0.05;
            p.z = b.lastBouncePos.z;
            const angle = Math.random() * Math.PI * 2;
            const force = 1 + Math.random() * 2;
            p.vx = Math.cos(angle) * force;
            p.vy = 1 + Math.random() * 2;
            p.vz = Math.sin(angle) * force;
            p.life = 0.4 + Math.random() * 0.3;
            p.maxLife = p.life;
            break;
          }
        }
      }
    } else {
      meshRef.current.visible = false;
      if (shadowRef.current) shadowRef.current.visible = false;
      if (glowRef.current) glowRef.current.visible = false;
      for (const s of trailSpheres) {
        if (s.mesh) s.mesh.visible = false;
      }
    }

    // Update dust particles
    for (const p of dustParticles) {
      if (p.life > 0) {
        p.life -= dt;
        p.vy -= 5 * dt; // gravity
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        if (p.y < 0) p.y = 0;

        if (p.mesh) {
          p.mesh.visible = p.life > 0;
          p.mesh.position.set(p.x, p.y, p.z);
          const ratio = p.life / p.maxLife;
          p.mesh.scale.setScalar(ratio * 0.15);
          (p.mesh.material as THREE.MeshBasicMaterial).opacity = ratio * 0.5;
        }
      } else if (p.mesh) {
        p.mesh.visible = false;
      }
    }
  });

  return (
    <group>
      {/* Ball */}
      <mesh ref={meshRef} castShadow>
        <sphereGeometry args={[BALL.radius, 16, 12]} />
        <meshStandardMaterial
          color={COLORS.ballYellow}
          emissive={COLORS.ballYellowDark}
          emissiveIntensity={0.15}
          roughness={0.7}
        />
      </mesh>

      {/* Speed glow */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[BALL.radius * 1.5, 8, 6]} />
        <meshBasicMaterial color={COLORS.ballYellow} transparent opacity={0.15} />
      </mesh>

      {/* Shadow disk on ground */}
      <mesh ref={shadowRef} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.3, 16]} />
        <meshBasicMaterial color={COLORS.shadow} transparent opacity={0.2} />
      </mesh>

      {/* Trail spheres */}
      {trailSpheres.map((sphere, i) => (
        <mesh
          key={i}
          ref={el => { sphere.mesh = el; }}
          visible={false}
          geometry={trailGeo}
        >
          <meshBasicMaterial color={COLORS.ballYellow} transparent opacity={0} />
        </mesh>
      ))}

      {/* Dust particles */}
      {dustParticles.map((p, i) => (
        <mesh
          key={`dust-${i}`}
          ref={el => { p.mesh = el; }}
          visible={false}
        >
          <sphereGeometry args={[0.1, 4, 4]} />
          <meshBasicMaterial color="#c8956a" transparent opacity={0.4} />
        </mesh>
      ))}
    </group>
  );
};
