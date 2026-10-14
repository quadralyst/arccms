import { describe, it, expect } from 'vitest';
import {
    backlinkValue,
    isRealId,
    planBacklinks,
    refreshedReference,
    seriesReference,
} from './series-links';

const ref = (id: string, title = id.toUpperCase()) => ({ id, title, summary: '', slug: id });
const OWNER = ref('a', 'Part A');

describe('series links', () => {
    describe('seriesReference', () => {
        it('copies the title, meta description and slug', () => {
            expect(seriesReference('x', { title: 'X', metaDescription: 'About x', urlSlug: 'x-slug' }))
                .toEqual({ id: 'x', title: 'X', summary: 'About x', slug: 'x-slug' });
        });

        it('stores empty text for missing values', () => {
            expect(seriesReference('x', {})).toEqual({ id: 'x', title: '', summary: '', slug: '' });
        });
    });

    describe('planBacklinks', () => {
        it('asks nothing of an entry without a real id, so no "temp-id" is ever written', () => {
            expect(planBacklinks('', null, { nextContent: ref('b') })).toEqual([]);
            expect(planBacklinks('temp-id', null, { nextContent: ref('b') })).toEqual([]);
        });

        it('sets the Previous of the new Next, and the Next of the new Previous', () => {
            expect(planBacklinks('a', null, { nextContent: ref('b'), previousContent: ref('p') })).toEqual([
                { targetId: 'b', field: 'previousContent', action: 'set' },
                { targetId: 'p', field: 'nextContent', action: 'set' },
            ]);
        });

        it('clears the backlink of an entry that is no longer picked', () => {
            expect(planBacklinks('a', { nextContent: ref('b') }, { nextContent: null })).toEqual([
                { targetId: 'b', field: 'previousContent', action: 'clear' },
            ]);
            expect(planBacklinks('a', { previousContent: ref('p') }, { previousContent: null })).toEqual([
                { targetId: 'p', field: 'nextContent', action: 'clear' },
            ]);
        });

        it('clears the old target and sets the new one when Next changes', () => {
            expect(planBacklinks('a', { nextContent: ref('b') }, { nextContent: ref('c') })).toEqual([
                { targetId: 'b', field: 'previousContent', action: 'clear' },
                { targetId: 'c', field: 'previousContent', action: 'set' },
            ]);
        });

        it('re-asserts an unchanged link, which also refreshes a renamed entry', () => {
            expect(planBacklinks('a', { nextContent: ref('b') }, { nextContent: ref('b') })).toEqual([
                { targetId: 'b', field: 'previousContent', action: 'set' },
            ]);
        });

        it('ignores a link to the entry itself and a stored "temp-id"', () => {
            expect(planBacklinks('a', null, { nextContent: ref('a') })).toEqual([]);
            expect(planBacklinks('a', { nextContent: ref('temp-id') }, { nextContent: null })).toEqual([]);
        });
    });

    describe('backlinkValue', () => {
        it('sets an empty backlink', () => {
            expect(backlinkValue(null, 'set', OWNER)).toEqual(OWNER);
            expect(backlinkValue(undefined, 'set', OWNER)).toEqual(OWNER);
        });

        it('never overwrites a backlink an editor pointed at another entry', () => {
            expect(backlinkValue(ref('z'), 'set', OWNER)).toBeUndefined();
        });

        it('refreshes a backlink that already points here when the copy is stale', () => {
            expect(backlinkValue({ ...OWNER, title: 'Old title' }, 'set', OWNER)).toEqual(OWNER);
        });

        it('writes nothing when the backlink is already right', () => {
            expect(backlinkValue({ ...OWNER }, 'set', OWNER)).toBeUndefined();
        });

        it('repairs a "temp-id" backlink left by older versions', () => {
            expect(backlinkValue(ref('temp-id'), 'set', OWNER)).toEqual(OWNER);
        });

        it('clears a backlink only while it points here', () => {
            expect(backlinkValue({ ...OWNER }, 'clear', OWNER)).toBeNull();
            expect(backlinkValue(ref('z'), 'clear', OWNER)).toBeUndefined();
            expect(backlinkValue(null, 'clear', OWNER)).toBeUndefined();
        });
    });

    describe('refreshedReference', () => {
        it('returns the new copy for a stale link to the entry', () => {
            expect(refreshedReference({ ...OWNER, slug: 'old' }, OWNER)).toEqual(OWNER);
        });

        it('returns nothing for a current copy or a link to another entry', () => {
            expect(refreshedReference({ ...OWNER }, OWNER)).toBeUndefined();
            expect(refreshedReference(ref('z'), OWNER)).toBeUndefined();
            expect(refreshedReference(null, OWNER)).toBeUndefined();
        });
    });

    it('treats "temp-id" and blanks as no id', () => {
        expect(isRealId('temp-id')).toBe(false);
        expect(isRealId('')).toBe(false);
        expect(isRealId(undefined)).toBe(false);
        expect(isRealId('abc')).toBe(true);
    });
});
