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

type MembershipAuto = { applied?: boolean; reason?: string; due_cents?: number; month?: string; amount_cents?: number; admin_conversation_id?: string | null; admin_name?: string; sender_name?: string;
  charge_type?: string; description?: string | null; offset_cents?: number; offset_items?: string | null };
const monthBR = (iso?: string) => (iso ? iso.slice(0, 7).split('-').reverse().join('/') : 'do mês');
/** O que foi pago: a pendência pelo nome dela, ou a mensalidade do mês. */
const paidCharge = (a: MembershipAuto) => (a.charge_type === 'member_pendency'
  ? `a pendência "${a.description ?? 'em aberto'}"` : `a mensalidade de ${monthBR(a.month)}`);

/** Época da mensalidade: o servidor tenta a baixa (valor = devido, favorecido = clube). Aplicada: resposta ao sócio e aviso ao financeiro. */
type Call = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error?: unknown }>;
const MEMBERSHIP_UNAVAILABLE = { action: 'receipt_membership_unavailable', messages: ['Recebi o comprovante, mas não consegui concluir a conferência no sistema agora. Ainda não confirmei a baixa dessa mensalidade. O comprovante continua guardado para conferência.'] };
export type MembershipReceipt = { messages: string[]; action: string; forward?: ReceiptForward; reviewReason?: string };
export async function tryMembershipAutoPay(db: Call, stageId: string, context?: { month?: string | null; purpose_kind?: string }): Promise<MembershipReceipt | null> {
  let a: MembershipAuto | null = null;
  try {
    const result = await db('conv_svc_receipt_membership_auto', { p_stage: stageId, ...(context ? { p_context: context } : {}) });
    if (result.error) return MEMBERSHIP_UNAVAILABLE;
    a = result.data as MembershipAuto | null;
  } catch { return MEMBERSHIP_UNAVAILABLE; }
  if (!a?.applied) return membershipReview(a);
  const oQue = paidCharge(a);
  const abatido = offsetNote(a);
  const forward = a.admin_conversation_id ? { admin_conversation_id: a.admin_conversation_id, admin_name: a.admin_name ?? '', sender_name: a.sender_name ?? '',
    kind: 'membership_auto', detail: null,
    text: `${a.admin_name}, para você saber: ${oQue} de ${a.sender_name} (${brl(a.amount_cents)}) chegou pelo WhatsApp e já dei baixa (valor igual ao devido e Pix para o clube).${abatido}` } : undefined;
  const sua = oQue.replace(/^a /, 'Sua ');
  return { action: 'receipt_membership_paid', forward, messages: [`Recebi! ${sua} (${brl(a.amount_cents)}) está registrada como paga.${abatido} Obrigado!`] };
}

/** Pix que veio com despesas do clube abatidas: a mensalidade fica cheia e as despesas ficam pagas. */
function offsetNote(a: MembershipAuto): string {
  if (!a.offset_cents) return '';
  return ` Com ${brl(a.offset_cents)} abatidos (${a.offset_items ?? 'despesas do clube'}), a mensalidade fica quitada em ${brl(Number(a.amount_cents ?? 0) + a.offset_cents)} e essas despesas ficam pagas.`;
}

function membershipReview(a: MembershipAuto | null) {
  const replies: Record<string, string> = {
    AMBIGUOUS: 'Encontrei mais de uma cobrança com esse valor. Qual mês da mensalidade você está pagando? Ainda não dei baixa.',
    OCR_UNCERTAIN: 'Recebi o comprovante, mas a leitura do valor ou da data ficou incerta. Pode enviar o PDF original ou uma imagem mais nítida? Ainda não dei baixa.',
    PAYMENT_NOT_COMPLETED: 'O comprovante indica agendamento ou pagamento não concluído. Envie o comprovante após a conclusão do Pix. Ainda não dei baixa.',
    INVALID_PAYMENT_DATE: 'Não consegui validar a data desse pagamento. Pode enviar o comprovante original? Ainda não dei baixa.',
    DUPLICATE: 'Esse comprovante ou identificador de transação já foi recebido. Não dei outra baixa. Se fez outro Pix, envie o comprovante novo.',
    NO_OPEN_CHARGE: 'Não encontrei mensalidade em aberto para essa competência e esse sócio. Pode confirmar de quem é e qual mês foi pago? Ainda não dei baixa.',
    PAYEE: 'Não consegui confirmar o clube como favorecido nesse comprovante. Pode conferir o destinatário e enviar o comprovante original? Ainda não dei baixa.',
    AMOUNT_MISMATCH: `O valor do comprovante não corresponde ao total devido${a?.due_cents ? ` (${brl(a.due_cents)})` : ''}. Esse Pix é de qual sócio e mês? Ainda não dei baixa.`,
    APPROVE_FAILED: MEMBERSHIP_UNAVAILABLE.messages[0],
    NO_FINANCE_ADMIN: MEMBERSHIP_UNAVAILABLE.messages[0],
    ACCOUNT: MEMBERSHIP_UNAVAILABLE.messages[0],
  };
  const text = a?.reason ? replies[a.reason] : undefined;
  return text ? { action: 'receipt_membership_review', messages: [text], reviewReason: a?.reason } : null;
}

/** Finalidade e titular conhecidos: o arquivo já guardado vira pendência de conferência, não um comprovante inexistente. */
export async function forwardMembershipReview(input: { db: Call; stage: string; message: string; month: string | null; receipt: MembershipReceipt }): Promise<MembershipReceipt> {
  const reviewable = new Set(['PAYEE', 'OCR_UNCERTAIN', 'INVALID_PAYMENT_DATE']);
  if (!reviewable.has(input.receipt.reviewReason ?? '')) return input.receipt;
  const detail = `Mensalidade própria${input.month ? ` de ${monthBR(input.month)}` : ''}; conferir comprovante: ${input.receipt.reviewReason}`;
  try {
    const result = await input.db('conv_svc_receipt_escalate', { p_stage: input.stage, p_message: input.message, p_kind: 'membership', p_detail: detail });
    const forward = result.data as (ReceiptForward & { ok?: boolean }) | null;
    if (!forward?.ok || !forward.admin_conversation_id) return input.receipt;
    return { action: 'receipt_escalated', forward, messages: [`Identifiquei que é a sua mensalidade. Guardei o comprovante e encaminhei para ${forward.admin_name}, do financeiro, conferir os dados que a leitura não confirmou. Ainda não dei baixa.`] };
  } catch { return input.receipt; }
}
