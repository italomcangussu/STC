// Portado do CRM Ibiapaba (`components/crm/whatsappTextFormatter.tsx`) sem mudanças de comportamento.
import { Fragment } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { splitTextByPhoneMatches } from './phoneDetection';

export type WhatsAppTextTone = 'customer' | 'agent' | 'ai';

type InlineSegmentType = 'text' | 'bold' | 'italic' | 'strike' | 'code';
type BlockType = 'paragraph' | 'quote' | 'unordered-list' | 'ordered-list' | 'code-block';

export interface WhatsAppInlineSegment {
  type: InlineSegmentType;
  text?: string;
  children?: WhatsAppInlineSegment[];
}

export interface WhatsAppTextBlock {
  type: BlockType;
  segments?: WhatsAppInlineSegment[];
  items?: WhatsAppInlineSegment[][];
  text?: string;
}

interface InlineMarkerDefinition {
  token: '`' | '*' | '_' | '~';
  type: Exclude<InlineSegmentType, 'text'>;
}

interface InlineMatch {
  start: number;
  end: number;
  marker: InlineMarkerDefinition;
}

interface RenderOptions {
  tone: WhatsAppTextTone;
  compact?: boolean;
  onPhoneClick?: (
    payload: {
      raw: string;
      normalized: string;
    },
    event: MouseEvent<HTMLButtonElement>
  ) => void;
  phoneClassName?: string;
}

const INLINE_MARKERS: InlineMarkerDefinition[] = [
  { token: '`', type: 'code' },
  { token: '*', type: 'bold' },
  { token: '_', type: 'italic' },
  { token: '~', type: 'strike' },
];

const QUOTE_LINE_RE = /^\s*>\s?(.*)$/;
const UNORDERED_LIST_RE = /^\s*-\s+(.*)$/;
const ORDERED_LIST_RE = /^\s*(\d+)\.\s+(.*)$/;
const BOUNDARY_RE = /[\s!-/:-@[-`{-~]/;

function isBoundaryCharacter(value?: string): boolean {
  return !value || BOUNDARY_RE.test(value);
}

function canOpenMarker(text: string, index: number, marker: InlineMarkerDefinition): boolean {
  const next = text[index + marker.token.length];
  if (!next || /\s/u.test(next)) return false;

  if (marker.type === 'code') return true;

  const previous = text[index - 1];
  return isBoundaryCharacter(previous);
}

function canCloseMarker(text: string, index: number, marker: InlineMarkerDefinition): boolean {
  const previous = text[index - 1];
  if (!previous || /\s/u.test(previous)) return false;

  if (marker.type === 'code') return true;

  const next = text[index + marker.token.length];
  return isBoundaryCharacter(next);
}

function findClosingMarker(text: string, fromIndex: number, marker: InlineMarkerDefinition): number {
  let cursor = text.indexOf(marker.token, fromIndex);

  while (cursor !== -1) {
    if (canCloseMarker(text, cursor, marker)) {
      return cursor;
    }
    cursor = text.indexOf(marker.token, cursor + marker.token.length);
  }

  return -1;
}

function findNextInlineMatch(text: string, fromIndex: number): InlineMatch | null {
  let earliestMatch: InlineMatch | null = null;

  for (const marker of INLINE_MARKERS) {
    let cursor = text.indexOf(marker.token, fromIndex);

    while (cursor !== -1) {
      if (!canOpenMarker(text, cursor, marker)) {
        cursor = text.indexOf(marker.token, cursor + marker.token.length);
        continue;
      }

      const closingIndex = findClosingMarker(text, cursor + marker.token.length, marker);
      if (closingIndex === -1) {
        cursor = text.indexOf(marker.token, cursor + marker.token.length);
        continue;
      }

      const innerText = text.slice(cursor + marker.token.length, closingIndex);
      if (!innerText.trim()) {
        cursor = text.indexOf(marker.token, cursor + marker.token.length);
        continue;
      }

      if (marker.type === 'code' && innerText.includes('\n')) {
        cursor = text.indexOf(marker.token, cursor + marker.token.length);
        continue;
      }

      const candidate = {
        start: cursor,
        end: closingIndex,
        marker,
      };

      if (!earliestMatch || candidate.start < earliestMatch.start) {
        earliestMatch = candidate;
      }

      break;
    }
  }

  return earliestMatch;
}

function mergeAdjacentTextSegments(segments: WhatsAppInlineSegment[]): WhatsAppInlineSegment[] {
  return segments.reduce<WhatsAppInlineSegment[]>((accumulator, segment) => {
    if (!segment.text && !segment.children?.length) return accumulator;

    const previous = accumulator[accumulator.length - 1];
    if (segment.type === 'text' && previous?.type === 'text') {
      previous.text = `${previous.text || ''}${segment.text || ''}`;
      return accumulator;
    }

    accumulator.push(segment);
    return accumulator;
  }, []);
}

export function parseWhatsAppInlineSegments(text: string): WhatsAppInlineSegment[] {
  const normalized = String(text || '');
  const segments: WhatsAppInlineSegment[] = [];
  let cursor = 0;

  while (cursor < normalized.length) {
    const match = findNextInlineMatch(normalized, cursor);

    if (!match) {
      segments.push({ type: 'text', text: normalized.slice(cursor) });
      break;
    }

    if (match.start > cursor) {
      segments.push({ type: 'text', text: normalized.slice(cursor, match.start) });
    }

    const innerText = normalized.slice(match.start + match.marker.token.length, match.end);

    if (match.marker.type === 'code') {
      segments.push({
        type: 'code',
        text: innerText,
      });
    } else {
      const children = parseWhatsAppInlineSegments(innerText);
      segments.push({
        type: match.marker.type,
        children: children.length > 0 ? children : [{ type: 'text', text: innerText }],
      });
    }

    cursor = match.end + match.marker.token.length;
  }

  return mergeAdjacentTextSegments(segments);
}

function readCodeBlock(lines: string[], startIndex: number): { text: string; nextIndex: number } | null {
  const firstLine = lines[startIndex];
  const openingIndex = firstLine.indexOf('```');
  if (openingIndex === -1) return null;

  const remainder = firstLine.slice(openingIndex + 3);
  const inlineClosingIndex = remainder.indexOf('```');

  if (inlineClosingIndex !== -1) {
    return {
      text: remainder.slice(0, inlineClosingIndex),
      nextIndex: startIndex + 1,
    };
  }

  const codeLines = [remainder];

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const currentLine = lines[index];
    const closingIndex = currentLine.indexOf('```');

    if (closingIndex !== -1) {
      codeLines.push(currentLine.slice(0, closingIndex));
      return {
        text: codeLines.join('\n'),
        nextIndex: index + 1,
      };
    }

    codeLines.push(currentLine);
  }

  return null;
}

export function parseWhatsAppTextBlocks(text: string): WhatsAppTextBlock[] {
  const normalized = String(text || '').replace(/\r\n?/g, '\n');
  if (!normalized.trim()) return [];

  const lines = normalized.split('\n');
  const blocks: WhatsAppTextBlock[] = [];
  let paragraphLines: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    blocks.push({
      type: 'paragraph',
      segments: parseWhatsAppInlineSegments(paragraphLines.join('\n')),
    });
    paragraphLines = [];
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      flushParagraph();
      index += 1;
      continue;
    }

    if (line.trimStart().startsWith('```')) {
      const codeBlock = readCodeBlock(lines, index);
      if (codeBlock) {
        flushParagraph();
        blocks.push({
          type: 'code-block',
          text: codeBlock.text,
        });
        index = codeBlock.nextIndex;
        continue;
      }
    }

    if (QUOTE_LINE_RE.test(line)) {
      flushParagraph();
      const quotedLines: string[] = [];

      while (index < lines.length) {
        const match = lines[index].match(QUOTE_LINE_RE);
        if (!match) break;
        quotedLines.push(match[1] || '');
        index += 1;
      }

      blocks.push({
        type: 'quote',
        segments: parseWhatsAppInlineSegments(quotedLines.join('\n')),
      });
      continue;
    }

    if (UNORDERED_LIST_RE.test(line)) {
      flushParagraph();
      const items: WhatsAppInlineSegment[][] = [];

      while (index < lines.length) {
        const match = lines[index].match(UNORDERED_LIST_RE);
        if (!match) break;
        items.push(parseWhatsAppInlineSegments(match[1] || ''));
        index += 1;
      }

      blocks.push({
        type: 'unordered-list',
        items,
      });
      continue;
    }

    if (ORDERED_LIST_RE.test(line)) {
      flushParagraph();
      const items: WhatsAppInlineSegment[][] = [];

      while (index < lines.length) {
        const match = lines[index].match(ORDERED_LIST_RE);
        if (!match) break;
        items.push(parseWhatsAppInlineSegments(match[2] || ''));
        index += 1;
      }

      blocks.push({
        type: 'ordered-list',
        items,
      });
      continue;
    }

    paragraphLines.push(line);
    index += 1;
  }

  flushParagraph();
  return blocks;
}

function getToneClasses(tone: WhatsAppTextTone) {
  switch (tone) {
    case 'customer':
      return {
        inlineCode: 'bg-emerald-200/70 text-emerald-950 dark:bg-emerald-400/20 dark:text-emerald-50',
        codeBlock: 'border border-emerald-300/80 bg-emerald-50/90 text-emerald-950 dark:border-emerald-400/25 dark:bg-emerald-950/18 dark:text-emerald-50',
        quote: 'border-emerald-500/35 text-emerald-950 dark:border-emerald-300/25 dark:text-emerald-50',
      };
    case 'ai':
      return {
        inlineCode: 'bg-orange-200/80 text-orange-800 dark:bg-orange-500/20 dark:text-orange-100',
        codeBlock: 'border border-orange-200 bg-orange-50/80 text-orange-900 dark:border-orange-400/35 dark:bg-orange-500/10 dark:text-orange-50',
        quote: 'border-orange-300 text-orange-800 dark:border-orange-400/35 dark:text-orange-100',
      };
    default:
      return {
        inlineCode: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100',
        codeBlock: 'border border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-600/80 dark:bg-slate-800/90 dark:text-slate-100',
        quote: 'border-slate-300 text-slate-700 dark:border-slate-500 dark:text-slate-200',
      };
  }
}

export function renderWhatsAppInlineSegments(
  segments: WhatsAppInlineSegment[],
  options: RenderOptions,
  keyPrefix: string,
): ReactNode[] {
  const toneClasses = getToneClasses(options.tone);
  const inlineCodeSize = options.compact ? 'text-[0.95em]' : 'text-[0.92em]';

  return segments.map((segment, index) => {
    const key = `${keyPrefix}-${index}`;

    switch (segment.type) {
      case 'bold':
        return <strong key={key}>{renderWhatsAppInlineSegments(segment.children || [], options, key)}</strong>;
      case 'italic':
        return <em key={key}>{renderWhatsAppInlineSegments(segment.children || [], options, key)}</em>;
      case 'strike':
        return <s key={key}>{renderWhatsAppInlineSegments(segment.children || [], options, key)}</s>;
      case 'code':
        return (
          <code
            key={key}
            className={`rounded px-1 py-0.5 font-mono ${inlineCodeSize} ${toneClasses.inlineCode}`}
          >
            {segment.text}
          </code>
        );
      default: {
        if (!options.onPhoneClick) {
          return <Fragment key={key}>{segment.text}</Fragment>;
        }

        const text = String(segment.text || '');
        const parts = splitTextByPhoneMatches(text);
        const hasDetectedPhone = parts.some((part) => part.type === 'phone');
        if (!hasDetectedPhone) {
          return <Fragment key={key}>{text}</Fragment>;
        }

        const phoneClassName = options.phoneClassName || [
          'inline rounded-sm border-0 bg-transparent p-0 align-baseline',
          'font-medium text-blue-600 underline decoration-blue-500 decoration-1 underline-offset-2',
          'transition-colors hover:text-blue-700',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70 focus-visible:ring-offset-1',
        ].join(' ');

        return (
          <Fragment key={key}>
            {parts.map((part, partIndex) => {
              const partKey = `${key}-part-${partIndex}`;
              if (part.type === 'text') {
                return <Fragment key={partKey}>{part.value}</Fragment>;
              }

              return (
                <button
                  key={partKey}
                  type="button"
                  className={phoneClassName}
                  data-no-swipe-reply="true"
                  data-phone-link="true"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    options.onPhoneClick?.(
                      {
                        raw: part.value,
                        normalized: part.normalized,
                      },
                      event
                    );
                  }}
                  aria-label={`Telefone: ${part.value}`}
                >
                  {part.value}
                </button>
              );
            })}
          </Fragment>
        );
      }
    }
  });
}

export function renderWhatsAppTextBlocks(
  blocks: WhatsAppTextBlock[],
  options: RenderOptions,
): ReactNode[] {
  if (blocks.length === 0) return [];

  const toneClasses = getToneClasses(options.tone);
  const textSizeClass = options.compact ? 'text-xs' : 'text-sm';
  const codeBlockTextSizeClass = options.compact ? 'text-[11px]' : 'text-[13px]';

  return blocks.map((block, index) => {
    const key = `whatsapp-block-${index}`;

    switch (block.type) {
      case 'quote':
        return (
          <blockquote
            key={key}
            className={`border-l-2 pl-3 italic whitespace-pre-wrap wrap-break-word leading-relaxed ${textSizeClass} ${toneClasses.quote}`}
          >
            {renderWhatsAppInlineSegments(block.segments || [], options, key)}
          </blockquote>
        );
      case 'unordered-list':
        return (
          <ul
            key={key}
            className={`list-disc space-y-1 pl-5 wrap-break-word leading-relaxed ${textSizeClass}`}
          >
            {(block.items || []).map((item, itemIndex) => (
              <li key={`${key}-item-${itemIndex}`}>
                {renderWhatsAppInlineSegments(item, options, `${key}-item-${itemIndex}`)}
              </li>
            ))}
          </ul>
        );
      case 'ordered-list':
        return (
          <ol
            key={key}
            className={`list-decimal space-y-1 pl-5 wrap-break-word leading-relaxed ${textSizeClass}`}
          >
            {(block.items || []).map((item, itemIndex) => (
              <li key={`${key}-item-${itemIndex}`}>
                {renderWhatsAppInlineSegments(item, options, `${key}-item-${itemIndex}`)}
              </li>
            ))}
          </ol>
        );
      case 'code-block':
        return (
          <pre
            key={key}
            className={`overflow-x-auto whitespace-pre-wrap wrap-break-word rounded-lg px-3 py-2 font-mono leading-relaxed ${codeBlockTextSizeClass} ${toneClasses.codeBlock}`}
          >
            {block.text}
          </pre>
        );
      default:
        return (
          <p
            key={key}
            className={`whitespace-pre-wrap wrap-break-word leading-relaxed ${textSizeClass}`}
          >
            {renderWhatsAppInlineSegments(block.segments || [], options, key)}
          </p>
        );
    }
  });
}
