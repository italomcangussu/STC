import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import MessageBubble, { audioTranscription } from '../../../components/conversations/MessageBubble';
import type { ConversationMessage } from '../../../lib/conversations/api';

const msg = (over: Partial<ConversationMessage> = {}) => ({
  id: 'm1', direction: 'inbound', origin: 'customer', kind: 'ptt', body: '🎤 Áudio', status: 'received',
  createdAt: '2026-10-07T12:00:00Z', sentAt: null, lastError: null, mediaPath: null, mediaMime: 'audio/ogg', mediaName: null,
  meta: {}, replyPreview: null, reactions: {}, editedAt: null, deletedAt: null, providerId: 'wa1', senderName: null,
  mentionDirect: false, mentionEvidence: null, ...over,
}) as unknown as ConversationMessage;

describe('transcrição do áudio no balão', () => {
  it('mostra o texto ouvido no lugar do rótulo "🎤 Áudio", avisando quando pode ter erro', () => {
    render(<MessageBubble message={msg({ meta: { transcription: { status: 'ok', text: 'Reserva a quadra 2 pra mim', low_confidence: true } } })} canWrite={false} />);
    expect(screen.getByText('Reserva a quadra 2 pra mim')).toBeTruthy();
    expect(screen.getByText(/Transcrição · pode ter erros/)).toBeTruthy();
    expect(screen.queryByText('🎤 Áudio')).toBeNull();
  });

  it('inaudível vira aviso; sem transcrição (ou áudio enviado pelo clube) nada muda', () => {
    expect(audioTranscription(msg({ meta: { transcription: { status: 'unclear' } } }))).toEqual({ status: 'unclear' });
    expect(audioTranscription(msg({ meta: { transcription: { status: 'failed' } } }))).toBeNull();
    expect(audioTranscription(msg({ direction: 'outbound', meta: { transcription: { status: 'ok', text: 'x' } } }))).toBeNull();
    expect(audioTranscription(msg({ kind: 'text', meta: { transcription: { status: 'ok', text: 'x' } } }))).toBeNull();
    render(<MessageBubble message={msg({ meta: { transcription: { status: 'unclear' } } })} canWrite={false} />);
    expect(screen.getByText(/não deu para entender o áudio/)).toBeTruthy();
  });
});
