// Lista de inscritos do administrador (Hermeson, 30/10): nome, camisa e situação de cada atleta, montada pelo SERVIDOR
// a partir do banco. O modelo só reconhece o pedido; reescrever 30+ nomes de memória cortava gente e trocava tamanhos.

import { championshipTitle, championships } from './championshipPrompt.ts';
import type { Ctx } from './promptTypes.ts';
import type { ListFilter } from './turnTypes.ts';

type Situacao = 'pago' | 'isento' | 'pendente' | 'espera';
type Linha = { class: string; name: string; size: string | null; situacao: Situacao };

const ICONE: Record<Situacao, string> = { pago: '✅', isento: '🎟️', pendente: '⏳', espera: '🕓' };
const ORDEM: Situacao[] = ['pago', 'isento', 'pendente', 'espera'];
const LEGENDA: Record<Situacao, string> = { pago: 'pago', isento: 'isento', pendente: 'aguardando Pix', espera: 'lista de espera' };
const PAY: Record<string, Situacao> = { paid: 'pago', exempt: 'isento', panel: 'pendente' };

/** "5", "5ª", "5ª Classe" → a mesma classe (o modelo escreve como o administrador falou). */
const classKey = (c: unknown) => String(c ?? '').match(/\d+/)?.[0] ?? String(c ?? '').toLowerCase();
const byName = (a: Linha, b: Linha) => a.name.localeCompare(b.name, 'pt-BR');

/** Painel (quem já está na chave) + WhatsApp que ainda não chegou ao painel (pré-inscrito e lista de espera). */
function linhas(admin: Ctx): Linha[] {
  const painel = ((admin.registered ?? []) as Ctx[]).map((r): Linha => ({
    class: String(r.class), name: String(r.name), size: (r.shirt_size as string | null) ?? null, situacao: PAY[String(r.pay ?? 'paid')] ?? 'pago' }));
  const fila = ((admin.signups ?? []) as Ctx[]).filter((s) => s.status === 'pre' || s.status === 'waitlist').map((s): Linha => ({
    class: String(s.class), name: String(s.full_name), size: (s.shirt_size as string | null) ?? null, situacao: s.status === 'waitlist' ? 'espera' : 'pendente' }));
  return [...painel, ...fila];
}

const linha = (l: Linha) => `${ICONE[l.situacao]} ${l.name} — ${l.size ?? 'sem tamanho'}`;

function blocoClasse(classe: string, itens: Linha[]): string {
  const ordenados = ORDEM.flatMap((s) => itens.filter((l) => l.situacao === s).sort(byName));
  const naChave = itens.filter((l) => l.situacao !== 'espera').length;
  return `🏅 *${classe}* (${naChave})\n${ordenados.map(linha).join('\n')}`;
}

/** Quantas camisas pedir: todos os tamanhos do campeonato, mesmo os zerados; lista de espera fica fora. */
function totalCamisas(itens: Linha[], tamanhos: string[]): string {
  const conta = itens.filter((l) => l.situacao !== 'espera');
  const partes = tamanhos.map((t) => `${t} ${conta.filter((l) => l.size === t).length}`);
  const sem = conta.filter((l) => !l.size || !tamanhos.includes(l.size)).length;
  return `👕 *Camisas:* ${partes.join(' · ')}${sem ? ` (e ${sem} sem tamanho)` : ''}`;
}

/** O texto da lista, ou null quando não há dados de administrador (quem pede não é administrador). */
export function inscritosMessage(c: Ctx, filtro: ListFilter | null | undefined, classe: string | null | undefined): string | null {
  const admin = c.admin as Ctx | null | undefined;
  if (!admin) return null;
  const pendentes = filtro === 'pendentes';
  const todas = linhas(admin).filter((l) => (!classe || classKey(l.class) === classKey(classe)) && (!pendentes || l.situacao === 'pendente'));
  const classes = [...new Set(todas.map((l) => l.class))].sort();
  const [primeira, ...resto] = championshipTitle(c);
  const cabecalho = [`🎾 *${primeira}*`, ...resto.map((l) => `🏆 ${l}`), pendentes ? '📋 Inscritos aguardando o Pix' : '📋 Inscritos e camisas'].join('\n');
  if (!todas.length) return `${cabecalho}\n\n${pendentes ? 'Ninguém aguardando o Pix. Todo mundo pagou ✅' : 'Ainda não há inscritos.'}`;
  const corpo = classes.map((k) => blocoClasse(k, todas.filter((l) => l.class === k))).join('\n\n');
  const legenda = ORDEM.filter((s) => todas.some((l) => l.situacao === s)).map((s) => `${ICONE[s]} ${LEGENDA[s]}`).join(' · ');
  const rodape = pendentes ? legenda : `${totalCamisas(todas, (c.shirt_sizes ?? []) as string[])}\n\n${legenda}`;
  return `${cabecalho}\n\n${corpo}\n\n${rodape}`;
}

/** Campeonato da lista: o único aberto ou o primeiro com dados do administrador. */
export const listChampionship = (ctx: Ctx): Ctx | undefined => championships(ctx).find((c) => c.admin) ?? championships(ctx)[0];
