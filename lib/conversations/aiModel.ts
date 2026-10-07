/**
 * Rótulos e resumos da aba de IA. Puro: o que a tela mostra de uma proposta de reserva feita pelo
 * agente e por que ela falhou. Os códigos vêm de `conv_private.validate_reservation`/`ai_confirm`.
 */
import type { BookingProposal, MemoryKind } from './api';

export const PROPOSAL_STATUS_LABEL: Record<BookingProposal['status'], string> = {
  open: 'Aguardando confirmação', confirmed: 'Confirmada e gravada', failed: 'Não gravada', expired: 'Venceu sem confirmação', canceled: 'Cancelada',
};

export const ACTION_LABEL: Record<BookingProposal['action'], string> = { create: 'Reservar', cancel: 'Cancelar', reschedule: 'Remarcar' };

/** Motivos pelos quais a reserva NÃO foi gravada (o sistema recusou; a IA nunca "confirma" no lugar dele). */
export const FAILURE_LABEL: Record<string, string> = {
  SLOT_TAKEN: 'Horário já ocupado na hora de confirmar',
  IN_PAST: 'Horário já passou',
  INVALID_START: 'Horário fora da grade (05:00–22:30, de 30 em 30)',
  INVALID_DURATION: 'Duração inválida',
  AFTER_CLOSING: 'Passaria das 23:00',
  COURT_NOT_FOUND: 'Quadra não encontrada',
  AULA_ONLY_FAST_COURT: 'Aula só na Quadra Rápida',
  NOT_ALLOWED_AULA: 'Solicitante não pode marcar aula',
  PROFESSOR_REQUIRED: 'Faltou o professor',
  STUDENT_REQUIRED: 'Faltaram os alunos',
  TOO_MANY_PARTICIPANTS: 'Mais de 8 participantes',
  NON_MEMBER_HOURS: 'Horário não permitido para aula de não-sócio',
  PARTICIPANT_NOT_MEMBER: 'Participante sem sócio ativo',
  REQUESTER_NOT_MEMBER: 'Solicitante sem cadastro de sócio ativo',
  REQUESTER_NOT_IDENTIFIED: 'Telefone sem cadastro identificado',
  NEEDS_HUMAN: 'Caso que exige a equipe (ex.: Day Card Experimental)',
  CARD_INVALID: 'Card Mensal inválido',
  STUDENT_PAUSED: 'Aluno pausado ou encerrado',
  NOT_YOUR_RESERVATION: 'Reserva de outra pessoa',
  RESERVATION_NOT_FOUND: 'Reserva não encontrada',
  NOT_EXPLICIT: 'Resposta não foi uma confirmação explícita',
  NOT_AUTHORIZED_TO_CONFIRM: 'Quem confirmou não é o solicitante',
  PROPOSAL_EXPIRED: 'Proposta venceu',
  PROPOSAL_CLOSED: 'Proposta já encerrada',
  CONFIRMATION_NOT_AFTER_PROPOSAL: 'Confirmação anterior à proposta',
};

export const describeFailure = (code: string | null | undefined): string => (code ? FAILURE_LABEL[code] ?? code : '');

const brDay = (iso: string) => iso.slice(0, 10).split('-').reverse().slice(0, 2).join('/');

/** "Play · 08/10 às 18:00–19:00 · Saibro 1" a partir do payload da proposta. */
export function proposalSummary(p: Pick<BookingProposal, 'payload'>): string {
  const n = p.payload as Record<string, unknown>;
  const partes = [
    typeof n.type === 'string' ? n.type : '',
    typeof n.date === 'string' ? `${brDay(n.date)}${typeof n.start === 'string' ? ` às ${n.start}${typeof n.end === 'string' ? `–${n.end}` : ''}` : ''}` : '',
    typeof n.court_name === 'string' ? n.court_name : '',
  ].filter(Boolean);
  return partes.join(' · ') || 'Reserva';
}

/** Tipos de memória que o João pode sugerir (o banco só aceita estes quatro). */
export const MEMORY_KIND_LABEL: Record<MemoryKind, string> = {
  confirmed_fact: 'Fato confirmado', recurring_preference: 'Preferência', social_relation: 'Relação', inside_joke: 'Brincadeira interna',
};

export const MEMORY_KIND_HINT: Record<MemoryKind, string> = {
  confirmed_fact: 'A própria pessoa disse.', recurring_preference: 'Costuma pedir ou preferir.', social_relation: 'Foi informada na conversa.',
  inside_joke: 'O João usa como brincadeira, nunca como verdade literal.',
};

export const confidenceLabel = (c: number): string => `${Math.round(Math.max(0, Math.min(1, Number(c) || 0)) * 100)}% de confiança`;
