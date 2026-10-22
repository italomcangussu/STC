// Textos do assessor administrativo: proposta e confirmação de cada ação, escritos pelo servidor.

import type { Ctx } from './promptTypes.ts';
import { ADM_PROPOSALS, ADM_SUCCESS } from './adminMessagesAdm.ts';
import { FIN_PROPOSALS, FIN_SUCCESS, type Render } from './adminMessagesFin.ts';

export { hhmm } from './adminText.ts';

/* ------------------------------- Assessor administrativo (financeiro) ------------------------------- */

export const isAdminProposalAction = (a: unknown) => String(a ?? '').startsWith('fin_') || String(a ?? '').startsWith('adm_') || a === 'student_card_renew';

export type AdminAction = 'fin_pendency_create' | 'fin_pendency_collection' | 'fin_pendency_send' | 'fin_payment' | 'student_card_renew'
  | 'fin_charge_cancel' | 'fin_charge_adjust' | 'fin_payment_reverse' | 'fin_receipt_reject' | 'fin_entry_create' | 'fin_receipt_approve' | 'fin_charges_generate'
  | 'adm_announcement_create' | 'adm_announcement_deactivate' | 'adm_student_status' | 'adm_member_status' | 'adm_signature_resend' | 'adm_reservation_cancel'
  | 'fin_member_create' | 'fin_access_approve' | 'adm_access_reject'
  | 'adm_followup_create' | 'adm_followup_done' | 'adm_court_block' | 'adm_pref_set' | 'adm_dependent_create' | 'adm_student_create' | 'adm_message_send' | 'adm_broadcast_send' | 'adm_briefing_recipient' | 'adm_memory_forget'
  | 'adm_form_create' | 'adm_form_toggle' | 'adm_form_nudge' | 'adm_group_post';

export function toCents(reais: number | null | undefined): number | null {
  if (typeof reais !== 'number' || !Number.isFinite(reais) || reais <= 0) return null;
  return Math.round(reais * 100);
}

// Uma tabela por ação: o compilador exige texto para toda ação nova (nada cai no texto de outra).
const PROPOSALS: Record<AdminAction, Render> = { ...FIN_PROPOSALS, ...ADM_PROPOSALS };
const SUCCESS: Record<AdminAction, Render> = { ...FIN_SUCCESS, ...ADM_SUCCESS };

/** Bloco que termina em lista ("- ...") ou citação («...») pede a pergunta na linha de baixo. */
const endsInBlock = (body: string) => /^(- |«)|»$/.test(body.split('\n').at(-1) ?? '');

/** Toda proposta termina com a mesma pergunta, que é o que o administrador responde. */
export function adminProposalMessage(action: AdminAction, s: Ctx): string {
  const body = PROPOSALS[action](s);
  return `${body}${endsInBlock(body) ? '\n' : ' '}Confirma?`;
}

export function adminSuccessMessage(action: AdminAction, s: Ctx): string {
  return SUCCESS[action](s);
}
