// Link do documento: `https://stcplay.com.br/#documentos/<id>` (é o que vai no WhatsApp).
//
// Fica no `#` de propósito: o app não tem roteador por caminho, e o fragmento nunca vai ao servidor
// nem se perde no login (a tela de login não muda a URL). Id malformado não derruba nada: abre a lista.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DocumentsRoute = { documentId: string | null };

/** `#documentos`, `#/documentos` e `#documentos/<id>` (com ou sem `?…`). Qualquer outro `#`: `null`. */
export function parseDocumentsHash(hash: string): DocumentsRoute | null {
  const clean = (hash ?? '').replace(/^#\/?/, '').split(/[?#]/)[0].replace(/\/+$/, '');
  const [section, id, ...extra] = clean.split('/');
  if (section.toLowerCase() !== 'documentos') return null;
  if (extra.length > 0 || !id || !UUID.test(id)) return { documentId: null };
  return { documentId: id.toLowerCase() };
}

export const documentsHash = (documentId?: string | null): string =>
  documentId && UUID.test(documentId) ? `#documentos/${documentId.toLowerCase()}` : '#documentos';

/** A tela inicial do app para um `#` (o aviso de comprovante e o link do WhatsApp abrem direto na aba certa). */
export function viewFromHash(hash: string): string {
  if (hash === '#meu-financeiro') return 'meu-financeiro';
  if (parseDocumentsHash(hash)) return 'documentos';
  return 'agenda';
}

/** Saiu da aba: o `#documentos/…` antigo não pode reabri-la no próximo carregamento. */
export function clearDocumentsHash(): void {
  if (typeof window === 'undefined' || !parseDocumentsHash(window.location.hash)) return;
  try {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  } catch { /* o navegador pode bloquear: o `#` fica, e só reabre a aba num recarregamento */ }
}

/** Tocar na aba "Documentos" já estando dentro de um documento volta para a lista (como em qualquer aba). */
export function showDocumentsList(): void {
  if (typeof window === 'undefined' || !parseDocumentsHash(window.location.hash)?.documentId) return;
  window.location.hash = documentsHash(null);
}
