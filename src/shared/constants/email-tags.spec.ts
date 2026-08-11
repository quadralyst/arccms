import { describe, it, expect } from 'vitest';
import {
    EMAIL_TAG,
    filterEmailTags,
    findActiveHashToken,
    getComposerTags,
    getEmailTags,
    insertTagMention,
    normalizeTagQuery,
    replaceHashToken,
} from './email-tags';

describe('getEmailTags', () => {
    it('returns the per-context tag list', () => {
        expect(getEmailTags('waitlist_verify_otp_email')).toEqual([
            EMAIL_TAG.NAME, EMAIL_TAG.EMAIL, EMAIL_TAG.OTP,
        ]);
        expect(getEmailTags('waitlist_welcome_email')).toEqual([
            EMAIL_TAG.NAME, EMAIL_TAG.EMAIL, EMAIL_TAG.POSITION,
            EMAIL_TAG.REFERRAL_CODE, EMAIL_TAG.REFERRAL_LINK,
        ]);
        expect(getEmailTags('broadcast')).toContain(EMAIL_TAG.UNSUBSCRIBE_LINK);
        expect(getEmailTags('brand_kit_footer')).toEqual([
            EMAIL_TAG.COMPANY_NAME, EMAIL_TAG.UNSUBSCRIBE_LINK, EMAIL_TAG.PREFERENCES_LINK,
        ]);
    });

    it('returns a fresh copy so callers cannot mutate the registry', () => {
        const first = getEmailTags('broadcast');
        first.push('##HACK##');
        expect(getEmailTags('broadcast')).not.toContain('##HACK##');
    });
});

describe('getComposerTags', () => {
    it('adds OTP for otp-type templates', () => {
        expect(getComposerTags('signup_otp_email')).toContain(EMAIL_TAG.OTP);
    });

    it('adds payment tags for payment-type templates', () => {
        const tags = getComposerTags('payment_receipt');
        expect(tags).toContain(EMAIL_TAG.PAYMENT_AMOUNT);
        expect(tags).toContain(EMAIL_TAG.RENEWAL_DATE);
    });

    it('falls back to the common composer set', () => {
        expect(getComposerTags('welcome')).toEqual(getEmailTags('composer_common'));
        expect(getComposerTags(undefined)).toEqual(getEmailTags('composer_common'));
    });
});

describe('normalizeTagQuery', () => {
    it('strips hashes and lowercases', () => {
        expect(normalizeTagQuery('##NAME##')).toBe('name');
        expect(normalizeTagQuery('Na')).toBe('na');
    });
});

describe('filterEmailTags', () => {
    const tags = ['##NAME##', '##EMAIL##', '##COMPANY_NAME##'];

    it('returns the whole list (capped) for an empty query', () => {
        expect(filterEmailTags(tags, '')).toEqual(tags);
    });

    it('matches case-insensitively and ignores surrounding hashes', () => {
        expect(filterEmailTags(tags, 'name')).toEqual(['##NAME##', '##COMPANY_NAME##']);
        expect(filterEmailTags(tags, '#NAME')).toEqual(['##NAME##', '##COMPANY_NAME##']);
    });

    it('returns an empty array when nothing matches', () => {
        expect(filterEmailTags(tags, 'zzz')).toEqual([]);
    });

    it('respects the limit', () => {
        const many = Array.from({ length: 20 }, (_, i) => `##TAG${i}##`);
        expect(filterEmailTags(many, '', 5)).toHaveLength(5);
    });

    it('tolerates null tag input', () => {
        expect(filterEmailTags(null as unknown as string[], 'x')).toEqual([]);
    });
});

describe('findActiveHashToken', () => {
    it('detects a bare # at the caret', () => {
        expect(findActiveHashToken('Hi #', 4)).toEqual({ hashIndex: 3, query: '' });
    });

    it('captures the query after a single #', () => {
        expect(findActiveHashToken('Hi #na', 6)).toEqual({ hashIndex: 3, query: 'na' });
    });

    it('anchors to the first # of a ## run', () => {
        expect(findActiveHashToken('Hi ##na', 7)).toEqual({ hashIndex: 3, query: 'na' });
    });

    it('triggers mid-word (no whitespace requirement)', () => {
        expect(findActiveHashToken('abc#def', 7)).toEqual({ hashIndex: 3, query: 'def' });
    });

    it('returns null when whitespace separates # from the caret', () => {
        expect(findActiveHashToken('Hi # na', 7)).toBeNull();
    });

    it('returns null when there is no # before the caret', () => {
        expect(findActiveHashToken('Hello', 5)).toBeNull();
    });

    it('only considers text before the caret', () => {
        expect(findActiveHashToken('#name', 0)).toBeNull();
        expect(findActiveHashToken('a #name here', 3)).toEqual({ hashIndex: 2, query: '' });
    });
});

describe('replaceHashToken', () => {
    it('replaces a bare # with the tag and a trailing space', () => {
        expect(replaceHashToken('Hi #', 4, 3, '##NAME##')).toEqual({
            value: 'Hi ##NAME## ',
            caret: 12,
        });
    });

    it('replaces a partially typed token', () => {
        expect(replaceHashToken('Hi #na', 6, 3, '##NAME##')).toEqual({
            value: 'Hi ##NAME## ',
            caret: 12,
        });
    });

    it('replaces a ## run without leaving a stray hash', () => {
        const out = replaceHashToken('Hi ##na', 7, 3, '##NAME##');
        expect(out.value).toBe('Hi ##NAME## ');
    });

    it('preserves text after the caret', () => {
        expect(replaceHashToken('Hi #na world', 6, 3, '##NAME##').value).toBe(
            'Hi ##NAME##  world',
        );
    });
});

describe('insertTagMention', () => {
    it('deletes the range and inserts the plain ##TAG## text with a trailing space', () => {
        const calls: unknown[][] = [];
        const chain = {
            focus() { calls.push(['focus']); return this; },
            deleteRange(range: unknown) { calls.push(['deleteRange', range]); return this; },
            insertContent(content: unknown) { calls.push(['insertContent', content]); return this; },
            run() { calls.push(['run']); return true; },
        };
        const editor = { chain: () => chain };

        insertTagMention(editor, { from: 3, to: 6 }, '##NAME##');

        expect(calls).toEqual([
            ['focus'],
            ['deleteRange', { from: 3, to: 6 }],
            ['insertContent', '##NAME## '],
            ['run'],
        ]);
    });
});
