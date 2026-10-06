// Portado do CRM Ibiapaba (`pages/crm/conversationDraftStore.ts`).
// Per-conversation composer drafts. Keeping drafts keyed by conversationId
// prevents a draft typed for one lead from leaking into another conversation
// when the attendant switches chats (wrong-recipient risk in a shared inbox).
// Mirrors the LRU eviction style of conversationPreviewByConversationIdRef.

export const MAX_CONVERSATION_DRAFT_ENTRIES = 200;

function normalizeConversationId(conversationId: string): string {
  return String(conversationId || '').trim();
}

export function getConversationDraft(store: Map<string, string>, conversationId: string): string {
  const key = normalizeConversationId(conversationId);
  if (!key) return '';
  return store.get(key) ?? '';
}

export function hasConversationDraft(store: Map<string, string>, conversationId: string): boolean {
  const key = normalizeConversationId(conversationId);
  if (!key) return false;
  return store.has(key);
}

export function clearConversationDraft(store: Map<string, string>, conversationId: string): void {
  const key = normalizeConversationId(conversationId);
  if (!key) return;
  store.delete(key);
}

export function setConversationDraft(store: Map<string, string>, conversationId: string, text: string): void {
  const key = normalizeConversationId(conversationId);
  if (!key) return;

  // Refresh recency: delete then re-set so Map keeps insertion = recency order.
  store.delete(key);

  if (!text || !text.trim()) {
    return; // empty draft = no entry, so the list never shows a stale "Rascunho:"
  }

  store.set(key, text);

  while (store.size > MAX_CONVERSATION_DRAFT_ENTRIES) {
    const oldestKey = store.keys().next().value as string | undefined;
    if (!oldestKey) break;
    store.delete(oldestKey);
  }
}
