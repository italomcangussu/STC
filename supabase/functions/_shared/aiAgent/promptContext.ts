// Contexto do pedido no prompt: transcrição, solicitante, agenda e proposta em aberto.

import { brDateFull, moneyBR } from './promptAdmin.ts';
import type { Ctx } from './promptTypes.ts';

export const brDate = (iso: string) => iso.slice(0, 10).split('-').reverse().slice(0, 2).join('/');

/** Transcrição legível: quem falou (a pessoa, você/IA, equipe, automação). */
export function transcript(ctx: Ctx): string {
  const linhas = ((ctx.transcript ?? []) as Ctx[]).map((t) => {
    const quem = t.direction === 'inbound' ? 'Pessoa' : t.origin === 'ai' ? 'Você (IA)' : t.origin === 'automation' ? 'Clube (automação)' : 'Você (IA, enviado manualmente pela equipe em seu nome)';
    const corpo = t.body || (t.kind && t.kind !== 'text' ? `[${t.kind}]` : '');
    return `${quem}: ${corpo}`;
  });
  return linhas.length ? linhas.join('\n') : '(primeira mensagem)';
}

export function requesterText(ctx: Ctx): string {
  const r = (ctx.requester ?? {}) as Ctx;
  const p = r.profile as Ctx | null;
  if (!p) return 'Cadastro NÃO identificado por este telefone (não dá para fazer reserva; se pedir, explique e transfira em "soft").';
  const acting = actingFor(ctx);
  if (acting) return delegateText(acting, p);
  return [`Nome: ${p.name}`, ...(r.title ? [`Cargo no clube: ${r.title} (chame por ele de vez em quando, sem exagero; o apelido "Vice" para vice-presidente é natural)`] : []), `Sócio ativo: ${p.is_member ? 'sim' : 'não'}`, `Administrador: ${p.is_admin ? 'sim' : 'não'}`,
    `Professor: ${p.professor_id ? 'sim' : 'não'}`].join('\n');
}

/** Assessor de professor: o contato fala em nome do professor (cadastrado pela diretoria em `conv_contact_delegates`). */
export function actingFor(ctx: Ctx): Ctx | null {
  const a = ((ctx.requester ?? {}) as Ctx).acting_for as Ctx | null | undefined;
  return a && a.kind === 'professor_assistant' ? a : null;
}

function delegateText(acting: Ctx, p: Ctx): string {
  return [`Quem escreve é o ASSESSOR do professor ${acting.principal_name} (outro assistente, autorizado pela diretoria a falar em nome dele).`,
    `Trate cada pedido como se fosse do próprio professor ${p.name}: marcar, remarcar e cancelar aula dele e o Play dele, consultar a agenda e a situação dos alunos DELE (validade/vencimento do card, pagamento).`,
    'Não é administrador: financeiro do clube, pendências de sócios e ações de diretoria ficam fora.',
    'O assessor costuma ser um robô: responda objetivo, sem resenha nem emoji, e só confirme o que o sistema confirmou.',
    `Nome (em nome de quem fala): ${p.name}`, `Sócio ativo: ${p.is_member ? 'sim' : 'não'}`, 'Administrador: não', 'Professor: sim'].join('\n');
}

export function courtsText(ctx: Ctx): string {
  return ((ctx.courts ?? []) as Ctx[]).map((c) => `- ${c.name} (${c.type})`).join('\n') || '(nenhuma quadra ativa)';
}

export function reservationsText(ctx: Ctx): string {
  const lista = (ctx.my_reservations ?? []) as Ctx[];
  if (lista.length === 0) return 'nenhuma reserva futura';
  return lista.map((r) => `- id=${r.id} | ${r.type} | ${brDate(r.date)} ${r.start}–${r.end} | ${r.court}${r.is_creator ? '' : ' (você é participante, não criou)'}`).join('\n');
}

/** A agenda dos próximos dias, uma linha por reserva: ref, tipo, quando, onde, quem está, vagas e o que a pessoa pode fazer. */
export function agendaText(ctx: Ctx): string {
  const lista = (ctx.agenda ?? []) as Ctx[];
  if (lista.length === 0) return '(nenhuma reserva nos próximos dias)';
  return lista.map((a) => {
    const quem = a.type === 'Play'
      ? `jogam: ${[...((a.people ?? []) as Ctx[]).map((p) => p.name), ...(a.guest ? [`${a.guest} (convidado)`] : [])].join(', ') || '(ninguém)'} | ${a.spots_left} vagas`
      : a.type === 'Aula' ? 'aula' : 'campeonato';
    const c = (a.can ?? {}) as Ctx;
    const pode = [c.leave && 'sair', c.people && 'mexer nos atletas', c.edit && 'remarcar', c.cancel && 'cancelar'].filter(Boolean).join(', ') || 'nada';
    return `${a.ref} | ${brDate(String(a.date))} ${a.start}–${a.end} | ${a.court ?? ''} | ${quem} | ${a.mine ? 'a pessoa ESTÁ nela' : 'a pessoa não está'} | pode: ${pode}`;
  }).join('\n');
}

export function proposalText(ctx: Ctx): string {
  const p = ctx.open_proposal as Ctx | null;
  if (!p) return 'nenhuma';
  const n = p.payload as Ctx;
  if (p.action === 'participants') {
    const tira = ((n.remove_names ?? []) as string[]).join(', ');
    const poe = [...((n.add_names ?? []) as string[]), ...(n.add_guest ? [`${n.add_guest} (convidado)`] : [])].join(', ');
    return `mexer nos atletas da reserva de ${brDate(String(n.date))} ${n.start}–${n.end} ${n.court_name ?? ''}${tira ? `: retirar ${tira}` : ''}${poe ? `; adicionar ${poe}` : ''}${n.cancel_all ? ' (cancela a reserva inteira)' : ''}`.trim();
  }
  if (p.action === 'join') {
    const quem = ((n.names ?? []) as string[]).join(', ');
    const levando = ((n.add_names ?? []) as string[]).join(', ');
    return `entrar no jogo de ${brDate(String(n.date))} ${n.start}–${n.end} ${n.court_name ?? ''}${quem ? ` (jogam: ${quem})` : ''}${levando ? `, levando: ${levando}` : ''}`.trim();
  }
  if (p.action === 'student_card_renew') return `renovar o Card Mensal de ${n.student_name ?? 'aluno'} (${moneyBR(Number(n.amount_cents ?? 0) / 100)}, nova validade ${brDateFull(n.new_valid_until)})`;
  if (String(p.action ?? '').startsWith('fin_')) return 'um lançamento financeiro do administrador (aguardando o aceite do administrador)';
  const acao = p.action === 'cancel' ? 'cancelar' : p.action === 'reschedule' ? 'remarcar para' : 'reservar';
  return `${acao}: ${n.type ?? ''} ${brDate(String(n.date))} ${n.start}${n.end ? `–${n.end}` : ''} ${n.court_name ?? ''}`.trim();
}
