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

export type PlanType = 'Day Card' | 'Card Mensal' | 'Dependente' | 'Day Card Experimental';
export type StudentType = 'regular' | 'dependent';
export type RelationshipType = 'filho' | 'filha' | 'esposo' | 'esposa' | 'outro';
export type PaymentStatus = 'active' | 'cancelled';

export interface NonSocioStudent {
  id: string;
  name: string;
  phone?: string;
  planType: PlanType;
  planStatus: 'active' | 'inactive';
  masterExpirationDate?: string; // YYYY-MM-DD, required if Master Card
  professorId: string | null; // The professor who manages this student (null for dependents)
  isActive?: boolean; // Soft delete flag (default: true)
  
  // Dependent student fields
  studentType?: StudentType; // 'regular' or 'dependent'
  responsibleSocioId?: string; // ID of the socio responsible for dependent
  relationshipType?: RelationshipType; // Relationship to responsible socio
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
  participantNames?: (string | null)[]; // Optional display names when participants are guests/registrations
  participantAvatars?: (string | null)[]; // Optional avatars for those participants
  guestName?: string;
  guestResponsibleId?: string;

  // Class specific
  professorId?: string;
  studentType?: 'socio' | 'non-socio';
  nonSocioStudentId?: string; // Link if studentType is non-socio
  nonSocioStudentIds?: string[]; // Multiple non-socio/dependent students

  observation?: string;
  status: 'active' | 'cancelled';

  // Match/Live Score specific
  matchId?: string;
  scoreA?: number[];
  scoreB?: number[];
  matchStatus?: 'pending' | 'finished' | 'waiting_opponents';
  matchWinnerId?: string | null;
  matchIsWalkover?: boolean;
  matchRegistrationAId?: string | null;
  matchRegistrationBId?: string | null;
  matchWalkoverWinnerRegistrationId?: string | null;
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
  format: 'mata-mata' | 'pontos-corridos' | 'grupo-mata-mata';
  startDate?: string;
  endDate?: string;
  rules?: string;
  logoUrl?: string;

  // Scoring Rules
  ptsVictory?: number;
  ptsDefeat?: number;
  ptsWoVictory?: number;
  ptsTechnicalDraw?: number;
  ptsSet?: number;
  ptsGame?: number;
  countInGeneralRanking?: boolean;
  finalRankingPts?: number; // Bonus for ranking winner
  slug?: string;

  // Tiebreak Config
  tiebreakRules?: ('h2h' | 'sets' | 'games')[];

  // Match Config
  bestOfSets?: number;
  tiebreakEnabled?: boolean;
  autoSummary?: boolean;

  participantIds: string[];

  // Group Stage Config
  groups?: ChampionshipGroup[];
}

export interface ChampionshipGroup {
  name: string; // e.g. "6ª CLASSE"
  participantIds: string[];
}

export interface InternalStanding {
  userId: string;
  points: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
  setsWon: number;
  setsLost: number;
  gamesWon: number;
  gamesLost: number;
  groupName: string;
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
  playerAId: string | null; // Nullable for guest players
  playerBId: string | null; // Nullable for guest players
  scoreA: number[];
  scoreB: number[];
  phase?: string;
  slot?: number; // Added to match with BracketSlot
  winnerId?: string | null;
  date?: string;
  scheduledTime?: string; // HH:mm format for match start time
  status: 'pending' | 'finished' | 'waiting_opponents';

  // Championship context
  championship_group_id?: string;
  round_id?: string;
  scheduled_date?: string;
  scheduled_time?: string;
  court_id?: string;

  // Guest player support
  registration_a_id?: string;
  registration_b_id?: string;

  // Walkover
  is_walkover?: boolean;
  walkover_winner_id?: string | null;
  walkover_winner_registration_id?: string | null;

  // Admin result controls
  result_type?: 'played' | 'walkover' | 'technical_draw';
  admin_notes?: string | null;
  result_set_by?: string | null;
  result_set_at?: string | null;
}

export interface ChampionshipRound {
  id: string;
  championship_id: string;
  round_number: number;
  name: string;
  phase: string;
  start_date: string;
  end_date: string;
  status: 'pending' | 'active' | 'finished';
}

export interface ChampionshipRegistration {
  id: string;
  championship_id: string;
  participant_type: 'socio' | 'guest';
  user_id: string | null;
  guest_name: string | null;
  class: string;
  shirt_size: string;
  user?: User;
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

export interface PointRule {
  id: string;
  rule_key: string;
  points: number;
  description: string;
  updated_at: string;
}
