// Repasse do comprovante de um sócio comum ao responsável pelo financeiro (fin_settings.finance_admin_profile_id).
// O João não deduz a finalidade nem gera pagamento: manda ao financeiro o que leu e o que a pessoa disse, mais a imagem,
// e o administrador decide na própria conversa (cadastrar/renovar aluno, lançar receita, dar baixa).
import { buildChatRequest, providerIdFrom, uazError, type UazCaller } from '../uazChat.ts';
import type { Db } from './turnTypes.ts';

export type ReceiptForward = {
  admin_conversation_id: string; admin_name: string; sender_name: string; kind: string; detail: string | null;
  submission_id?: string | null; amount_cents?: number | null; paid_on?: string | null; payee?: string | null;
  media_path?: string | null; media_mime?: string | null; media_name?: string | null; media_kind?: string | null;
  /** Texto pronto (aviso de baixa automática); sem ele, o repasse monta o texto do comprovante. */
  text?: string;
};
type ForwardDeps = { db: Db; uaz: UazCaller | null; signedUrl?: (path: string) => Promise<string | null> };

const brl = (c: unknown) => { const n = Number(c); return Number.isFinite(n) && n > 0 ? `R$ ${(n / 100).toFixed(2).replace('.', ',')}` : 'valor não lido'; };
const dateBR = (iso: string) => iso.split('-').reverse().join('/');

const NEXT_STEP: Record<string, string> = {
  membership: 'Se estiver certo, me diga "pode dar baixa" que eu registro a mensalidade.',
  member_pendency: 'Se estiver certo, me diga "pode dar baixa" que eu registro a pendência.',
  student_card: 'Quer que eu cadastre ou renove o Card do aluno? Me diga o nome e se é mensalista ou Mensalista Kids.',
};

export function forwardText(f: ReceiptForward): string {
  const quando = f.paid_on ? ` (pago em ${dateBR(f.paid_on)}${f.payee ? `, para ${f.payee}` : ''})` : f.payee ? ` (para ${f.payee})` : '';
  const passo = NEXT_STEP[f.kind] ?? 'O que faço com ele? Posso lançar como receita ou despesa, cadastrar ou renovar aluno, ou cadastrar sócio.';
  return `${f.admin_name}, ${f.sender_name} mandou este comprovante de ${brl(f.amount_cents)}${quando}. Disse que é: ${f.detail ?? 'não explicou'}. ${passo}`;
}

/** Enfileira e envia na conversa do financeiro: o texto e, depois, o próprio arquivo. Melhor esforço: devolve quantos saíram. */
export async function deliverForward(f: ReceiptForward, deps: ForwardDeps): Promise<number> {
  const enviar = async (p: Record<string, unknown>, request: (destination: string) => ReturnType<typeof buildChatRequest>) => {
    const q = await deps.db('conv_svc_queue_message', { p_conversation: f.admin_conversation_id, p, p_author: null, p_key: crypto.randomUUID(), p_origin: 'ai' });
    const row = (Array.isArray(q.data) ? q.data[0] : q.data) as { message_id: string; destination: string } | null;
    if (!row) return false;
    const pedido = request(row.destination);
    const res = deps.uaz && pedido ? await deps.uaz(pedido) : { ok: false as const, error: 'WHATSAPP_NOT_CONFIGURED' };
    await deps.db('conv_svc_finish_message', { p_message: row.message_id, p_sent: res.ok,
      p_provider_id: res.ok ? providerIdFrom((res as { body: Record<string, unknown> }).body) : null, p_error: uazError(res) });
    return res.ok;
  };
  const texto = f.text ?? forwardText(f);
  if (!(await enviar({ kind: 'text', body: texto }, (number) => buildChatRequest({ action: 'send', number, kind: 'text', text: texto })))) return 0;
  if (!f.media_path || !deps.signedUrl) return 1;
  const url = await deps.signedUrl(f.media_path);
  const kind = f.media_kind === 'image' ? 'image' : 'document';
  const ok = url ? await enviar({ kind, body: '', media_path: f.media_path, mime: f.media_mime, file_name: f.media_name },
    (number) => buildChatRequest({ action: 'send', number, kind, fileUrl: url, mime: f.media_mime ?? undefined, fileName: f.media_name ?? undefined })) : false;
  return ok ? 2 : 1;
}

type MembershipAuto = { applied?: boolean; month?: string; amount_cents?: number; admin_conversation_id?: string | null; admin_name?: string; sender_name?: string };
const monthBR = (iso?: string) => (iso ? iso.slice(0, 7).split('-').reverse().join('/') : 'do mês');

/** Época da mensalidade: o servidor tenta a baixa (valor = devido, favorecido = clube). Aplicada: resposta ao sócio e aviso ao financeiro. */
type Call = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown }>;
export async function tryMembershipAutoPay(db: Call, stageId: string): Promise<{ messages: string[]; action: string; forward?: ReceiptForward } | null> {
  let a: MembershipAuto | null = null;
  try { a = (await db('conv_svc_receipt_membership_auto', { p_stage: stageId })).data as MembershipAuto | null; } catch { return null; }
  if (!a?.applied) return null;
  const mes = monthBR(a.month);
  const forward = a.admin_conversation_id ? { admin_conversation_id: a.admin_conversation_id, admin_name: a.admin_name ?? '', sender_name: a.sender_name ?? '',
    kind: 'membership_auto', detail: null,
    text: `${a.admin_name}, para você saber: a mensalidade de ${mes} de ${a.sender_name} (${brl(a.amount_cents)}) chegou pelo WhatsApp e já dei baixa (valor igual ao devido e Pix para o clube).` } : undefined;
  return { action: 'receipt_membership_paid', forward, messages: [`Recebi! Sua mensalidade de ${mes} (${brl(a.amount_cents)}) está registrada como paga. Obrigado!`] };
}
