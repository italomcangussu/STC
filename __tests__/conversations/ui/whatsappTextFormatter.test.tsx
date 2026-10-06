import { Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { parseWhatsAppTextBlocks, renderWhatsAppTextBlocks } from '@/lib/conversations/whatsappTextFormatter';

describe('parseWhatsAppTextBlocks', () => {
  it('parses inline WhatsApp markers used in message bubbles', () => {
    const blocks = parseWhatsAppTextBlocks('*oi, tudo bem* _sim_ ~nao~ `pix`');

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe('paragraph');
    expect(blocks[0]?.segments?.map((segment) => segment.type)).toEqual([
      'bold',
      'text',
      'italic',
      'text',
      'strike',
      'text',
      'code',
    ]);
  });

  it('does not treat plain math or word separators as formatting', () => {
    const blocks = parseWhatsAppTextBlocks('Valor 2*3 e portal_meu_cliente');

    expect(blocks[0]?.segments).toEqual([
      {
        type: 'text',
        text: 'Valor 2*3 e portal_meu_cliente',
      },
    ]);
  });

  it('detects quote, unordered list, ordered list and code block', () => {
    const blocks = parseWhatsAppTextBlocks([
      '> *Aviso* importante',
      '- Item 1',
      '- Item 2',
      '1. Primeiro',
      '2. Segundo',
      '```const total = 2;```',
    ].join('\n'));

    expect(blocks.map((block) => block.type)).toEqual([
      'quote',
      'unordered-list',
      'ordered-list',
      'code-block',
    ]);
    expect(blocks[3]?.text).toBe('const total = 2;');
  });
});

describe('renderWhatsAppTextBlocks', () => {
  it('renders supported formatting tags for frontend bubbles', () => {
    const html = renderToStaticMarkup(
      <Fragment>
        {renderWhatsAppTextBlocks(
          parseWhatsAppTextBlocks('*oi, _tudo bem_* ~teste~ `pix`'),
          { tone: 'agent' }
        )}
      </Fragment>
    );

    expect(html).toContain('<strong>oi, <em>tudo bem</em></strong>');
    expect(html).toContain('<s>teste</s>');
    expect(html).toContain('<code');
    expect(html).toContain('pix');
  });

  it('renders structural blocks for quote and lists', () => {
    const html = renderToStaticMarkup(
      <Fragment>
        {renderWhatsAppTextBlocks(
          parseWhatsAppTextBlocks('> resposta\n- item\n1. passo'),
          { tone: 'customer', compact: true }
        )}
      </Fragment>
    );

    expect(html).toContain('<blockquote');
    expect(html).toContain('<ul');
    expect(html).toContain('<ol');
  });

  it('renders detected phone numbers as clickable buttons when handler is provided', () => {
    const html = renderToStaticMarkup(
      <Fragment>
        {renderWhatsAppTextBlocks(
          parseWhatsAppTextBlocks('Chame no 88 99999-8888'),
          {
            tone: 'agent',
            onPhoneClick: () => undefined,
          }
        )}
      </Fragment>
    );

    expect(html).toContain('Telefone: 88 99999-8888');
    expect(html).toContain('<button');
  });
});
