// Decisão do turno: o que o servidor executa (plano do assessor, disponibilidade, proposta, participantes, entrar no jogo).

import { ACTIONABLE, parseSlots } from './answerParse.ts';
import { type AdminAction, adminSuccessMessage, isAdminProposalAction } from './adminMessages.ts';
import { type AdminPlan, completeCurrentStep, nextActionStep, planClosing, planIntro, stepHeading } from './adminPlan.ts';
import type { Answer, Decision, Memory, Slots, TurnDeps } from './turnTypes.ts';
import { CODE_TEXT, type Game, type Summary, dayLabel, participantsProposalMessage, proposalMessage, successMessage } from './serverTexts.ts';
import { type Court, EU, acharNaReserva, acharReserva, pickCourts, reservaPorRef, toMin } from './agendaLookup.ts';
import type { Ctx } from './promptTypes.ts';
import type { ProvisionResult } from '../athleteProvision.ts';
import { type TopicSnapshot, domainOf } from './topicState.ts';
import { adminAcao, adminConsulta } from './adminAssistant.ts';
import { adminFinanceiro } from './adminFinance.ts';
import { claimsSuccess, norm } from './serverRules.ts';
import { failure, resolve } from './turnOutcome.ts';
import { isAdminAssistant } from './promptAdmin.ts';
import { sendWelcome } from './welcome.ts';
import { consultarDisponibilidade } from './availability.ts';
import { aulasEmLote, canBatchLessons, lessonsConfirmed } from './lessonsBatch.ts';

/* ------------------------------- Plano composto do assessor ------------------------------- */

async function adminPlano(i: DecideInput, memory: Memory, plan: AdminPlan): Promise<Decision> {
  const intro = planIntro(plan);
  const next = nextActionStep(plan);
  if (next === null) {
    return { bubbles: [intro, 'São passos do painel; se quiser, te acompanho em cada um.'], awaiting: false, close: false,
      action: 'admin_plan_manual', memory, slots: { ...i.slots, plan }, verbatim: true };
  }
  return runPlanStep(i, memory, plan, next, [intro]);
}

/** Prepara um passo pelo caminho normal da ação (proposta no banco); o aceite natural do administrador executa. */
async function runPlanStep(i: DecideInput, memory: Memory, plan: AdminPlan, index: number, prefix: string[]): Promise<Decision> {
  const step = plan.steps[index];
  const stepSlots = parseSlots(step.slots ?? {});
  const run = step.intent === 'admin_financeiro' ? adminFinanceiro : adminAcao;
  const sub = await run({ ...i, slots: stepSlots }, memory);
  const withCursor: AdminPlan = { ...plan, cursor: index };
  const heading = plan.steps.filter((s) => s.kind === 'acao').length > 1 ? [stepHeading(plan, index)] : [];
  return { ...sub, bubbles: [...prefix, ...heading, ...sub.bubbles], verbatim: true, slots: { ...stepSlots, plan: withCursor } };
}

export async function continuePlan(i: DecideInput, done: Decision, plan: AdminPlan): Promise<Decision> {
  const updated = completeCurrentStep(plan);
  const next = nextActionStep(updated);
  if (next === null) return { ...done, bubbles: [...done.bubbles, planClosing(updated)], slots: { plan: updated }, verbatim: true };
  const step = await runPlanStep({ ...i, ctx: { ...i.ctx, open_proposal: null } }, done.memory, updated, next, done.bubbles);
  return step.action?.startsWith('proposed') ? step : { ...step, action: step.action ?? 'ask' };
}

/** Dados de partida do turno: os do assunto retomado; nada se é tarefa nova; senão a memória solta (consultas). */
export function baseSlotsFor(memory: Memory, answer: Answer, topico: TopicSnapshot | null): Slots | undefined {
  if (topico) return topico.slots as Slots;
  return startsFresh(memory, answer) ? undefined : memory.slots;
}

/** Tarefa nova: pedida como nova, ou outra ação/domínio sem assunto pendente correspondente ("na verdade quero cancelar"). */
export function startsFresh(memory: Memory, answer: Answer): boolean {
  if (answer.topic_mode === 'new') return true;
  const trocouDeAcao = memory.intent !== undefined && ACTIONABLE.includes(memory.intent) && ACTIONABLE.includes(answer.intent) && memory.intent !== answer.intent;
  const antes = domainOf(memory.intent);
  const agora = domainOf(answer.intent);
  return trocouDeAcao || (antes !== null && agora !== null && antes !== agora);
}

/** A proposta aberta só pode ser confirmada ou recusada pelo assunto que a recebeu (o único "aguardando confirmação"). */
export function proposalBelongsElsewhere(ctx: Ctx, topico: TopicSnapshot | null): boolean {
  return Boolean((ctx.open_proposal as Ctx | null)?.id && topico && topico.status !== 'awaiting_confirmation');
}

/* ------------------------------- Decisão: o que o servidor executa ------------------------------- */

export type DecideInput = { deps: TurnDeps; ctx: Ctx; answer: Answer; slots: Slots; memory: Memory; session: string; ultimaId?: string; today: string };

export async function decide(i: DecideInput): Promise<Decision> {
  const { deps, ctx, answer, session, today } = i;
  const { db } = deps;
  const memory = { ...i.memory };
  const hasProposal = Boolean(ctx.open_proposal);
  const plain = (extra: Partial<Decision> = {}): Decision => {
    // Nenhuma frase do modelo pode afirmar que algo foi reservado/confirmado/cancelado.
    // Só a bolha que anuncia sucesso sai; o resto da resposta (piada, contexto) continua.
    const semAnuncio = answer.messages.filter((m) => !claimsSuccess(m));
    const seguro = semAnuncio.length < answer.messages.length && !semAnuncio.length
      ? ['Ainda não registrei nada. Me diga o que falta e eu monto o resumo para você confirmar.']
      : semAnuncio;
    // Sem texto e sem transferência, o modelo falhou em dizer algo: nunca fica silêncio.
    const bubbles = seguro.length || answer.transfer || answer.close ? seguro : ['Não entendi bem. Pode me explicar de outro jeito?'];
    return { bubbles, awaiting: answer.awaiting || (!seguro.length && !answer.transfer && !answer.close), close: answer.close, action: null, memory, ...extra };
  };

  // 1) Desistência da proposta.
  if (answer.declined && hasProposal) {
    await db('conv_svc_ai_cancel_proposal', { p_session: session });
    return { bubbles: answer.messages.length ? answer.messages : ['Tudo bem, não vou fazer nada. Se precisar, é só chamar.'],
      awaiting: false, close: true, action: 'declined', memory: { intent: answer.intent, slots: {} } };
  }

  // 2) Confirmação: o banco decide (mensagem inequívoca, solicitante ou admin, depois da proposta, revalidando).
  if (hasProposal && answer.customer_confirmed) {
    if (!i.ultimaId) return plain({ bubbles: [CODE_TEXT.NOT_EXPLICIT as string], awaiting: true });
    const res = (await db('conv_svc_ai_confirm', { p_proposal: (ctx.open_proposal as Ctx).id, p_message: i.ultimaId })).data as
      { ok: boolean; code?: string; message?: string; action?: 'create' | 'cancel' | 'reschedule' | 'join' | 'participants'; summary?: Summary } | null;
    if (res?.ok && (res as { needs_provision?: boolean }).needs_provision && res.summary) {
      // Cadastro de sócio: o Auth só a borda alcança; depois o banco conclui plano, cobrança e baixa com o comprovante.
      const sm = res.summary as unknown as Ctx;
      const prov: ProvisionResult = deps.provision ? await deps.provision({ name: String(sm.name), phone: String(sm.phone), email: (sm.email as string | undefined) ?? null })
        : { ok: false, error: 'indisponível' };
      if (prov.ok === false) return { bubbles: [`Não consegui criar o acesso de ${sm.name} agora (${prov.error}). Pode repetir o "sim" daqui a pouco, ou use o painel (Acessos).`], awaiting: true, close: false, action: 'failed:PROVISION', memory };
      const done = (await db('conv_svc_ai_admin_member_onboard', { p_proposal: (ctx.open_proposal as Ctx).id, p_profile: prov.profileId, p_message: i.ultimaId })).data as
        { ok: boolean; code?: string; message?: string; action?: string; summary?: Summary } | null;
      if (done?.ok && done.summary) {
        // Boas-vindas no grupo do clube (só na primeira vez; o envio é idempotente pela proposta e nunca derruba o cadastro).
        if (!(done as { replayed?: boolean }).replayed) await sendWelcome(db, deps.uaz, { name: String(sm.name), proposalId: String((ctx.open_proposal as Ctx).id) });
        return { bubbles: [adminSuccessMessage(done.action as unknown as AdminAction, done.summary as unknown as Ctx)], awaiting: false, close: false,
          action: 'admin_confirmed', memory: { intent: answer.intent, slots: {} } };
      }
      return { bubbles: [done?.message ?? 'Não consegui concluir o cadastro. Confira no painel.'], awaiting: true, close: false, action: `failed:${done?.code ?? 'ONBOARD'}`, memory };
    }
    if ((ctx.open_proposal as Ctx).action === 'lessons_batch') return lessonsConfirmed(res as Parameters<typeof lessonsConfirmed>[0], i, memory);
    if (res?.ok && res.summary && isAdminProposalAction(res.action)) {
      return { bubbles: [adminSuccessMessage(res.action as unknown as AdminAction, res.summary as unknown as Ctx)], awaiting: false, close: false,
        action: 'admin_confirmed', memory: { intent: answer.intent, slots: {} } };
    }
    if (!res?.ok && isAdminProposalAction((ctx.open_proposal as Ctx).action)) {
      return { bubbles: [res?.message ?? 'Não consegui registrar. Quer que eu monte de novo?'], awaiting: true, close: false, action: `failed:${res?.code ?? 'UNKNOWN'}`, memory };
    }
    if (res?.ok && res.summary) {
      const names = (memory.proposal_names ?? []) as string[];
      const me = String(((ctx.requester as Ctx | undefined)?.profile as Ctx | undefined)?.name ?? '') || undefined;
      return { bubbles: [successMessage(res.action ?? 'create', res.summary, today, names, me)], awaiting: false, close: true, action: res.action === 'join' ? 'joined' : res.action === 'participants' ? 'participants_changed' : 'confirmed',
        memory: { intent: answer.intent, slots: {} } };
    }
    return failure(res?.code ?? 'UNKNOWN', res?.message, i, memory, ctx.open_proposal as Ctx);
  }

  // 2-) Pedido composto do administrador: mostra o plano e já prepara o primeiro passo executável.
  if (answer.plan && isAdminAssistant(ctx) && !answer.transfer) return adminPlano(i, memory, answer.plan);

  // 2a) Sair, retirar ou adicionar atletas de uma reserva existente (e convidado): o servidor entende, valida e propõe.
  if (answer.intent === 'participantes' && !answer.transfer) return participantes(i, memory);

  // 2b) "Quem marcou esse horário?" / "me adiciona nessa reserva": o servidor mostra quem está e oferece entrar. O modelo não escreve nada.
  if (answer.intent === 'entrar' && !answer.transfer) return entrarNoJogo(i, memory);

  // 2b') Professor ou assessor manda a lista de aulas: confere tudo e propõe numa mensagem só.
  if (answer.intent === 'aulas_lote' && canBatchLessons(ctx) && !answer.transfer) return aulasEmLote(i, memory);

  // 2c) "Tem quadra livre?", "quais horários livres?" — consulta real ao motor, sem exigir participantes e sem handoff.
  if (answer.intent === 'consultar_disponibilidade' && !answer.transfer) return consultarDisponibilidade(i, memory);

  // 2d) Assessor administrativo: lançamento, cobrança, régua e baixa (o banco só aceita administrador no privado).
  if (answer.intent === 'admin_financeiro' && answer.ready && !answer.transfer) return adminFinanceiro(i, memory);
  if (answer.intent === 'admin_consulta' && !answer.transfer) return adminConsulta(i, memory);
  if (answer.intent === 'admin_acao' && answer.ready && !answer.transfer) return adminAcao(i, memory);

  // 3) Pedido pronto: o servidor resolve pessoas, confere disponibilidade e monta a PROPOSTA.
  if (answer.ready && (answer.intent === 'reservar' || answer.intent === 'cancelar' || answer.intent === 'remarcar')) {
    return propose(i, memory);
  }

  // 4) Resto: texto do modelo (dúvida, pergunta de dado faltante, despedida).
  return plain();
}

async function propose(i: DecideInput, memory: Memory): Promise<Decision> {
  const { deps, ctx, answer, slots, session, today } = i;
  const { db } = deps;
  const profile = (ctx.requester?.profile ?? null) as Ctx | null;
  const ask = (text: string, extra: Partial<Decision> = {}): Decision => ({ bubbles: [text], awaiting: true, close: false, action: 'ask', memory, ...extra });
  const soft = (text: string, note: string): Decision => ({ bubbles: [text], awaiting: false, close: false, action: 'handoff', memory,
    handoff: { kind: 'soft', note } });

  if (!profile?.is_member) {
    return soft('Não consegui identificar o seu cadastro de sócio por este telefone, então não posso reservar por aqui. Vou pedir para alguém da equipe te ajudar.',
      'Pedido de reserva por telefone sem cadastro de sócio identificado.');
  }
  const courts = (ctx.courts ?? []) as Court[];
  let payload: Record<string, unknown>;
  let action: 'create' | 'cancel' | 'reschedule' = answer.intent === 'cancelar' ? 'cancel' : answer.intent === 'remarcar' ? 'reschedule' : 'create';
  let names: string[] = [];
  let candidates: Court[] = [];

  if (action !== 'create') {
    const achada = acharReserva(ctx, slots).item;
    const ref = reservaPorRef(ctx, slots.reservation_ref) ?? (achada && { id: achada.id, type: achada.type, date: achada.date, start: achada.start });
    if (!ref) return ask('Qual reserva? Me diga o dia e o horário que eu confiro na agenda.');
    payload = { action, reservation_id: ref.id };
    if (action === 'reschedule') {
      if (!slots.date && !slots.start && !slots.court_label) return ask('Para quando você quer remarcar?');
      if (slots.date) payload.date = slots.date; else payload.date = String(ref.date);
      payload.start = slots.start ?? ref.start;
      if (slots.duration) payload.duration = slots.duration;
      if (slots.court_label) {
        candidates = pickCourts(courts, ref.type === 'Aula' ? 'Aula' : 'Play', slots.court_label);
        if (candidates.length === 0) return ask('Não encontrei essa quadra. Quer saibro ou rápida?');
      }
    }
  } else {
    const type = slots.type ?? 'Play';
    if (!slots.date || !slots.start) return ask(!slots.date ? 'Para qual dia?' : 'Que horas você quer começar?');
    const duration = slots.duration ?? (type === 'Aula' ? 30 : 60);
    candidates = pickCourts(courts, type, slots.court_label);
    if (candidates.length === 0) return ask(slots.court_label ? 'Não encontrei essa quadra. Quer saibro ou rápida?' : 'Não achei quadra ativa para esse tipo de reserva.');
    payload = { action: 'create', type, date: slots.date, start: slots.start, duration };
    const me = norm(String(profile.name));

    if (type === 'Play') {
      if (!slots.participants_known && (slots.participant_names ?? []).length === 0 && !slots.guest_name) return ask('Quem vai jogar com você? (Se for só você, é só dizer.)');
      const pedidos = (slots.participant_names ?? []).filter((n) => norm(n) !== me && norm(n) !== 'eu');
      const r = await resolve(db, pedidos, 'member');
      if (r.ask) return ask(r.ask);
      // "Carlos" na frase pode resolver para o próprio solicitante: ele já está na reserva, não entra de novo.
      const outros = r.matches.filter((m) => m.id !== String(profile.id ?? '') && norm(m.name) !== me);
      r.ids = outros.map((m) => m.id); r.names = outros.map((m) => m.name);
      payload.participant_ids = r.ids;
      payload.guest_name = slots.guest_name ?? null;
      names = [String(profile.name), ...r.names, ...(slots.guest_name ? [`${slots.guest_name} (convidado)`] : [])];
    } else {
      const student = await resolve(db, slots.student_names ?? [], 'student');
      if (!(slots.student_names ?? []).length) return ask('Quem são os alunos da aula?');
      if (student.ask) return ask(student.ask);
      payload.participant_ids = student.matches.filter((m) => m.kind === 'socio').map((m) => m.id);
      payload.non_socio_student_ids = student.matches.filter((m) => m.kind === 'non_socio').map((m) => m.id);
      if (profile.is_admin) {
        if (!slots.professor_name) return ask('Qual professor vai dar a aula?');
        const prof = await resolve(db, [slots.professor_name], 'professor');
        if (prof.ask) return ask(prof.ask);
        payload.professor_id = prof.ids[0];
      }
      names = student.names;
    }
  }

  // Tenta cada quadra candidata até uma validar (saibro 1, saibro 2…). SLOT_TAKEN passa para a próxima.
  let res: { ok: boolean; code?: string; message?: string; proposal_id?: string; action?: string; summary?: Summary } | null = null;
  const tentativas = action === 'cancel' || candidates.length === 0 ? [null] : candidates;
  for (const court of tentativas) {
    const p = court ? { ...payload, court_id: court.id } : payload;
    res = (await db('conv_svc_ai_propose', { p_session: session, p })).data as typeof res;
    if (res?.ok || (res?.code !== 'SLOT_TAKEN' && res?.code !== 'COURT_NOT_FOUND')) break;
  }

  if (res?.ok && res.summary) {
    memory.proposal_names = names;
    memory.pending_guest = null;
    return { bubbles: [proposalMessage(((res.action as 'create' | 'cancel' | 'reschedule' | undefined) ?? action), res.summary, today, names, String(profile?.name ?? '') || undefined)], awaiting: true, close: false, action: 'proposed', memory };
  }
  return failure(res?.code ?? 'UNKNOWN', res?.message, i, memory, null, { candidates, payload });
}

/**
 * Sair da reserva, retirar ou adicionar pessoas, convidado — pelo contexto da conversa e da agenda. O modelo só diz o QUE a pessoa quer
 * (reserva + nomes); o servidor acha a reserva, resolve cada nome entre quem está nela (ou no cadastro), valida pelas regras da Agenda
 * e mostra o resumo antes de gravar.
 */
export async function participantes(i: DecideInput, memory: Memory): Promise<Decision> {
  const { deps, ctx, answer, slots, session, today } = i;
  const { db } = deps;
  const profile = (ctx.requester?.profile ?? null) as Ctx | null;
  const ask = (text: string): Decision => ({ bubbles: [text], awaiting: true, close: false, action: 'ask', memory });
  if (!profile?.is_member) {
    return { bubbles: ['Não consegui identificar o seu cadastro de sócio por este telefone, então não posso mexer em reservas por aqui. Vou pedir para alguém da equipe te ajudar.'],
      awaiting: false, close: false, action: 'handoff', memory, handoff: { kind: 'soft', note: 'Pedido para mexer em atletas de reserva por telefone sem cadastro de sócio identificado.' } };
  }
  const me = String(profile.name);
  const { item, candidatas } = acharReserva(ctx, slots);
  if (!item) {
    if (candidatas.length === 0) return ask('Não achei essa reserva na agenda. Me diga o dia e o horário que eu confiro.');
    const lista = candidatas.slice(0, 4).map((a) => `${dayLabel(a.date, today)} ${a.start}–${a.end} na ${a.court}`);
    return ask(`Qual dessas reservas? ${lista.join(' · ')}`);
  }

  // Quem sai: "eu" (a própria pessoa) ou nomes entre os que estão na reserva.
  const removeIds: string[] = [];
  let tiraConvidado = slots.remove_guest === true || (slots.remove_names ?? []).some((n) => /^o?\s*convidad/.test(norm(n)));
  for (const nome of (slots.remove_names ?? []).filter((n) => !/^o?\s*convidad/.test(norm(n)))) {
    if (EU.has(norm(nome).trim()) || norm(nome) === norm(me)) { if (!removeIds.includes(String(profile.id))) removeIds.push(String(profile.id)); continue; }
    const r = acharNaReserva(item, nome);
    if (r.ask) return ask(r.ask);
    for (const id of r.ids) if (!removeIds.includes(id)) removeIds.push(id);
  }
  // Quem entra: nomes do cadastro de sócios ("eu" = a própria pessoa).
  const addIds: string[] = [];
  const quemEntra = (slots.add_names ?? []);
  if (quemEntra.some((n) => EU.has(norm(n).trim()) || norm(n) === norm(me)) && !item.people.some((p) => p.id === profile.id)) addIds.push(String(profile.id));
  const pedidos = quemEntra.filter((n) => !EU.has(norm(n).trim()) && norm(n) !== norm(me) && !item.people.some((p) => norm(p.name) === norm(n)));
  const r = await resolve(db, pedidos, 'member');
  if (r.ask) return ask(r.ask);
  for (const id of r.ids) if (!addIds.includes(id) && !item.people.some((p) => p.id === id)) addIds.push(id);
  const convidado = answer.slots.guest_name ? String(answer.slots.guest_name) : null;
  if (convidado && tiraConvidado && !item.guest) tiraConvidado = false;
  if (addIds.length + removeIds.length === 0 && !convidado && !tiraConvidado) return ask('O que você quer fazer nessa reserva: sair, retirar alguém ou adicionar alguém?');

  const res = (await db('conv_svc_ai_propose', { p_session: session, p: { action: 'participants', reservation_id: item.id,
    add_ids: addIds, remove_ids: removeIds, add_guest: convidado, remove_guest: tiraConvidado } })).data as
    { ok: boolean; code?: string; message?: string; summary?: Summary; spots_left?: number; wanted?: number } | null;
  if (res?.ok && res.summary) {
    return { bubbles: [participantsProposalMessage(res.summary, today, me)], awaiting: true, close: false, action: 'proposed_participants', memory };
  }
  if (res?.code === 'NOT_ENOUGH_SPOTS') {
    const vagas = Number(res.spots_left ?? 0);
    return ask(`Nessa reserva ${vagas === 0 ? 'não há mais vagas' : vagas === 1 ? 'só resta 1 vaga' : `só restam ${vagas} vagas`} e você quer adicionar ${res.wanted ?? 1}. Quer adicionar menos gente?`);
  }
  return failure(res?.code ?? 'UNKNOWN', res?.message, i, memory, null);
}

/**
 * A pessoa quer saber quem está num horário já reservado e/ou entrar nesse jogo. Quem responde é o servidor, com o que o banco
 * devolve: horário livre (nenhum jogo), jogo com vaga (oferta de entrar), lotado, aula, ou ela já está no jogo.
 */
async function entrarNoJogo(i: DecideInput, memory: Memory): Promise<Decision> {
  const { deps, ctx, slots, today } = i;
  const { db } = deps;
  const profile = (ctx.requester?.profile ?? null) as Ctx | null;
  const ask = (text: string): Decision => ({ bubbles: [text], awaiting: true, close: false, action: 'ask', memory });
  if (!profile?.is_member) {
    return { bubbles: ['Não consegui identificar o seu cadastro de sócio por este telefone, então não posso mexer em reservas por aqui. Vou pedir para alguém da equipe te ajudar.'],
      awaiting: false, close: false, action: 'handoff', memory, handoff: { kind: 'soft', note: 'Pedido para entrar em jogo por telefone sem cadastro de sócio identificado.' } };
  }
  if (!slots.date) return ask('De que dia é esse jogo?');
  if (!slots.start) return ask('Que horas é o jogo?');
  const courts = (ctx.courts ?? []) as Court[];
  const candidates = slots.court_label ? pickCourts(courts, 'Play', slots.court_label) : courts;
  if (candidates.length === 0) return ask('Não encontrei essa quadra. Quer saibro ou rápida?');
  const dur = slots.duration ?? 60;
  const me = norm(String(profile.name));
  const r = await resolve(db, (slots.participant_names ?? []).filter((n) => norm(n) !== me && norm(n) !== 'eu'), 'member');
  if (r.ask) return ask(r.ask);
  const payload: Record<string, unknown> = { type: 'Play', date: slots.date, start: slots.start, duration: dur, participant_ids: r.ids, guest_name: slots.guest_name ?? null };

  const ini = toMin(slots.start);
  let algum = false;
  for (const c of candidates) {
    const g = ((await db('conv_svc_ai_slot_games', { p_court: c.id, p_date: slots.date, p_start_min: ini, p_end_min: ini + dur, p_requester: profile.id })).data ?? []) as Game[];
    if (g.length) { algum = true; break; }
  }
  if (!algum) {
    const onde = candidates.length === 1 ? ` na ${candidates[0].name}` : '';
    return ask(`Não há nenhum jogo marcado ${dayLabel(slots.date, today)} às ${slots.start}${onde}: o horário está livre. Quer que eu faça a reserva?`);
  }
  // Há jogo: a mesma lógica do horário ocupado (oferta de entrar, ou quem está + horários livres).
  return failure('SLOT_TAKEN', undefined, i, memory, null, { candidates, payload });
}

/** Resolve nomes no cadastro. Ambíguo ou ausente vira PERGUNTA (nunca escolha por aproximação). */
