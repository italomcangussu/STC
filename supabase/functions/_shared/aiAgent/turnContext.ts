// Contexto do turno: o que o João precisa saber além da conversa (cargo, quadro do clube, financeiro, leituras do
// assessor, grupo, memórias aprovadas, menções viradas em nome, áudio transcrito) e o que a pessoa acabou de mandar.
// Cada parte é opcional: falhou ou não existe no banco → segue sem ela, o turno nunca para por isso.

import { ADMIN_READS } from './capabilities.ts';
import { isAdminAssistant } from './promptAdmin.ts';
import type { Ctx } from './promptTypes.ts';
import { hearAudios } from './audio.ts';
import { conciliarMencoes, membrosAtuaisDoGrupo, substituirMencoes } from './mentions.ts';
import { scrubGroupContext } from './groupChampionship.ts';
import type { Db, TurnDeps } from './turnTypes.ts';

type Where = { session: string; conversation: string; isGroup: boolean };

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asObject = (v: unknown) => (v && typeof v === 'object' ? v as Ctx : null);
const EMPTY_FINANCE = () => ({ students: [], day_cards: [], member_pendencies: [] });

/** Leitura opcional: falhou ou a função ainda não existe no banco → `fallback`, e o turno segue. */
async function read<T>(db: Db, rpc: string, args: Record<string, unknown>, pick: (data: unknown) => T, fallback: T): Promise<T> {
  try { return pick((await db(rpc, args)).data); } catch { return fallback; }
}

/** Cargo da pessoa que fala com o João (memória aprovada): ele passa a tratá-la por ele. */
async function requesterTitle(ctx: Ctx, db: Db, session: string): Promise<void> {
  const title = await read(db, 'conv_svc_ai_requester_title', { p_session: session }, (d) => (typeof d === 'string' && d ? d : null), null);
  if (title && ctx.requester && typeof ctx.requester === 'object') (ctx.requester as Ctx).title = title;
}

/** Leituras do assessor (registro de capacidades): só para o administrador no privado. */
async function adminReads(ctx: Ctx, db: Db): Promise<void> {
  if (!isAdminAssistant(ctx)) return;
  for (const cap of ADMIN_READS) ctx[cap.read!.ctxKey] = await read(db, cap.read!.rpc, {}, asObject, null);
}

/** Papo recente do grupo e quem está nele (o solicitante sempre conta). */
async function groupContext(ctx: Ctx, deps: TurnDeps, { session, conversation }: Where): Promise<void> {
  ctx.group_context = await read(deps.db, 'conv_svc_ai_group_context', { p_session: session }, asArray, []);
  const membros = await membrosAtuaisDoGrupo(deps, conversation);
  const requesterName = String((ctx.requester?.profile as Ctx | undefined)?.name ?? '').trim();
  if (requesterName && !membros.includes(requesterName)) membros.push(requesterName);
  ctx.group_members = membros;
  // Grupo ligado a um campeonato: a turma vem da lista de inscritos (sócio × convidado).
  ctx.group_championship = await read(deps.db, 'conv_svc_ai_group_championship', { p_session: session }, asObject, null);
}

/** Pacote do João (um RPC): memórias APROVADAS pela diretoria, resultados recentes e as últimas falas dele. */
async function joaoPack(ctx: Ctx, db: Db, session: string): Promise<void> {
  const pack = await read(db, 'conv_svc_ai_joao_pack', { p_session: session }, asObject, null);
  ctx.joao_memories = asArray(pack?.memories);
  ctx.joao_results = asArray(pack?.results);
  ctx.joao_own_lines = asArray(pack?.own_lines);
}

/** "@61809058967781" vira nome ANTES de o modelo ler tanto a solicitação quanto o papo recente do grupo. */
async function resolveMentions(ctx: Ctx, deps: TurnDeps, { conversation, isGroup }: Where): Promise<void> {
  const bodies = (k: 'transcript' | 'group_context') => ((ctx[k] ?? []) as Ctx[]).map((t) => String(t.body ?? ''));
  const mencoes = await conciliarMencoes(deps, conversation, isGroup, [...bodies('transcript'), ...bodies('group_context')]);
  if (!mencoes.size) return;
  const conta = String(ctx.institutional_name ?? 'STC');
  const trocar = (k: 'transcript' | 'group_context') => ((ctx[k] ?? []) as Ctx[]).map((t) => ({ ...t, body: substituirMencoes(String(t.body ?? ''), mencoes, conta) }));
  ctx.transcript = trocar('transcript');
  if (isGroup) ctx.group_context = trocar('group_context');
}

/**
 * Completa o contexto que veio de conv_svc_ai_context (muda `ctx` no lugar, como o turno sempre fez).
 * Contexto extra continua barato: SQL compacto + uma única chamada ao modelo por turno. O financeiro vem via service
 * role: no privado o prompt filtra para o próprio solicitante; no grupo fechado aplica as permissões da casa.
 */
export async function loadTurnContext(ctx: Ctx, deps: TurnDeps, where: Where): Promise<void> {
  const { db } = deps;
  await requesterTitle(ctx, db, where.session);
  ctx.club_roster = await read(db, 'conv_svc_ai_club_roster', {}, asArray, []);
  ctx.financial_context = await read(db, 'conv_svc_ai_financial_context', {}, (d) => asObject(d) ?? EMPTY_FINANCE(), EMPTY_FINANCE());
  await adminReads(ctx, db);
  if (where.isGroup) await groupContext(ctx, deps, where);
  await joaoPack(ctx, db, where.session);
  // Campeonato com inscrição pelo João: informações, vagas e as inscrições de quem fala (tudo, para o administrador).
  ctx.championship = await read(db, 'conv_svc_ai_championship_context', { p_session: where.session }, asObject, null);
  // No grupo, só o que é de todos: sem dados de administrador do campeonato, sem telefone e, no do campeonato, sem financeiro.
  scrubGroupContext(ctx);
  await resolveMentions(ctx, deps, where);
  // Áudio: o João lê o que foi dito (transcrição do webhook), esperando um pouco pelo que ainda está chegando.
  ctx.transcript = await hearAudios((ctx.transcript ?? []) as Ctx[], deps);
}

/** O que a pessoa mandou desde a última fala do João: o texto junto, se foi só mídia e qual a última mensagem. */
export function pendingInbound(ctx: Ctx) {
  const trail = ((ctx.transcript ?? []) as Ctx[]).slice().reverse();
  const ultimaDaIa = trail.findIndex((t) => t.direction === 'outbound');
  const pendentes = (ultimaDaIa < 0 ? trail : trail.slice(0, ultimaDaIa)).filter((t) => t.direction === 'inbound').reverse();
  const buffered = pendentes.map((t) => t.body || (t.kind !== 'text' ? `[${t.kind}]` : '')).filter(Boolean).join('\n');
  const soMidia = pendentes.length > 0 && pendentes.every((t) => t.kind && t.kind !== 'text' && !t.body);
  const ultima = pendentes[pendentes.length - 1] as Ctx | undefined;
  return { pendentes, buffered, soMidia, ultima };
}
