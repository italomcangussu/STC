export const normalizePhoneDigits = (phone: string): string => phone.replace(/\D/g, '');

export const normalizePhoneBr = (phone: string): string => {
    const digits = normalizePhoneDigits(phone);
    if (!digits) return '';

    // Keep storage local (DDD + number), without country code
    let local = digits;

    if (local.startsWith('55') && local.length >= 12) {
        local = local.slice(2);
    }

    if (local.length > 11) {
        local = local.slice(-11);
    }

    return local;
};

export const toE164Phone = (phone: string): string => {
    const local = normalizePhoneBr(phone);
    if (!local) return '';
    return `+55${local}`;
};

export const buildPhoneCandidates = (phone: string): string[] => {
    const local = normalizePhoneBr(phone);
    const digits = normalizePhoneDigits(phone);
    const withCountry = local ? `55${local}` : '';
    const withPlusCountry = local ? `+55${local}` : '';

    return Array.from(new Set([local, withCountry, withPlusCountry, digits].filter(Boolean)));
};
