export const normalizePhoneDigits = (phone: string): string => phone.replace(/\D/g, '');

export const normalizePhoneBr = (phone: string): string => {
    const digits = normalizePhoneDigits(phone);
    if (!digits) return '';

    if (digits.startsWith('55') && digits.length >= 12) {
        return digits;
    }

    if (digits.length === 10 || digits.length === 11) {
        return `55${digits}`;
    }

    if (digits.length > 11) {
        return `55${digits.slice(-11)}`;
    }

    return digits;
};

export const toE164Phone = (phone: string): string => {
    const normalized = normalizePhoneBr(phone);
    if (!normalized) return '';
    return `+${normalized}`;
};

export const buildPhoneCandidates = (phone: string): string[] => {
    const normalized = normalizePhoneBr(phone);
    const digits = normalizePhoneDigits(phone);
    const local = normalized.startsWith('55') ? normalized.slice(2) : normalized;

    return Array.from(new Set([normalized, digits, local].filter(Boolean)));
};
