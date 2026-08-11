import { describe, it, expect } from 'vitest';
import { dedupeTemplatesByType } from './template-dedupe';

describe('dedupeTemplatesByType', () => {
    it('collapses docs that share a type, keeping the first', () => {
        const docs = [
            { id: 'a1', type: 'waitlist_welcome_email', title: 'Waitlist welcome email' },
            { id: 'a2', type: 'waitlist_welcome_email', title: 'Waitlist welcome email' },
            { id: 'a3', type: 'waitlist_verify_otp_email', title: 'Waitlist verify OTP Email' },
            { id: 'a4', type: 'waitlist_verify_otp_email', title: 'Waitlist verify OTP Email' },
        ];
        const out = dedupeTemplatesByType(docs);
        expect(out.map((d) => d.id)).toEqual(['a1', 'a3']);
    });

    it('leaves a collection with unique types unchanged', () => {
        const docs = [
            { id: 'signup_otp_email', type: 'signup_otp_email' },
            { id: 'signup_welcome_email', type: 'signup_welcome_email' },
        ];
        expect(dedupeTemplatesByType(docs)).toHaveLength(2);
    });

    it('preserves order and falls back to id when type is missing', () => {
        const docs = [
            { id: 'x1' },
            { id: 'x1' }, // same id, no type → deduped
            { id: 'x2' },
        ];
        expect(dedupeTemplatesByType(docs).map((d) => d.id)).toEqual(['x1', 'x2']);
    });

    it('returns an empty array unchanged', () => {
        expect(dedupeTemplatesByType([])).toEqual([]);
    });
});
