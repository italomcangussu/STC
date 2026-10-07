import { supabase } from '../supabase';
import type { JourneyKind } from './journey';

/**
 * Lado do sócio em Documentos e Assinaturas: lista, PDF, CPF e trilha da leitura.
 *
 * Tudo passa por funções do banco (`sig_my_*`, `sig_log_event`, `sig_save_my_cpf`) ou por leitura
 * protegida por RLS; o app não escreve em tabela nenhuma. O código de 6 dígitos e a assinatura em si
 * ficam em `api.ts` (função de borda), porque envolvem o WhatsApp.
 */

export const SIG_BUCKET = 'sig-docs';

export type MyDocumentRow = {
  document_id: string;
  title: string;
  description: string | null;
  version: number;
  page_count: number;
  size_bytes: number;
  content_sha256: string;
  storage_path: string;
  due_at: string | null;
  status: 'published' | 'archived';
  published_at: string | null;
  /** Texto exato do aceite, o mesmo que o banco grava na assinatura. */
  consent_text: string;
  signed_at: string | null;
  signature_id: string | null;
};

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export async function listMyDocuments(): Promise<MyDocumentRow[]> {
  return (await call<MyDocumentRow[] | null>('sig_my_documents')) ?? [];
}

export async function myPendingCount(): Promise<number> {
  return Number(await call<number | null>('sig_my_pending_count')) || 0;
}

/**
 * CPF já declarado por este sócio, só dígitos. Filtra pelo id porque o administrador também enxerga as
 * linhas de todos (sem o filtro a leitura de UMA linha falharia para ele).
 */
export async function getMyCpf(profileId: string): Promise<string | null> {
  const { data, error } = await supabase.from('sig_member_identities').select('cpf').eq('profile_id', profileId).maybeSingle();
  if (error) throw error;
  return (data as { cpf?: string } | null)?.cpf ?? null;
}

export async function saveMyCpf(cpfDigits: string): Promise<void> {
  await call('sig_save_my_cpf', { p_cpf: cpfDigits });
}

export async function logJourneyEvent(documentId: string, kind: JourneyKind, meta: Record<string, unknown> = {}): Promise<void> {
  await call('sig_log_event', { p_document: documentId, p_kind: kind, p_meta: meta });
}

export class DocumentFileError extends Error {
  constructor() {
    super('SIG_FILE_UNAVAILABLE');
    this.name = 'DocumentFileError';
  }
}

/** Baixa o PDF do bucket privado (a política só deixa quem deve assinar, ou já assinou, ler o arquivo). */
export async function downloadDocumentFile(storagePath: string): Promise<ArrayBuffer> {
  const { data, error } = await supabase.storage.from(SIG_BUCKET).download(storagePath);
  if (error || !data) throw new DocumentFileError();
  return data.arrayBuffer();
}

const MESSAGES: Record<string, string> = {
  SIG_CPF_INVALID: 'CPF inválido. Confira os 11 números e tente de novo.',
  SIG_CPF_LOCKED: 'O CPF não pode mais ser alterado depois da primeira assinatura. Se estiver errado, fale com a administração do clube.',
  SIG_READ_INCOMPLETE: 'Ainda faltam páginas para ler. Role o documento até o fim.',
  SIG_READ_NOT_STARTED: 'Abra o documento e comece a leitura antes de continuar.',
  SIG_READ_REQUIRED: 'Leia o documento até o fim antes de concordar.',
  SIG_NOT_PUBLISHED: 'Este documento não está mais aberto para assinatura.',
  SIG_ALREADY_SIGNED: 'Você já assinou este documento.',
  SIG_NOT_FOUND: 'Este documento não está disponível para você.',
  SIG_FORBIDDEN: 'Só sócios ativos acessam documentos para assinar.',
  SIG_FILE_UNAVAILABLE: 'Não foi possível baixar o documento. Verifique a conexão e tente de novo.',
};

/** Frase para a pessoa, com a causa (nunca o texto cru do banco). */
export function documentErrorMessage(error: unknown, fallback = 'Não foi possível concluir. Tente de novo; se continuar, avise a administração.'): string {
  const text = error && typeof error === 'object' ? `${(error as { message?: unknown }).message ?? ''}` : '';
  const code = Object.keys(MESSAGES).find((c) => text.includes(c));
  if (code) return MESSAGES[code];
  if ((error as { code?: unknown } | null)?.code === '42501') return MESSAGES.SIG_FORBIDDEN;
  if (/network|fetch|failed to fetch|timeout/i.test(text)) return 'Não foi possível falar com o servidor. Verifique a conexão e tente de novo.';
  return fallback;
}
