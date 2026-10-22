// Contexto do turno: o que o João precisa saber além da conversa (cargo, quadro do clube, financeiro, leituras do
// assessor, grupo, memórias aprovadas, menções viradas em nome, áudio transcrito) e o que a pessoa acabou de mandar.
// Cada parte é opcional: falhou ou não existe no banco → segue sem ela, o turno nunca para por isso.

import { ADMIN_READS } from './capabilities.ts';
import { isAdminAssistant } from './promptAdmin.ts';
import type { Ctx } from './promptTypes.ts';
import { hearAudios } from './audio.ts';
import { conciliarMencoes, membrosAtuaisDoGrupo, substituirMencoes } from './mentions.ts';
import type { TurnDeps } from './turnTypes.ts';

type Where = { session: string; conversation: string; isGroup: boolean };

/** Completa o contexto que veio de conv_svc_ai_context (muda `ctx` no lugar, como o turno sempre fez). */
export async function loadTurnContext(ctx: Ctx, deps: TurnDeps, { session, conversation, isGroup }: Where): Promise<void> {
  const { db } = deps;
  // Cargo da pessoa que fala com o João (memória aprovada): ele passa a tratá-la por ele.
  try {
    const t = await db('conv_svc_ai_requester_title', { p_session: session });
    if (typeof t.data === 'string' && t.data && ctx.requester && typeof ctx.requester === 'object') (ctx.requester as Ctx).title = t.data;
  } catch { /* sem cargo: segue normalmente */ }

  // Contexto extra continua barato: SQL compacto + uma única chamada ao modelo por turno.
  try {
    const roster = await db('conv_svc_ai_club_roster', {});
    ctx.club_roster = Array.isArray(roster.data) ? roster.data : [];
  } catch { ctx.club_roster = []; }
  // Financeiro é carregado via service role. No privado o prompt filtra rigorosamente
  // para o próprio solicitante; no grupo fechado aplica as permissões da casa.
  try {
    const fin = await db('conv_svc_ai_financial_context', {});
    ctx.financial_context = fin.data && typeof fin.data === 'object'
      ? fin.data
      : { students: [], day_cards: [], member_pendencies: [] };
  } catch {
    ctx.financial_context = { students: [], day_cards: [], member_pendencies: [] };
  }
  // Leituras do assessor (registro de capacidades): só para o administrador no privado.
  if (isAdminAssistant(ctx)) {
    for (const cap of ADMIN_READS) {
      try {
        const r = await db(cap.read!.rpc, {});
        ctx[cap.read!.ctxKey] = r.data && typeof r.data === 'object' ? r.data : null;
      } catch { ctx[cap.read!.ctxKey] = null; }
    }
  }

  if (isGroup) {
    try {
      const gc = await db('conv_svc_ai_group_context', { p_session: session });
      ctx.group_context = Array.isArray(gc.data) ? gc.data : [];
    } catch { ctx.group_context = []; }
    const membros = await membrosAtuaisDoGrupo(deps, conversation);
    const requesterName = String((ctx.requester?.profile as Ctx | undefined)?.name ?? '').trim();
    if (requesterName && !membros.includes(requesterName)) membros.push(requesterName);
    ctx.group_members = membros;
  }

  // Pacote do João (um RPC): memórias APROVADAS pela diretoria, resultados recentes e as últimas falas dele.
  // Falhou ou a função ainda não existe no banco → o João segue sem esse contexto, nunca para.
  ctx.joao_memories = []; ctx.joao_results = []; ctx.joao_own_lines = [];
  try {
    const pack = (await db('conv_svc_ai_joao_pack', { p_session: session })).data as Ctx | null;
    if (pack && typeof pack === 'object') {
      ctx.joao_memories = Array.isArray(pack.memories) ? pack.memories : [];
      ctx.joao_results = Array.isArray(pack.results) ? pack.results : [];
      ctx.joao_own_lines = Array.isArray(pack.own_lines) ? pack.own_lines : [];
    }
  } catch { /* contexto extra é opcional */ }

  // "@61809058967781" vira nome ANTES de o modelo ler tanto a solicitação quanto o papo recente do grupo.
  const textosComMencoes = [
    ...((ctx.transcript ?? []) as Ctx[]).map((t) => String(t.body ?? '')),
    ...((ctx.group_context ?? []) as Ctx[]).map((t) => String(t.body ?? '')),
  ];
  const mencoes = await conciliarMencoes(deps, conversation, isGroup, textosComMencoes);
  if (mencoes.size) {
    const conta = String(ctx.institutional_name ?? 'STC');
    ctx.transcript = ((ctx.transcript ?? []) as Ctx[]).map((t) => ({ ...t, body: substituirMencoes(String(t.body ?? ''), mencoes, conta) }));
    if (isGroup) ctx.group_context = ((ctx.group_context ?? []) as Ctx[]).map((t) => ({ ...t, body: substituirMencoes(String(t.body ?? ''), mencoes, conta) }));
  }
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
