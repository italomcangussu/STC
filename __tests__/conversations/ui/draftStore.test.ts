import { describe, expect, it } from 'vitest';
import {
  MAX_CONVERSATION_DRAFT_ENTRIES,
  clearConversationDraft,
  getConversationDraft,
  hasConversationDraft,
  setConversationDraft,
} from '@/lib/conversations/draftStore';

describe('conversationDraftStore', () => {
  it('stores and restores a draft per conversation', () => {
    const store = new Map<string, string>();
    setConversationDraft(store, 'conv-a', 'oi tudo bem');
    setConversationDraft(store, 'conv-b', 'outra mensagem');
    expect(getConversationDraft(store, 'conv-a')).toBe('oi tudo bem');
    expect(getConversationDraft(store, 'conv-b')).toBe('outra mensagem');
  });

  it('returns empty string for an unknown conversation', () => {
    const store = new Map<string, string>();
    expect(getConversationDraft(store, 'missing')).toBe('');
    expect(hasConversationDraft(store, 'missing')).toBe(false);
  });

  it('deletes the entry when set to empty/whitespace (no stale draft)', () => {
    const store = new Map<string, string>();
    setConversationDraft(store, 'conv-a', 'rascunho');
    setConversationDraft(store, 'conv-a', '   ');
    expect(hasConversationDraft(store, 'conv-a')).toBe(false);
    expect(getConversationDraft(store, 'conv-a')).toBe('');
  });

  it('clears a draft explicitly', () => {
    const store = new Map<string, string>();
    setConversationDraft(store, 'conv-a', 'rascunho');
    clearConversationDraft(store, 'conv-a');
    expect(hasConversationDraft(store, 'conv-a')).toBe(false);
  });

  it('ignores blank conversation ids', () => {
    const store = new Map<string, string>();
    setConversationDraft(store, '   ', 'x');
    expect(store.size).toBe(0);
    expect(getConversationDraft(store, '   ')).toBe('');
  });

  it('evicts the oldest entry beyond the cap (LRU by recency)', () => {
    const store = new Map<string, string>();
    for (let i = 0; i < MAX_CONVERSATION_DRAFT_ENTRIES; i += 1) {
      setConversationDraft(store, `conv-${i}`, `draft-${i}`);
    }
    // touch conv-0 so it becomes most-recent
    setConversationDraft(store, 'conv-0', 'draft-0-updated');
    // overflow by one → the now-oldest (conv-1) is evicted, conv-0 survives
    setConversationDraft(store, 'conv-overflow', 'new');
    expect(store.size).toBe(MAX_CONVERSATION_DRAFT_ENTRIES);
    expect(hasConversationDraft(store, 'conv-0')).toBe(true);
    expect(hasConversationDraft(store, 'conv-1')).toBe(false);
    expect(hasConversationDraft(store, 'conv-overflow')).toBe(true);
  });
});
