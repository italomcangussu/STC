// Memórias que o modelo sugere no turno: curadoria, aprovação do administrador e o "Anotei" do servidor.

import { isAdminAssistant } from './promptAdmin.ts';
import type { Ctx } from './promptTypes.ts';
import type { Turn } from './turnKit.ts';
import { resolve } from './turnOutcome.ts';
import type { Answer } from './turnTypes.ts';

type MemoryCandidate = NonNullable<Answer['memory_candidates']>[number];

const memoryLine = (c: MemoryCandidate) => c.kind === 'role_title'
  ? `${c.subject_name} é ${c.content.replace(/^(o|a)\s+/i, '')}` : `${c.subject_name}: ${c.content.replace(/[.\s]+$/, '')}`;

/**
 * A memória só entra aprovada sobre quem está no cadastro, com o nome do cadastro: "Hermerson" (erro de digitação)
 * não pode virar uma pessoa nova na memória. Sem cadastro único, volta null e a sugestão fica para a curadoria.
 */
async function withRegisteredName(t: Turn, c: MemoryCandidate): Promise<MemoryCandidate | null> {
  const r = await resolve(t.deps.db, [c.subject_name], 'member').catch(() => null);
  return r && !r.ask && r.names.length === 1 ? { ...c, subject_name: r.names[0] } : null;
}

/** Grava uma sugestão; devolve o texto do "Anotei" só se entrou aprovada e ainda não foi dita nesta conversa. */
async function noteOne(t: Turn, sugerida: MemoryCandidate, jaDito: string): Promise<string | null> {
  const candidate = await withRegisteredName(t, sugerida);
  const aprova = candidate !== null && candidate.kind !== 'inside_joke' && !t.isGroup && isAdminAssistant(t.ctx);
  const p = { ...(candidate ?? sugerida), source_message_id: t.messageId, approve: aprova };
  const r = await Promise.resolve(t.deps.db('conv_svc_ai_memory_candidate', { p })).catch(() => null);
  if (!aprova || !r?.data) return null;
  const texto = memoryLine(candidate);
  return jaDito.includes(`Anotei: ${texto}`) ? null : texto;
}

/**
 * Memórias sugeridas pelo modelo vão para a curadoria. Cargo ou fato informado por um administrador no privado
 * já entra aprovado; o servidor confirma ("Anotei"), o modelo não. Devolve o que foi anotado.
 */
export async function noteMemories(t: Turn, answer: Answer): Promise<string[]> {
  const jaDito = ((t.ctx.transcript ?? []) as Ctx[]).map((m) => String(m.body ?? '')).join('\n');
  const anotados: string[] = [];
  for (const sugerida of answer.memory_candidates ?? []) {
    const texto = await noteOne(t, sugerida, jaDito);
    if (texto) anotados.push(texto);
  }
  if (t.isGroup && answer.ask_curator) {
    await Promise.resolve(t.deps.db('conv_svc_ai_curator_ask', { p_session: t.session, p: answer.ask_curator })).catch(() => null);
  }
  return anotados;
}
