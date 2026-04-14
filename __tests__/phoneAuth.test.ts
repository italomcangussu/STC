import { describe, it, expect } from 'vitest';
import {
    normalizePhoneDigits,
    normalizePhoneBr,
    toE164Phone,
    buildPhoneCandidates
} from '../lib/phoneAuth';

describe('phoneAuth helpers', () => {
    it('normalizes non-digit characters', () => {
        expect(normalizePhoneDigits('(88) 99999-1234')).toBe('88999991234');
    });

    it('normalizes BR local phone to 55-prefixed', () => {
        expect(normalizePhoneBr('88999991234')).toBe('5588999991234');
    });

    it('keeps 55-prefixed numbers unchanged', () => {
        expect(normalizePhoneBr('558899991234')).toBe('558899991234');
    });

    it('converts to e164 format', () => {
        expect(toE164Phone('(88) 99999-1234')).toBe('+5588999991234');
    });

    it('builds unique candidate variations', () => {
        const candidates = buildPhoneCandidates('(88) 99999-1234');
        expect(candidates).toContain('5588999991234');
        expect(candidates).toContain('88999991234');
    });
});
