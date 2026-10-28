// Para quem vai o recado do administrador: sócio do cadastro ou, sem sócio com o nome, quem já conversa com o João
// (atleta convidado, aluno). Caso Romário (28/10): "diga isso a ele" virou "ele é seu convidado?" porque só valia sócio.

import type { DecideInput } from './decide.ts';
import { resolve } from './turnOutcome.ts';

type Contact = { contact_id: string; name: string };
type Found = { status?: 'unique' | 'many' | 'none'; matches?: Contact[] } | null;
export type Recipient = { profile_id: string } | { contact_id: string } | { ask: string };

const lista = (nomes: string[]) => nomes.join(', ').replace(/, ([^,]*)$/, ' ou $1');

export async function messageRecipient(i: DecideInput, name: string): Promise<Recipient> {
  const socio = await resolve(i.deps.db, [name], 'member');
  if (!socio.ask) return { profile_id: socio.ids[0] };
  const found = (await i.deps.db('conv_svc_ai_admin_find_contact', { p_session: i.session, p_name: name })).data as Found;
  const matches = found?.matches ?? [];
  if (found?.status === 'unique') return { contact_id: matches[0].contact_id };
  if (found?.status === 'many') return { ask: `Tenho conversa com mais de uma pessoa com esse nome: ${lista(matches.map((m) => m.name))}. Qual delas?` };
  return { ask: socio.ask };
}
