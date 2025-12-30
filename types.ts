export type Role = 'admin' | 'socio' | 'lanchonete';

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string; // E.g., '5588999999999'
  role: Role;
  balance: number;
  avatar?: string;
  category?: string;
  isProfessor?: boolean;
  isActive: boolean; // For gateway authorization
  age?: number;
}

export interface AccessRequest {
  id: string;
  phone: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

export type CourtType = 'Saibro' | 'Rápida';

export interface Court {
  id: string;
  name: string;
  type: CourtType;
  isActive: boolean;
}

export interface Professor {
  id: string;
  userId: string; // Link to User table
  name: string;
  isActive: boolean;
  bio?: string;
}

export type PlanType = 'Day Card' | 'Master Card';

export interface NonSocioStudent {
  id: string;
  name: string;
  phone?: string;
  planType: PlanType;
  planStatus: 'active' | 'inactive';
  masterExpirationDate?: string; // YYYY-MM-DD, required if Master Card
  professorId: string; // The professor who manages this student
}

export type ReservationType = 'Play' | 'Aula' | 'Campeonato' | 'Desafio';

export interface Reservation {
  id: string;
  type: ReservationType;
  date: string; // ISO Date string YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  courtId: string;
  creatorId: string;
  participantIds: string[];
  guestName?: string;
  guestResponsibleId?: string;

  // Class specific
  professorId?: string;
  studentType?: 'socio' | 'non-socio';
  nonSocioStudentId?: string; // Link if studentType is non-socio

  observation?: string;
  status: 'active' | 'cancelled';
}

export interface Product {
  id: string;
  name: string;
  price: number;
  active: boolean;
}

export interface Consumption {
  id: string;
  userId: string;
  productId: string;
  quantity: number;
  totalPrice: number;
  date: string;
  status: 'open' | 'paid';
}

export interface Championship {
  id: string;
  name: string;
  season?: string;
  description?: string;
  status: 'draft' | 'ongoing' | 'finished';
  format: 'mata-mata' | 'pontos-corridos';
  startDate?: string;
  endDate?: string;
  rules?: string;
  logoUrl?: string;

  // Scoring Rules
  ptsVictory?: number;
  ptsSet?: number;
  ptsGame?: number;
  countInGeneralRanking?: boolean;

  // Match Config
  bestOfSets?: number;
  tiebreakEnabled?: boolean;
  autoSummary?: boolean;

  participantIds: string[];
}

export interface BracketSlot {
  id: string;
  championshipId: string;
  phase: string;
  slot: number;
  matchId?: string;
  nextSlotId?: string; // Link to where wearer of this match goes
}

export interface Match {
  id: string;
  championshipId?: string;
  type?: 'Desafio Ranking' | 'Campeonato';
  playerAId: string;
  playerBId: string;
  scoreA: number[];
  scoreB: number[];
  phase?: string;
  slot?: number; // Added to match with BracketSlot
  winnerId?: string;
  date?: string;
  scheduledTime?: string; // HH:mm format for match start time
  status: 'pending' | 'finished' | 'waiting_opponents';
}

export type ChallengeStatus = 'proposed' | 'accepted' | 'declined' | 'scheduled' | 'finished' | 'cancelled' | 'expired';

export interface Challenge {
  id: string;
  status: ChallengeStatus;
  monthRef: string; // YYYY-MM
  createdAt: string;
  challengerId: string;
  challengedId: string;
  reservationId?: string; // Link to a scheduled reservation
  matchId?: string; // Link to the result
  cancelReason?: string;
  // Scheduling fields
  scheduledDate?: string; // YYYY-MM-DD
  scheduledTime?: string; // HH:mm
  courtId?: string;
  notificationSeen?: boolean;
}