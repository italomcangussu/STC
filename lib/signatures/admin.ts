import { supabase } from '../supabase';
import { dispatchNotifications, type DispatchSummary } from './api';
import { SIG_BUCKET } from './documents';
import { sha256Hex } from './hash';
import { openPdf } from './pdf';

/**
 * Lado do administrador em Documentos e Assinaturas.
 *
 * Tudo passa por funções do banco (`sig_*`, que conferem o papel DENTRO delas), pelo bucket privado
 * `sig-docs` (políticas de storage) ou pela borda `signature-operations` (despacho dos avisos). O app
 * não escreve em tabela nenhuma. Documento publicado é imutável: para mudar o texto, nova versão.
 */

export const MAX_PDF_BYTES = 10 * 1024 * 1024;

export type DocumentStatus = 'draft' | 'published' | 'archived';
export type AudienceMode = 'all' | 'selected';

/** Uma linha da visão geral (`sig_documents_overview`). Os `count(*)` chegam como número ou texto. */
export type OverviewRow = {
  id: string;
  title: string;
  version: number;
  status: DocumentStatus;
  audience_mode: AudienceMode;
  applies_to_new_members: boolean;
  page_count: number;
  due_at: string | null;
  created_at: string;
  published_at: string | null;
  recipients: number;
  signed: number;
  notifications_pending: number;
  notifications_failed: number;
  no_phone: number;
};

export type RecipientRow = {
  profile_id: string;
  name: string;
  phone: string | null;
  source: string;
  signed_at: string | null;
  signature_id: string | null;
  notification_status: string | null;
  notification_error: string | null;
  last_notified_at: string | null;
  reminders_sent: number;
};

export type MemberOption = { id: string; name: string; phone: string | null; role: string };

export type PreparedFile = { file: File; fileName: string; sizeBytes: number; pageCount: number; sha256: string };

export type DraftInput = {
  title: string;
  description?: string;
  dueAt?: string | null;
  audienceMode: AudienceMode;
  appliesToNewMembers: boolean;
  replacesId?: string | null;
};

export type PublishResult = { id: string; recipients: number; queued: number; skippedNoPhone: number };

const num = (v: unknown) => Number(v) || 0;

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export async function listAdminDocuments(): Promise<OverviewRow[]> {
  const { data, error } = await supabase.from('sig_documents_overview').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as OverviewRow[]).map((r) => ({
    ...r,
    recipients: num(r.recipients), signed: num(r.signed), notifications_pending: num(r.notifications_pending),
    notifications_failed: num(r.notifications_failed), no_phone: num(r.no_phone),
  }));
}

/** A descrição não vem na visão geral; o formulário do rascunho a lê daqui (o admin enxerga por RLS). */
export async function getDocumentDescription(id: string): Promise<string> {
  const { data, error } = await supabase.from('sig_documents').select('description').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as { description?: string | null } | null)?.description ?? '';
}

export async function listRecipients(documentId: string): Promise<RecipientRow[]> {
  return ((await call<RecipientRow[] | null>('sig_admin_recipients', { p_id: documentId })) ?? [])
    .map((r) => ({ ...r, reminders_sent: num(r.reminders_sent) }));
}

/** Sócios ativos (e administradores, que também assinam) para escolher os destinatários. */
export async function listSignableMembers(): Promise<MemberOption[]> {
  const { data, error } = await supabase.from('profiles').select('id, name, phone, role, is_active').in('role', ['socio', 'admin']).order('name');
  if (error) throw error;
  return ((data ?? []) as Array<MemberOption & { is_active: boolean | null }>)
    .filter((m) => m.is_active !== false)
    .map(({ id, name, phone, role }) => ({ id, name, phone, role }));
}

// ---- arquivo -------------------------------------------------------------------------------------------

export class PdfRejectedError extends Error {
  constructor(readonly reason: 'not_pdf' | 'too_big' | 'empty' | 'unreadable' | 'password') {
    super(`PDF_${reason}`);
    this.name = 'PdfRejectedError';
  }
}

/** Confere tipo, tamanho e leitura do PDF, e calcula o SHA-256 e o número de páginas que o banco exige. */
export async function prepareFile(file: File): Promise<PreparedFile> {
  if (file.size === 0) throw new PdfRejectedError('empty');
  if (file.size > MAX_PDF_BYTES) throw new PdfRejectedError('too_big');
  const bytes = await file.arrayBuffer();
  // A extensão e o tipo do navegador são só dica: o que vale é o cabeçalho do arquivo.
  if (new TextDecoder('latin1').decode(new Uint8Array(bytes.slice(0, 5))) !== '%PDF-') throw new PdfRejectedError('not_pdf');
  let pageCount: number;
  try {
    const pdf = await openPdf(bytes, { skipSizes: true });
    pageCount = pdf.pageCount;
    await pdf.destroy();
  } catch (error) {
    // Sem isto a causa real (senha, worker que não carregou, estrutura) some atrás da mensagem genérica.
    console.error('[assinaturas] pdfjs não abriu o PDF:', error);
    if ((error as { name?: string } | null)?.name === 'PasswordException') throw new PdfRejectedError('password');
    throw new PdfRejectedError('unreadable');
  }
  if (pageCount < 1 || pageCount > 1000) throw new PdfRejectedError('unreadable');
  return { file, fileName: file.name.slice(0, 255) || 'documento.pdf', sizeBytes: file.size, pageCount, sha256: await sha256Hex(bytes) };
}

export async function uploadDraftFile(storagePath: string, file: File): Promise<void> {
  const { error } = await supabase.storage.from(SIG_BUCKET).upload(storagePath, file, { contentType: 'application/pdf', upsert: true });
  if (error) throw error;
}

/** Apaga o arquivo de um rascunho/órfão. A política do bucket recusa se o documento já foi publicado. */
export async function removeDraftFile(storagePath: string | null | undefined): Promise<void> {
  if (!storagePath) return;
  await supabase.storage.from(SIG_BUCKET).remove([storagePath]);
}

const fileFields = (f: PreparedFile) => ({
  file_name: f.fileName, size_bytes: f.sizeBytes, page_count: f.pageCount, content_sha256: f.sha256,
});

// ---- rascunho ------------------------------------------------------------------------------------------

export async function createDraft(input: DraftInput, file: PreparedFile): Promise<{ id: string; storagePath: string; version: number }> {
  const r = await call<{ id: string; storage_path: string; version: number }>('sig_create_draft', {
    p: {
      title: input.title.trim(), description: input.description?.trim() ?? '', due_at: input.dueAt ?? '',
      audience_mode: input.audienceMode, applies_to_new_members: input.appliesToNewMembers && input.audienceMode === 'all',
      replaces_id: input.replacesId ?? '', ...fileFields(file),
    },
  });
  return { id: r.id, storagePath: r.storage_path, version: r.version };
}

/** Atualiza o rascunho. Com arquivo novo, o caminho muda e o antigo fica órfão (`previousStoragePath`). */
export async function updateDraft(id: string, input: DraftInput, file?: PreparedFile): Promise<{ storagePath: string; previousStoragePath: string | null }> {
  const r = await call<{ storage_path: string; previous_storage_path: string | null }>('sig_update_draft', {
    p_id: id,
    p: {
      title: input.title.trim(), description: input.description?.trim() ?? '', due_at: input.dueAt ?? '',
      audience_mode: input.audienceMode, applies_to_new_members: input.appliesToNewMembers && input.audienceMode === 'all',
      ...(file ? fileFields(file) : {}),
    },
  });
  return { storagePath: r.storage_path, previousStoragePath: r.previous_storage_path ?? null };
}

export async function setRecipients(id: string, profileIds: string[]): Promise<number> {
  return num(await call<number>('sig_set_recipients', { p_id: id, p_profiles: profileIds }));
}

export async function deleteDraft(id: string): Promise<void> {
  const path = await call<string | null>('sig_delete_draft', { p_id: id });
  await removeDraftFile(path);
}

// ---- publicação e acompanhamento -----------------------------------------------------------------------

export async function publishDocument(id: string): Promise<PublishResult> {
  const r = await call<{ id: string; recipients: number; queued: number; skipped_no_phone: number }>('sig_publish', { p_id: id });
  return { id: r.id, recipients: num(r.recipients), queued: num(r.queued), skippedNoPhone: num(r.skipped_no_phone) };
}

export type DrainProgress = { sent: number; failed: number; rounds: number; configured: boolean; finished: boolean };

/**
 * Despacha a fila de avisos em voltas até a borda dizer `done` (ou até `maxRounds`, para não prender a
 * tela se a fila nunca esvaziar). Quem não foi alcançado agora o agendador (`signature-dispatch`) envia.
 */
export async function drainNotifications(opts: { maxRounds?: number; onProgress?: (p: DrainProgress) => void; dispatch?: () => Promise<DispatchSummary> } = {}): Promise<DrainProgress> {
  const maxRounds = opts.maxRounds ?? 40;
  const dispatch = opts.dispatch ?? (() => dispatchNotifications());
  const total: DrainProgress = { sent: 0, failed: 0, rounds: 0, configured: true, finished: false };
  while (total.rounds < maxRounds) {
    const s = await dispatch();
    total.rounds += 1;
    total.sent += s.sent;
    total.failed += s.failed;
    total.configured = s.configured;
    opts.onProgress?.({ ...total });
    if (s.done || !s.configured) { total.finished = true; break; }
    // Volta sem nada reclamado e sem `done`: nada a ganhar insistindo agora.
    if (s.claimed === 0) break;
  }
  return total;
}

export async function addRecipients(id: string, profileIds: string[]): Promise<{ added: number; queued: number; skippedNoPhone: number }> {
  const r = await call<{ added: number; queued: number; skipped_no_phone: number }>('sig_add_recipients', { p_id: id, p_profiles: profileIds });
  return { added: num(r.added), queued: num(r.queued), skippedNoPhone: num(r.skipped_no_phone) };
}

export async function removeRecipient(id: string, profileId: string): Promise<void> {
  await call('sig_remove_recipient', { p_id: id, p_profile: profileId });
}

export async function updateDue(id: string, dueAt: string | null): Promise<void> {
  await call('sig_update_due', { p_id: id, p_due: dueAt });
}

export async function setNewMembers(id: string, value: boolean): Promise<void> {
  await call('sig_set_new_members', { p_id: id, p_value: value });
}

export async function archiveDocument(id: string, reason?: string): Promise<void> {
  await call('sig_archive', { p_id: id, p_reason: reason?.trim() || null });
}

export async function resendFailed(id: string): Promise<number> {
  return num(await call<number>('sig_resend_failed', { p_id: id }));
}

export type IntegrityResult = { checked: number; ok: boolean; problems: Array<{ seq: number; problem: string }> };

export async function verifyIntegrity(id: string): Promise<IntegrityResult> {
  const r = await call<IntegrityResult>('sig_verify_integrity', { p_id: id });
  return { checked: num(r.checked), ok: r.ok === true, problems: r.problems ?? [] };
}

// ---- mensagens -----------------------------------------------------------------------------------------

const ADMIN_MESSAGES: Record<string, string> = {
  SIG_FORBIDDEN: 'Só administradores gerenciam documentos para assinatura.',
  SIG_NOT_FOUND: 'Documento não encontrado.',
  SIG_DOCUMENT_IMMUTABLE: 'Este documento já foi publicado e não pode mais ser alterado. Para mudar o texto, crie uma nova versão.',
  SIG_ALREADY_PUBLISHED: 'Este documento já foi publicado.',
  SIG_NOT_PUBLISHED: 'Este documento não está publicado.',
  SIG_FILE_MISSING: 'O PDF não chegou ao servidor. Anexe o arquivo de novo e tente publicar.',
  SIG_FILE_DATA_REQUIRED: 'Faltam os dados do arquivo (nome, tamanho ou páginas). Anexe o PDF de novo.',
  SIG_DUE_IN_PAST: 'O prazo precisa ser uma data futura.',
  SIG_NO_RECIPIENTS: 'Escolha ao menos um sócio para assinar.',
  SIG_NOT_SELECTED_MODE: 'A lista de destinatários só vale quando o público é "sócios escolhidos".',
  SIG_RECIPIENT_INVALID: 'Só sócios ativos (e administradores) podem ser destinatários. Atualize a lista e tente de novo.',
  SIG_ALREADY_SIGNED: 'Esse sócio já assinou; a assinatura não pode ser desfeita.',
  SIG_REPLACES_INVALID: 'Só dá para criar nova versão de um documento já publicado.',
  SIG_NEW_MEMBERS_NEEDS_ALL: '"Vale para sócio novo" só existe quando o documento é para todos os sócios.',
  SIG_DOCUMENT_ARCHIVED: 'Este documento está arquivado.',
};

export function adminErrorMessage(error: unknown, fallback = 'Não foi possível concluir. Tente de novo; se continuar, avise quem cuida do sistema.'): string {
  if (error instanceof PdfRejectedError) {
    return {
      not_pdf: 'O arquivo não é um PDF. Escolha um arquivo .pdf.',
      too_big: 'O PDF tem mais de 10 MB. Comprima o arquivo e tente de novo.',
      empty: 'O arquivo está vazio.',
      password: 'Este PDF pede senha para abrir. Salve uma cópia sem senha e anexe de novo.',
      unreadable: 'Não foi possível ler este PDF (pode estar protegido ou corrompido). Gere o arquivo de novo.',
    }[error.reason];
  }
  const text = error && typeof error === 'object' ? `${(error as { message?: unknown }).message ?? ''}` : '';
  const code = Object.keys(ADMIN_MESSAGES).find((c) => text.includes(c));
  if (code) return ADMIN_MESSAGES[code];
  if ((error as { code?: unknown } | null)?.code === '42501') return ADMIN_MESSAGES.SIG_FORBIDDEN;
  if (/network|fetch|failed to fetch|timeout/i.test(text)) return 'Não foi possível falar com o servidor. Verifique a conexão e tente de novo.';
  // A mensagem crua do banco pode ser longa e técnica; só entra quando é de armazenamento.
  if (/exceeds the maximum allowed size|payload too large/i.test(text)) return ADMIN_MESSAGES.SIG_FILE_MISSING.replace('O PDF não chegou ao servidor.', 'O PDF é grande demais para o servidor.');
  return fallback;
}
