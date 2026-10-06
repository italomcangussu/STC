// Portado do CRM Ibiapaba (`components/crm/phoneDetection.ts`), com o
// `normalizePhone` de `services/crm/utils.ts` trazido para cá.

/** Forma canônica 55 + DDD + 8 dígitos (sem o 9 do celular), como no CRM. */
function normalizePhone(phone: string): { normalized: string; isValid: boolean } {
  let cleaned = String(phone || '').replace(/\D/g, '');
  if (cleaned.length === 10 || cleaned.length === 11) cleaned = '55' + cleaned;
  if (cleaned.length === 13 && cleaned.startsWith('55') && cleaned[4] === '9') {
    cleaned = cleaned.substring(0, 4) + cleaned.substring(5);
  }
  return { normalized: cleaned, isValid: cleaned.length === 12 && cleaned.startsWith('55') };
}

export interface DetectedPhoneMatch {
  raw: string;
  normalized: string;
  start: number;
  end: number;
}

export type PhoneTextPart =
  | { type: 'text'; value: string }
  | { type: 'phone'; value: string; normalized: string };

const PHONE_CANDIDATE_REGEX = /(?:\+?55[\s().-]*)?\(?\d{2}\)?[\s.-]*(?:9[\s.-]*)?\d{4}[\s.-]*\d{4}/g;

const isDigit = (value?: string): boolean => Boolean(value && /\d/.test(value));

export function extractPhoneMatches(text: string): DetectedPhoneMatch[] {
  const source = String(text || '');
  if (!source) return [];

  const matches: DetectedPhoneMatch[] = [];
  let candidate: RegExpExecArray | null = null;

  while ((candidate = PHONE_CANDIDATE_REGEX.exec(source)) !== null) {
    const raw = String(candidate[0] || '');
    const start = candidate.index;
    const end = start + raw.length;

    if (isDigit(source[start - 1]) || isDigit(source[end])) {
      continue;
    }

    const normalized = normalizePhone(raw);
    if (!normalized.isValid) {
      continue;
    }

    const overlapsExistingMatch = matches.some((existing) => (
      start < existing.end && end > existing.start
    ));
    if (overlapsExistingMatch) {
      continue;
    }

    matches.push({
      raw,
      normalized: normalized.normalized,
      start,
      end,
    });
  }

  return matches;
}

export function splitTextByPhoneMatches(text: string): PhoneTextPart[] {
  const source = String(text || '');
  if (!source) return [];

  const matches = extractPhoneMatches(source);
  if (matches.length === 0) {
    return [{ type: 'text', value: source }];
  }

  const parts: PhoneTextPart[] = [];
  let cursor = 0;

  matches.forEach((match) => {
    if (match.start > cursor) {
      parts.push({
        type: 'text',
        value: source.slice(cursor, match.start),
      });
    }

    parts.push({
      type: 'phone',
      value: source.slice(match.start, match.end),
      normalized: match.normalized,
    });

    cursor = match.end;
  });

  if (cursor < source.length) {
    parts.push({
      type: 'text',
      value: source.slice(cursor),
    });
  }

  return parts;
}
