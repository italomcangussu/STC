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

    it('keeps local BR phone for storage', () => {
        expect(normalizePhoneBr('88999991234')).toBe('88999991234');
    });

    it('removes 55 country code for local storage', () => {
        expect(normalizePhoneBr('558899991234')).toBe('8899991234');
    });

    it('converts to e164 format', () => {
        expect(toE164Phone('(88) 99999-1234')).toBe('+5588999991234');
    });

    it('builds unique candidate variations', () => {
        const candidates = buildPhoneCandidates('(88) 99999-1234');
        expect(candidates).toContain('88999991234');
        expect(candidates).toContain('5588999991234');
        expect(candidates).toContain('+5588999991234');
    });
});
