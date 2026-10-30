// Contexto social no prompt: ranking, grupo, memória aprovada, resultados, falas recentes e tênis profissional.

import { fold, isAdminAssistant } from './promptAdmin.ts';
import { brDate, transcript } from './promptContext.ts';
import { DIAS } from './promptSystem.ts';
import type { Ctx } from './promptTypes.ts';

export function rankingText(ctx: Ctx, buffered = ''): string {
  const lista = (ctx.club_roster ?? []) as Ctx[];
  if (!lista.length) return '(ranking não disponível agora)';

  const contexto = fold([
    buffered,
    ...((ctx.transcript ?? []) as Ctx[]).map((x) => String(x.body ?? '')),
    ...((ctx.group_context ?? []) as Ctx[]).flatMap((x) => [String(x.sender ?? ''), String(x.body ?? '')]),
  ].join(' '));
  const pediuRanking = /\b(ranking|rank|classe|classificacao|posição|posicao|pontos|lider|líder|top|desafio)\b/.test(contexto);
  const presentes = new Set(((ctx.group_members ?? []) as string[]).map((x) => fold(String(x))));
  const solicitante = fold(String(((ctx.requester ?? {}) as Ctx).profile?.name ?? ''));

  const relevantes = pediuRanking ? lista : lista.filter((r) => {
    const nome = fold(String(r.name ?? ''));
    if (nome && (nome === solicitante || presentes.has(nome) || contexto.includes(nome))) return true;
    return ((r.aliases ?? []) as string[]).some((a) => {
      const alias = fold(String(a));
      return alias.length >= 3 && contexto.includes(alias);
    });
  });
  if (!relevantes.length) return '(ranking não necessário para este turno)';
  return relevantes.map((r) =>
    `${r.global_position}G/${r.category_position}C ${r.name} | ${r.category} | ${r.points} pts${r.is_professor ? ' | professor' : ''}`
  ).join('\n');
}

export function groupMembersText(ctx: Ctx): string {
  const nomes = [...new Set(((ctx.group_members ?? []) as string[]).map((x) => String(x).trim()).filter(Boolean))];
  return nomes.length ? nomes.join(', ') : '(não consegui confirmar a lista completa de participantes)';
}

export function groupContextText(ctx: Ctx): string {
  const msgs = (ctx.group_context ?? []) as Ctx[];
  if (!ctx.is_group || !msgs.length) return '(sem papo recente adicional)';
  return msgs.map((m) => `${m.sender}: ${m.body}`).join('\n');
}

export function socialContextText(ctx: Ctx, buffered = ''): string {
  const lista = (ctx.club_roster ?? []) as Ctx[];
  if (!lista.length) return '(nenhum contexto social adicional)';
  const presentes = new Set(((ctx.group_members ?? []) as string[]).map((x) => fold(String(x))));
  const solicitante = fold(String(((ctx.requester ?? {}) as Ctx).profile?.name ?? ''));
  const conversa = fold([
    buffered,
    ...((ctx.transcript ?? []) as Ctx[]).map((x) => String(x.body ?? '')),
    ...((ctx.group_context ?? []) as Ctx[]).flatMap((x) => [String(x.sender ?? ''), String(x.body ?? '')]),
  ].join(' '));

  const relevantes = lista.filter((r) => {
    if (!r.social_context) return false;
    const nome = fold(String(r.name ?? ''));
    const aliases = ((r.aliases ?? []) as string[]).map((x) => fold(String(x)));
    if (nome && (presentes.has(nome) || nome === solicitante)) return true;
    // No grupo do campeonato, nome citado no papo é da turma do circuito, não o sócio do STC com o mesmo nome.
    if (ctx.group_championship) return false;
    if (nome && conversa.includes(nome)) return true;
    return aliases.some((a) => a.length >= 3 && conversa.includes(a));
  });
  return relevantes.length
    ? relevantes.map((r) => `- ${r.name}: ${r.social_context}`).join('\n')
    : '(nenhum contexto social adicional relevante para este turno)';
}

/** Saudação e clima do horário, para o João cumprimentar certo ("bom dia" só de manhã). `nowLocal` = YYYY-MM-DDTHH:MM em Fortaleza. */
export function momentoDoDia(nowLocal: unknown, weekday: unknown): string {
  const hora = /^\d{4}-\d{2}-\d{2}T(\d{2}):\d{2}/.exec(String(nowLocal ?? ''));
  const h = hora ? Number(hora[1]) : NaN;
  const dow = Number(weekday);
  if (!Number.isFinite(h) || h > 23) return '(não identificado)';
  const periodo = h < 5 ? 'madrugada' : h < 12 ? 'manhã' : h < 18 ? 'tarde' : 'noite';
  const saudacao = h < 5 ? 'sem saudação fixa, é madrugada' : h < 12 ? '"bom dia"' : h < 18 ? '"boa tarde"' : '"boa noite"';
  return `${periodo} (${String(h).padStart(2, '0')}h), saudação natural: ${saudacao}; ${DIAS[dow] ?? ''}, ${dow === 0 || dow === 6 ? 'fim de semana' : 'dia útil'}`;
}

const MEMORY_KIND: Record<string, string> = {
  confirmed_fact: 'fato confirmado', recurring_preference: 'preferência', social_relation: 'relação',
  inside_joke: 'brincadeira interna, NÃO é fato literal',
};

const PALAVRAS_COMUNS = new Set(['sempre', 'ninguem', 'alguma', 'origem', 'brincar', 'brinca', 'direito', 'quando', 'porque', 'depois', 'sobre', 'clube']);

/** Memórias aprovadas pela diretoria sobre quem está na conversa (quem foi citado primeiro, depois o solicitante, depois os presentes). */
export function memoryText(ctx: Ctx, buffered = ''): string {
  const lista = (ctx.joao_memories ?? []) as Ctx[];
  if (!lista.length) return '(nenhuma memória aprovada ainda)';
  // Com a diretoria no privado, o João enxerga a turma toda (é dali que saem as resenhas que ele propõe).
  const todas = !ctx.is_group && isAdminAssistant(ctx);
  const presentes = new Set(((ctx.group_members ?? []) as string[]).map((x) => fold(String(x))));
  const solicitante = fold(String(((ctx.requester ?? {}) as Ctx).profile?.name ?? ''));
  const conversa = fold([
    buffered,
    ...((ctx.transcript ?? []) as Ctx[]).map((x) => String(x.body ?? '')),
    ...((ctx.group_context ?? []) as Ctx[]).flatMap((x) => [String(x.sender ?? ''), String(x.body ?? '')]),
  ].join(' '));
  const apelidos = new Map(((ctx.club_roster ?? []) as Ctx[]).map((r) => [fold(String(r.name ?? '')), ((r.aliases ?? []) as string[]).map((a) => fold(String(a)))] as const));
  const citado = (nome: string) => {
    if (conversa.includes(nome)) return true;
    const primeiro = nome.split(/\s+/)[0] ?? '';
    if (primeiro.length >= 4 && conversa.includes(primeiro)) return true;
    return (apelidos.get(nome) ?? []).some((a) => a.length >= 3 && conversa.includes(a));
  };
  // "Quem é o dermatologista?" acha o Jorge pelo assunto da memória, sem ninguém citar o nome dele.
  const assuntoCitado = (conteudo: string) => fold(conteudo).split(/[^a-z]+/)
    .some((w) => w.length >= 6 && !PALAVRAS_COMUNS.has(w) && conversa.includes(w));
  const pontos = (m: Ctx) => {
    const nome = fold(String(m.subject_name ?? '').trim());
    if (!nome) return 0;
    if (citado(nome)) return 3;
    if (nome === solicitante) return 2;
    if (assuntoCitado(String(m.content ?? ''))) return 1.5;
    if (presentes.has(nome)) return 1;
    return todas ? 0.5 : 0;
  };
  const escolhidas = lista.map((m) => ({ m, p: pontos(m) })).filter((x) => x.p > 0).sort((a, b) => b.p - a.p).slice(0, todas ? 40 : 8);
  return escolhidas.length
    ? escolhidas.map(({ m }) => `- ${m.subject_name} (${MEMORY_KIND[String(m.kind)] ?? 'nota'}): ${m.content}`).join('\n')
    : '(nenhuma memória aprovada relevante para este turno)';
}

/** Partidas encerradas recentes (campeonato/desafio). Só para sócio identificado ou para o grupo. */
export function resultsText(ctx: Ctx): string {
  const identificado = Boolean(((ctx.requester ?? {}) as Ctx).profile);
  if (!ctx.is_group && !identificado) return '(não disponível nesta conversa)';
  const lista = (ctx.joao_results ?? []) as Ctx[];
  if (!lista.length) return '(nenhum resultado recente cadastrado)';
  return lista.map((r) => {
    const onde = [r.championship, r.phase].filter(Boolean).join(', ');
    const final = r.walkover ? ' por W.O.' : r.score ? ` ${r.score}` : '';
    return `- ${brDate(String(r.played_on))}: ${r.winner} venceu ${r.loser}${final}${onde ? ` (${onde})` : ''}`;
  }).join('\n');
}

/** As últimas falas do João, para ele não repetir piada, abertura nem bordão. */
export function ownLinesText(ctx: Ctx): string {
  const falas = ((ctx.joao_own_lines ?? []) as unknown[]).map((x) => String(x ?? '').trim()).filter(Boolean).slice(-10);
  return falas.length ? falas.map((f) => `- ${f}`).join('\n') : '(nenhuma fala recente)';
}

export function proTennisText(ctx: Ctx): string {
  const t = (ctx.pro_tennis ?? null) as Ctx | null;
  if (!t) return '(não consultado neste turno — o assunto atual não pediu dados do circuito profissional)';
  if (t.unavailable) return '(fontes esportivas temporariamente indisponíveis; não invente nenhum dado)';
  const matches = (t.matches ?? []) as Ctx[];
  if (!matches.length) return `Fonte: ${t.source ?? 'ESPN'} | consulta: ${t.checked_at ?? 'agora'} | data local: ${t.date ?? ''} | nenhuma partida encontrada para a data.`;
  const lines = matches.map((m) => {
    const players = ((m.players ?? []) as Ctx[]).map((p) => {
      const score = Array.isArray(p.score) && p.score.length ? ` [${p.score.join('-')}]` : '';
      return `${p.name}${score}`;
    }).join(' x ');
    const transmission = Array.isArray(m.broadcasts) && m.broadcasts.length ? m.broadcasts.join(', ') : 'não informada pela fonte';
    const region = Array.isArray(m.broadcast_regions) && m.broadcast_regions.length ? ` | região transmissão: ${m.broadcast_regions.join(', ')}` : '';
    const transmissionSource = m.broadcast_source ? ` | fonte transmissão: ${m.broadcast_source}` : '';
    return `- ${m.tour} | ${m.tournament} | ${m.round ?? m.category ?? ''} | ${m.local_date} ${m.local_time} (America/Fortaleza) | ${m.status ?? m.state ?? ''} | ${players} | local: ${m.venue ?? 'não informado'}${m.court ? ' / ' + m.court : ''} | transmissão: ${transmission}${region}${transmissionSource}`;
  });
  return `Fonte atual: ${t.source ?? 'ESPN'} | consultado em ${t.checked_at ?? 'agora'}\n${lines.join('\n')}`;
}
