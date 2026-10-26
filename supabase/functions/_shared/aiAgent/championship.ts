// Campeonato com inscrição pelo João: o modelo colhe os dados; o SERVIDOR inscreve, manda a camisa, define cabeças e sorteia.
// Todo texto de resultado sai daqui, a partir do que o banco devolveu (o modelo nunca anuncia inscrição feita).

import { brl, championships, phoneBR } from './championshipPrompt.ts';
import type { DecideInput } from './decide.ts';
import { isAdminAssistant } from './promptAdmin.ts';
import type { Ctx } from './promptTypes.ts';
import type { Answer, ChampAction, Decision, Memory, Slots } from './turnTypes.ts';

type Res = { ok?: boolean; code?: string; message?: string } & Ctx;

const SERVER_ACTIONS: ChampAction[] = ['inscrever', 'camisa', 'cabecas', 'sortear'];
export const isChampionshipServerAction = (a: unknown): a is ChampAction => SERVER_ACTIONS.includes(a as ChampAction);

const QUADRA: Record<string, string> = { '4ª Classe': 'saibro', '5ª Classe': 'quadra rápida' };
const comQuadra = (classe: string) => (QUADRA[classe] ? `${classe} (${QUADRA[classe]})` : classe);

type Out = { bubbles: string[]; action: string } & Partial<Decision>;
const reply = (memory: Memory, out: Out): Decision => ({ awaiting: false, close: false, memory, ...out });
const ask = (memory: Memory, text: string, action = 'champ_ask'): Decision => reply(memory, { bubbles: [text], action, awaiting: true });
/** Atleta feito: a próxima inscrição começa sem os dados deste. */
const nextAthlete = (memory: Memory): Memory => ({ ...memory, slots: {} });

/* ------------------------------- Textos ------------------------------- */

export function signupMessage(r: Ctx): string {
  const s = r.signup as Ctx;
  const pend = (r.my_pending ?? []) as string[];
  const total = Number(r.my_pending_total_cents ?? 0);
  const pagar = pend.length > 1
    ? `Você tem ${pend.length} inscrições esperando o Pix (${pend.join(', ')}). Pode mandar um Pix só com o total: ${brl(total)}.`
    : `Para garantir a vaga, faz o Pix de ${brl(r.price_cents)}.`;
  return [
    `Pré-inscrição feita no ${r.championship} ✅`,
    `Atleta: ${s.full_name}\nClasse: ${comQuadra(String(s.class))}\nCamisa: ${s.shirt_size}${s.city ? `\nCidade: ${s.city}` : ''}\nTelefone: ${phoneBR(s.phone)}`,
    `${pagar}\nChave Pix: ${r.pix_key} (${r.payee})`,
    'Depois é só me mandar o comprovante aqui que eu confiro e confirmo a inscrição na hora.',
  ].join('\n\n');
}

export function waitlistMessage(r: Ctx): string {
  const s = r.signup as Ctx;
  return `A ${s.class} já está com todas as vagas preenchidas. Coloquei ${s.full_name} na lista de espera do ${r.championship}: se abrir vaga, a organização avisa. Não precisa pagar agora.`;
}

const STATUS_TXT: Record<string, string> = { pre: 'está pré-inscrito, esperando o Pix', confirmed: 'já está com a inscrição confirmada', waitlist: 'está na lista de espera' };
export function duplicateMessage(r: Ctx): string {
  const e = (r.existing ?? {}) as Ctx;
  const quem = String(e.full_name ?? 'Esse atleta');
  const onde = e.class ? ` na ${e.class}` : '';
  const situacao = STATUS_TXT[String(e.status)] ?? 'já está inscrito';
  const pista = r.same_phone ? ' (o telefone informado já está nessa inscrição)' : '';
  return `${quem}${onde} ${situacao}${pista}. Não fiz outra inscrição para não duplicar. Se for outro atleta, me passa o nome completo e o telefone dele.`;
}

export function drawMessage(r: Ctx): string {
  const jogos = ((r.matches ?? []) as Ctx[]).map((m) => (m.bye
    ? `${m.match}. ${m.a ?? m.b} — passa direto (sem adversário)`
    : `${m.match}. ${m.a} x ${m.b}`));
  return `Sorteio da ${r.class} feito ✅ (${r.count} atletas)\n\nOitavas de final:\n${jogos.join('\n')}\n\nA chave inteira (até a final) já está gravada e as oitavas aparecem no app. Se quiser, me peça para publicar no grupo.`;
}

/* ------------------------------- Ações ------------------------------- */

/** O que ainda falta para inscrever (em português, para a pergunta). */
function missingData(slots: Slots, phone: string | null): string[] {
  return [!slots.athlete_name && 'o nome completo do atleta', !slots.champ_class && 'a classe (4ª ou 5ª)',
    !slots.shirt_size && 'o tamanho da camisa', !phone && 'o telefone do atleta (com DDD)'].filter(Boolean) as string[];
}

/** O próprio atleta usa o telefone de quem fala (já confirmado na conversa); amigo, o telefone que foi dito. */
function athletePhone({ slots, ctx }: DecideInput): string | null {
  if (!slots.athlete_self) return slots.athlete_phone ?? null;
  return String((ctx.championship as Ctx | null)?.requester_phone ?? '') || null;
}

/** O que o banco devolveu vira a fala: Pix, lista de espera, duplicado, encerrado ou o dado a corrigir. */
function signupOutcome(r: Res | null, memory: Memory): Decision {
  if (r?.ok && r.waitlist) return reply(nextAthlete(memory), { bubbles: [waitlistMessage(r)], action: 'champ_waitlist' });
  if (r?.ok) return reply(nextAthlete(memory), { bubbles: [signupMessage(r)], action: 'champ_signup', verbatim: true });
  if (r?.code === 'DUPLICATE') return reply(nextAthlete(memory), { bubbles: [duplicateMessage(r)], action: 'champ_duplicate' });
  if (r?.code === 'CLOSED' || r?.code === 'NO_CHAMPIONSHIP') return reply(nextAthlete(memory), { bubbles: [String(r.message)], action: 'champ_closed' });
  return ask(memory, r?.message ?? 'Não consegui registrar a inscrição agora. Pode me mandar os dados de novo?', `champ_failed:${r?.code ?? 'UNKNOWN'}`);
}

async function inscrever(i: DecideInput, memory: Memory): Promise<Decision> {
  const { slots } = i;
  if (i.ctx.is_group) return ask(memory, 'Para inscrever, me chama no privado que eu faço rapidinho por lá 🎾', 'champ_private_only');
  const phone = athletePhone(i);
  const falta = missingData(slots, phone);
  if (falta.length) return ask(memory, `Para fazer a inscrição, só falta ${falta.join(', ').replace(/, ([^,]*)$/, ' e $1')}.`);
  const r = (await i.deps.db('conv_svc_ai_championship_signup', { p_session: i.session, p: {
    full_name: slots.athlete_name, phone, class: slots.champ_class, shirt_size: slots.shirt_size, city: slots.athlete_city ?? null,
  } })).data as Res | null;
  return signupOutcome(r, memory);
}

function camisa(i: DecideInput, memory: Memory): Decision {
  const c = championships(i.ctx).find((x) => x.shirt_image) ?? championships(i.ctx)[0];
  const img = c?.shirt_image as Ctx | null | undefined;
  if (!img?.path) return reply(memory, { bubbles: ['A foto da camisa ainda não chegou para mim. Assim que a organização mandar, eu te mostro!'], action: 'champ_shirt_missing' });
  return reply(memory, { bubbles: [`Essa é a camisa do ${c.name} 👕 Ela já vem com a inscrição. Tamanhos: ${((c.shirt_sizes ?? []) as string[]).join(', ')}.`], action: 'champ_shirt',
    files: [{ path: String(img.path), name: String(img.name ?? 'camisa.jpg'), mime: String(img.mime ?? 'image/jpeg'), caption: '', kind: 'image' }] });
}

async function cabecas(i: DecideInput, memory: Memory): Promise<Decision> {
  if (!isAdminAssistant(i.ctx)) return reply(memory, { bubbles: ['Os cabeças de chave são definidos pela organização do campeonato.'], action: 'champ_forbidden' });
  const nomes = i.slots.seed_names ?? [];
  if (!i.slots.champ_class) return ask(memory, 'De qual classe são esses cabeças de chave: 4ª ou 5ª?');
  if (!nomes.length) return ask(memory, `Quem são os cabeças de chave da ${i.slots.champ_class}? Me diga na ordem (o primeiro é o cabeça 1).`);
  const r = (await i.deps.db('conv_svc_ai_championship_seeds', { p_session: i.session, p: { class: i.slots.champ_class, names: nomes } })).data as Res | null;
  if (!r?.ok) return ask(memory, r?.message ?? 'Não consegui gravar os cabeças de chave agora.', `champ_failed:${r?.code ?? 'UNKNOWN'}`);
  const lista = ((r.seeds ?? []) as string[]).map((n, k) => `${k + 1}. ${n}`).join('\n');
  return reply(nextAthlete(memory), { bubbles: [`Cabeças de chave da ${r.class}:\n${lista}\n\nQuando quiser, é só pedir o sorteio da ${r.class}.`], action: 'champ_seeds', verbatim: true });
}

async function sortear(i: DecideInput, memory: Memory): Promise<Decision> {
  if (!isAdminAssistant(i.ctx)) return reply(memory, { bubbles: ['O sorteio da chave é feito pela organização do campeonato.'], action: 'champ_forbidden' });
  if (!i.slots.champ_class) return ask(memory, 'Qual classe eu sorteio: 4ª ou 5ª?');
  const r = (await i.deps.db('conv_svc_ai_championship_draw', { p_session: i.session, p: { class: i.slots.champ_class } })).data as Res | null;
  if (!r?.ok) return reply(nextAthlete(memory), { bubbles: [r?.message ?? 'Não consegui fazer o sorteio agora.'], action: `champ_failed:${r?.code ?? 'UNKNOWN'}` });
  return reply(nextAthlete(memory), { bubbles: [drawMessage(r)], action: 'champ_drawn', verbatim: true });
}

/** Ação do campeonato que o servidor executa (o modelo marcou ready). */
export function campeonato(i: DecideInput, memory: Memory): Promise<Decision> | Decision {
  switch (i.slots.champ_action) {
    case 'inscrever': return inscrever(i, memory);
    case 'camisa': return camisa(i, memory);
    case 'cabecas': return cabecas(i, memory);
    default: return sortear(i, memory);
  }
}

/** Assunto do campeonato fica com o João (atletas de fora não têm cadastro): fala de transferência vira conversa. */
export function keepChampionshipInChat(a: Answer): Answer {
  if (a.intent !== 'campeonato' || !a.transfer || !a.messages.length) return a;
  return { ...a, transfer: false, handoff_kind: null, handoff_note: null, awaiting: true };
}
