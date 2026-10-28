// Leitura do assessor: cada domínio vai para a função certa do banco (mesmo contrato `{ ok, message, data }`).

import { type AdminReadDomain, FORMS_DOMAINS, READ_MORE_DOMAINS } from './adminReads.ts';
import { renderCapabilities } from './capabilities.ts';
import type { DecideInput } from './decide.ts';
import { resolve } from './turnOutcome.ts';
import type { Decision, Memory } from './turnTypes.ts';

export type ReadResult = { ok: boolean; message?: string; data?: unknown } | null;
export type Args = Record<string, unknown>;
export type Ask = (text: string, awaiting?: boolean) => Decision;

export const READ_FAILED = 'Não consegui consultar isso agora. Tenta de novo daqui a pouco?';

/** Pergunta de volta ao administrador, na mesma sessão (por padrão espera a resposta). */
export const askWith = (memory: Memory): Ask => (text, awaiting = true) => ({ bubbles: [text], awaiting, close: false, action: 'ask', memory });

/** Período da consulta como o modelo leu; nada informado vira null e o banco usa o padrão do domínio. */
export const periodArgs = ({ slots }: DecideInput): Args => ({ from: slots.read_from ?? null, to: slots.read_to ?? null, date: slots.date ?? null });

/** Sócio pelo nome, do cadastro: um só devolve o id; ambíguo ou nenhum devolve a pergunta. */
export async function memberId(i: DecideInput, name: string): Promise<{ id: string } | { ask: string }> {
  const r = await resolve(i.deps.db, [name], 'member');
  return r.ask ? { ask: r.ask } : { id: r.ids[0] };
}

/** Função do banco e parâmetros de cada domínio de leitura. */
function route(session: string, domain: AdminReadDomain, args: Args): { fn: string; params: Args } {
  if (domain === 'memoria') return { fn: 'conv_svc_ai_admin_memories', params: { p_session: session, p_subject: typeof args.subject === 'string' ? args.subject : null } };
  if (domain === 'comprovantes_whatsapp') {
    return { fn: 'conv_svc_ai_admin_whatsapp_receipts', params: { p_session: session, p_name: args.name ?? null, p_from: args.from ?? null, p_to: args.to ?? null } };
  }
  if (domain === 'socios') return { fn: 'conv_svc_ai_admin_members', params: { p_session: session } };
  const fn = FORMS_DOMAINS.includes(domain) ? 'conv_svc_ai_admin_forms_read' : READ_MORE_DOMAINS.includes(domain) ? 'conv_svc_ai_admin_read_more' : 'conv_svc_ai_admin_read';
  return { fn, params: { p_session: session, p_domain: domain, p_args: args } };
}

export async function readAdmin(i: DecideInput, domain: AdminReadDomain, args: Args): Promise<ReadResult> {
  if (domain === 'capacidades') return { ok: true, data: { text: renderCapabilities() } };
  const { fn, params } = route(i.session, domain, args);
  return (await i.deps.db(fn, params)).data as ReadResult;
}
