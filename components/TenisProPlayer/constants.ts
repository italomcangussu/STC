/**
 * TenisProPlayer 3D - Constants & Configuration
 */

// ─── COURT DIMENSIONS (ITF Standard, in meters) ─────────────────
export const COURT = {
  // Full court
  length: 23.77,
  widthDoubles: 10.97,
  widthSingles: 8.23,
  halfLength: 23.77 / 2, // 11.885

  // Service box
  serviceLineDistance: 6.4, // from net
  centerServiceLine: 0, // center X

  // Net
  netHeight: 0.914, // center
  netHeightPosts: 1.07,
  netPostOffset: 10.97 / 2 + 0.914, // outside doubles line

  // Baseline
  baselineZ: 23.77 / 2,
} as const;

// ─── BALL ────────────────────────────────────────────────────────
export const BALL = {
  radius: 0.15, // exaggerated for visibility (real: 0.033)
  gravity: -9.81,
  restitution: 0.75, // bounce coefficient
  drag: 0.15, // air drag per second
  trailLength: 16,
  minSpeed: 1.5, // below this = dead ball
  spinFactor: 0.35, // how much spin affects vertical trajectory
} as const;

// ─── PLAYER ──────────────────────────────────────────────────────
export const PLAYER = {
  speed: 8, // m/s max
  hitRadius: 2.0, // distance to hit ball
  height: 1.8,
  bodyRadius: 0.3,
  headRadius: 0.2,
  acceleration: 28, // units/s² — ramp up to max speed
  deceleration: 18, // units/s² — slow down when no input
} as const;

// ─── SHOTS ───────────────────────────────────────────────────────
export type ShotType = 'normal' | 'lob' | 'slice';
export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';
export type GameState = 'menu' | 'difficulty' | 'playing' | 'point_scored' | 'game_over';

export const SHOTS = {
  normal: { speed: 25, angleY: 15 * (Math.PI / 180), dragMultiplier: 1.0, spin: 0.6,  label: 'HIT' },
  lob:    { speed: 15, angleY: 45 * (Math.PI / 180), dragMultiplier: 0.8, spin: 0.1,  label: 'LOB' },
  slice:  { speed: 20, angleY: 8 * (Math.PI / 180),  dragMultiplier: 1.3, spin: -0.5, label: 'SLICE' },
} as const;

// ─── DIFFICULTY ──────────────────────────────────────────────────
export interface DifficultyConfig {
  reactionSpeed: number;
  accuracy: number;
  moveSpeed: number;
  shotVariety: number;
  netApproach: number; // 0-1 how often AI approaches the net
  label: string;
  emoji: string;
}

export const DIFFICULTY_CONFIG: Record<Difficulty, DifficultyConfig> = {
  easy:   { reactionSpeed: 0.3,  accuracy: 0.4,  moveSpeed: 0.5,  shotVariety: 0.2, netApproach: 0,    label: 'Iniciante',      emoji: '🟢' },
  medium: { reactionSpeed: 0.55, accuracy: 0.6,  moveSpeed: 0.7,  shotVariety: 0.4, netApproach: 0.1,  label: 'Intermediário',  emoji: '🟡' },
  hard:   { reactionSpeed: 0.75, accuracy: 0.8,  moveSpeed: 0.85, shotVariety: 0.6, netApproach: 0.25, label: 'Avançado',       emoji: '🟠' },
  expert: { reactionSpeed: 0.92, accuracy: 0.92, moveSpeed: 0.95, shotVariety: 0.8, netApproach: 0.4,  label: 'Profissional',   emoji: '🔴' },
};

// ─── TIMING ──────────────────────────────────────────────────────
export const TIMING = {
  pointDisplayMs: 1800,
  serveDelayMs: 1000,
  swingDuration: 0.25,
} as const;

// ─── SCORING DISPLAY ─────────────────────────────────────────────
export const POINTS_DISPLAY = ['0', '15', '30', '40'] as const;

// ─── CAMERA ──────────────────────────────────────────────────────
export const CAMERA = {
  positionX: 0,
  positionY: 12,
  positionZ: COURT.halfLength + 6,
  lookAtY: 1,
  followStrength: 0.03, // how much camera follows player X
  fovPortrait: 50,
  fovLandscape: 58,
} as const;

// ─── COLORS ──────────────────────────────────────────────────────
export const COLORS = {
  courtClay: '#c2410c',
  courtClayLight: '#d4622a',
  courtGreen: '#2d7a3e',
  courtSurround: '#1a5c2a',
  lineWhite: '#f5f5f4',
  netGray: '#a8a29e',
  netPost: '#57534e',
  ballYellow: '#ccff00',
  ballYellowDark: '#a0c800',
  player1: '#2563eb',
  player1Light: '#3b82f6',
  player2: '#dc2626',
  player2Light: '#ef4444',
  skyTop: '#87CEEB',
  skyBottom: '#B0E0E6',
  shadow: '#000000',
} as const;
