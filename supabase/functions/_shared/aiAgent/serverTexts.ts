// Textos escritos pelo servidor a partir do que o banco devolveu (proposta, sucesso, erros de reserva).

import { participantes } from './decide.ts';
import { norm } from './serverRules.ts';

/* ------------------------------- Textos escritos pelo servidor ------------------------------- */

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** "hoje", "amanhã" ou "sábado, 10/10". */
export function dayLabel(date: string, todayIso: string): string {
  const d = date.slice(0, 10);
  const t = new Date(`${todayIso.slice(0, 10)}T12:00:00Z`);
  const diff = Math.round((new Date(`${d}T12:00:00Z`).getTime() - t.getTime()) / 86400000);
  if (diff === 0) return 'hoje';
  if (diff === 1) return 'amanhã';
  const dow = DIAS[new Date(`${d}T12:00:00Z`).getUTCDay()];
  return `${dow}, ${d.slice(8, 10)}/${d.slice(5, 7)}`;
}

export const listaNomes = (nomes: string[]) => (nomes.length <= 1 ? nomes.join('') : `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`);

export type Summary = Record<string, any>; // payload normalizado de `validate_reservation`

/** Quem solicitou vira "você" e vai primeiro; nome repetido (ex.: "Carlos" e "Carlos Carneiro") aparece uma vez só. */
function nomesParaFalar(names: string[], me?: string): string[] {
  const visto = new Set<string>();
  const lista = names.filter((x) => { const k = norm(x); if (visto.has(k)) return false; visto.add(k); return true; });
  if (!me) return lista;
  const eu = norm(me);
  const outros = lista.filter((x) => norm(x) !== eu);
  return outros.length === lista.length ? lista : ['você', ...outros];
}

export function describeReservation(n: Summary, today: string, names: string[] = [], me?: string): string {
  const quando = `${dayLabel(String(n.date), today)}, ${n.start}${n.end ? `–${n.end}` : ''}`;
  const onde = n.court_name ? ` na ${n.court_name}` : '';
  const falar = nomesParaFalar(names, me);
  const quem = falar.length ? ` para ${listaNomes(falar)}` : '';
  return `${n.type === 'Aula' ? 'aula' : 'reserva'} ${quando}${onde}${quem}`;
}

export function proposalMessage(action: 'create' | 'cancel' | 'reschedule', n: Summary, today: string, names: string[], me?: string): string {
  if (action === 'cancel') return `Vou cancelar a ${describeReservation(n, today)}. Posso cancelar?`;
  if (action === 'reschedule') return `Dá pra remarcar sim: ${describeReservation(n, today, names, me)}. A anterior eu cancelo. Posso fechar assim?`;
  return `Tá livre! Seria ${describeReservation(n, today, names, me)}. Posso confirmar?`;
}

/** Jogo que ocupa o horário, como o banco devolve (`conv_svc_ai_slot_games`). */
export type Game = { reservation_id: string; type: string; date: string; start: string; end: string; court_name: string | null;
  names: string[]; participants: number; spots_left: number; joinable: boolean; reason?: string | null };

const jogoDe = (g: Pick<Game, 'date' | 'start' | 'end' | 'court_name'>, today: string) =>
  `${dayLabel(String(g.date), today)}, ${g.start}–${g.end}${g.court_name ? ` na ${g.court_name}` : ''}`;

/** Horário ocupado por um jogo com vaga: mostra quem está e oferece entrar (o "sim" é confirmado pelo banco). */
export function joinOfferMessage(g: Game, today: string, levando: string[] = []): string {
  const quem = g.names.length ? `, com ${listaNomes(g.names)}` : '';
  const vagas = g.spots_left === 1 ? 'resta 1 vaga' : `restam ${g.spots_left} vagas`;
  const junto = levando.length ? ` com ${listaNomes(levando)}` : '';
  if (g.participants >= 4) {
    return `Rapaz, esse play já tá com uma galera, viu: ${jogoDe(g, today)}${quem} (${vagas}). Se quiser entrar${junto}, cabe; ou eu vejo outra quadra/horário pra você.`;
  }
  return `Esse horário já está reservado: ${jogoDe(g, today)}${quem} (${vagas}). Quer entrar nesse jogo${junto}? Se quiser, ${levando.length ? 'já adiciono vocês' : 'já te adiciono'}.`;
}

/** O jogo tem vaga, mas não para todo mundo que a pessoa quer levar. */
export function notEnoughSpotsMessage(g: Game, spots: number, wanted: number, today: string): string {
  const vagas = spots === 1 ? 'só resta 1 vaga' : spots === 0 ? 'não há mais vagas' : `só restam ${spots} vagas`;
  return `Já existe um jogo nesse horário (${jogoDe(g, today)}, com ${listaNomes(g.names)}), mas ${vagas} e você quer entrar com ${wanted} ${wanted === 1 ? 'pessoa' : 'pessoas'}. Quer entrar com menos gente?`;
}

/** Horário ocupado por algo em que a pessoa não pode entrar (lotado, já está, aula, campeonato). */
export function busyMessage(g: Game, today: string): string {
  if (g.reason === 'ALREADY_IN') return `Você já está nesse jogo: ${jogoDe(g, today)}${g.names.length ? `, com ${listaNomes(g.names)}` : ''}.`;
  if (g.reason === 'GAME_FULL') return `Esse horário já tem jogo com 8 pessoas: ${jogoDe(g, today)}, com ${listaNomes(g.names)}. Está lotado.`;
  if (g.type === 'Aula') return `Esse horário está reservado para uma aula (${jogoDe(g, today)}).`;
  if (g.type === 'Play') return `Esse horário já está reservado: ${jogoDe(g, today)}${g.names.length ? `, com ${listaNomes(g.names)}` : ''}.`;
  return `Esse horário está ocupado (${jogoDe(g, today)}).`;
}

/** Reserva da agenda que o agente enxerga (`ai_agenda`). */
export type AgendaItem = { ref: string; id: string; type: string; date: string; start: string; end: string; court: string | null;
  people: { id: string; name: string }[]; guest: string | null; spots_left: number | null; mine: boolean;
  can: { leave: boolean; people: boolean; edit: boolean; cancel: boolean } };

const quandoDe = (n: Record<string, any>, today: string) =>
  `${dayLabel(String(n.date), today)}, ${n.start}${n.end ? `–${n.end}` : ''}${n.court_name ?? n.court ? ` na ${n.court_name ?? n.court}` : ''}`;
const comVoce = (nomes: string[], me?: string) => nomes.map((x) => (me && x === me ? 'você' : x));

/** O que o servidor entendeu do pedido de mexer nos atletas — mostrado ANTES de gravar. */
export function participantsProposalMessage(n: Summary, today: string, me?: string): string {
  const quando = quandoDe(n, today);
  if (n.cancel_all) return `Você é o último atleta da reserva de ${quando}: ao sair, a reserva inteira é cancelada. Posso cancelar?`;
  const tira = [...comVoce((n.remove_names ?? []) as string[], me), ...(n.remove_guest && !n.add_guest ? ['o convidado'] : [])];
  const poe = [...((n.add_names ?? []) as string[]), ...(n.add_guest ? [`${n.add_guest} (convidado)`] : [])];
  const partes = [tira.length ? `retirar ${listaNomes(tira)}` : '', poe.length ? `adicionar ${listaNomes(poe)}` : ''].filter(Boolean);
  const ficam = comVoce((n.after_names ?? []) as string[], me);
  return `Vou ${partes.join(' e ')} ${poe.length ? 'na' : 'da'} reserva de ${quando}. Ficam: ${listaNomes(ficam)}. Posso confirmar?`;
}

export function successMessage(action: 'create' | 'cancel' | 'reschedule' | 'join' | 'participants', n: Summary, today: string, names: string[], me?: string): string {
  if (action === 'participants') {
    const quando = quandoDe(n, today);
    if (n.cancel_all) return `Pronto, você saiu e a reserva de ${quando} foi cancelada.`;
    const soEu = n.self_leaving && (n.remove_names ?? []).length === 1 && !(n.add_names ?? []).length && !n.add_guest && !n.remove_guest;
    return soEu
      ? `Pronto, você saiu da reserva de ${quando}. Continuam: ${listaNomes(comVoce((n.after_names ?? []) as string[], me))}.`
      : `Pronto, atualizei a reserva de ${quando}. Agora jogam: ${listaNomes(comVoce((n.after_names ?? []) as string[], me))}.`;
  }
  if (action === 'join') {
    const ordem = [...((n.names ?? []) as string[]).filter((x) => x !== me), ...(me ? ['você'] : [])];
    return `Pronto, ${Number(n.added ?? 1) > 1 ? 'vocês entraram' : 'você entrou'} no jogo de ${jogoDe(n as Game, today)}. Jogam: ${listaNomes(ordem)}.`;
  }
  if (action === 'cancel') return `Pronto, a ${describeReservation(n, today)} foi cancelada.`;
  if (action === 'reschedule') return `Pronto, remarcado: ${describeReservation(n, today, names, me)}. Bom jogo!`;
  return `Fechado, tá reservado: ${describeReservation(n, today, names, me)}. Bom jogo!`;
}

/** Mensagens para os códigos que o banco devolve. `null` = o caso pede transferência para a equipe. */
export const CODE_TEXT: Record<string, string | null> = {
  IN_PAST: 'Esse horário já passou. Qual outro dia ou horário fica bom?',
  INVALID_START: 'Os horários começam das 05:00 às 22:30, de 30 em 30 minutos. Qual horário você prefere?',
  INVALID_DURATION: 'A duração do Play pode ser 60, 90 ou 120 minutos (a aula tem 30). Qual você prefere?',
  AFTER_CLOSING: 'Essa reserva passaria das 23:00, quando o clube fecha. Quer um horário mais cedo ou menos tempo?',
  INVALID_DATE: 'Não entendi a data. Pode me dizer o dia?',
  COURT_NOT_FOUND: 'Não encontrei essa quadra ativa. Quer saibro ou rápida?',
  AULA_ONLY_FAST_COURT: 'Aulas só acontecem na Quadra Rápida. Posso procurar nela?',
  NOT_ALLOWED_AULA: 'Só professor ou administrador marca aula por aqui. Posso te ajudar com uma reserva de quadra (Play)?',
  PROFESSOR_REQUIRED: 'Qual professor vai dar a aula?',
  STUDENT_REQUIRED: 'Quem são os alunos da aula?',
  TOO_MANY_PARTICIPANTS: 'Uma reserva tem no máximo 8 participantes. Quem fica de fora?',
  NON_MEMBER_HOURS: 'Aula só com não-sócios ou dependentes: de manhã (até 12h) ou à noite (a partir das 20h). Qual horário serve?',
  INVALID_GUEST: 'Qual o nome do convidado?',
  PARTICIPANT_NOT_MEMBER: 'Algum participante não está ativo como sócio. A equipe precisa conferir.',
  REQUESTER_NOT_MEMBER: null,
  REQUESTER_NOT_IDENTIFIED: null,
  NEEDS_HUMAN: null,
  CARD_INVALID: null,
  STUDENT_PAUSED: null,
  NOT_IN_RESERVATION: 'Essa pessoa não está nessa reserva. Quem está nela eu posso te dizer; quer ver?',
  NOT_PLAY: 'Só consigo mexer nos atletas de reservas de Play (aula e campeonato é com a equipe).',
  NOTHING_TO_DO: 'Não vi nada para alterar nessa reserva. O que você quer mudar?',
  RESERVATION_STARTED: 'Esse jogo já começou: agora só dá para sair dele. Quer sair?',
  CREATOR_PROTECTED: 'Só quem criou a reserva (ou um administrador) pode retirar o criador.',
  GUEST_ALREADY: 'Esse jogo já tem um convidado. Quer trocar por outro (retiro o atual e coloco o novo)?',
  NOT_YOUR_RESERVATION: 'Só quem criou a reserva (ou um administrador) pode cancelar ou remarcar.',
  RESERVATION_NOT_FOUND: 'Não encontrei essa reserva entre as suas futuras.',
  NOT_EXPLICIT: 'Não entendi se é para seguir com o que descrevi acima. Sigo assim, ou quer mudar algo?',
  NOT_AUTHORIZED_TO_CONFIRM: 'Só quem pediu (ou um administrador) pode confirmar. Quem pediu pode me dizer se sigo.',
  PROPOSAL_EXPIRED: 'A proposta venceu. Quer que eu monte outra com os mesmos dados?',
  PROPOSAL_CLOSED: 'Essa proposta já não está aberta. Quer que eu monte outra?',
  CONFIRMATION_NOT_AFTER_PROPOSAL: 'Acabei de te mandar o resumo atualizado; me diz se sigo com ele.',
};
