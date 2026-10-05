/**
 * Fields from another content type (B1 in specs/website-docs-review.md):
 * publishing rebuilds the copy of the linked entry from its published
 * document, custom fields included, and drops an entry that is not published.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { published } = vi.hoisted(() => ({ published: {} as Record<string, Record<string, any>> }));

vi.mock('../init', () => ({
    db: {
        collection: (name: string) => ({ doc: (id: string) => ({ name, id }) }),
        getAll: async (...refs: { name: string; id: string }[]) => refs.map(({ name, id }) => {
            const data = published[`${name}/${id}`];
            return { id, exists: !!data, data: () => data };
        }),
    },
}));

import { linkedEntryCopy, refreshLinkedEntries } from '../shared/linked-entries.js';

const SPEAKER = {
    key: 'events-speaker', type: 'dropdown', useCollectionRef: true,
    collectionRef: { collectionSlug: 'speakers', displayField: 'title', syncFields: ['urlSlug', 'speakers-role'] },
};

describe('linked entries', () => {
    beforeEach(() => {
        for (const key of Object.keys(published)) delete published[key];
    });

    it('copies built-in and custom fields of the linked entry', () => {
        const copy = linkedEntryCopy(SPEAKER, 's1', { title: 'Dr Mehta', urlSlug: 'dr-mehta', customFields: { 'speakers-role': 'Chef' } });
        expect(copy).toEqual({ id: 's1', title: 'Dr Mehta', urlSlug: 'dr-mehta', 'speakers-role': 'Chef' });
    });

    it('rebuilds a stale copy from the entry as published now', async () => {
        published['arc_speakers/s1'] = { title: 'Dr Asha Mehta', urlSlug: 'asha-mehta', customFields: { 'speakers-role': 'Head chef' } };
        const fields = await refreshLinkedEntries(
            { 'events-speaker': 's1', '_ref_events-speaker': { id: 's1', title: 'Old name' } },
            [SPEAKER],
        );
        expect(fields['_ref_events-speaker']).toEqual({ id: 's1', title: 'Dr Asha Mehta', urlSlug: 'asha-mehta', 'speakers-role': 'Head chef' });
    });

    it('drops a linked entry that is not published', async () => {
        const fields = await refreshLinkedEntries({ 'events-speaker': 'gone', '_ref_events-speaker': { id: 'gone', title: 'Old' } }, [SPEAKER]);
        expect(fields).not.toHaveProperty('_ref_events-speaker');
    });

    it('keeps a list for a checkbox field, in the order chosen', async () => {
        published['arc_speakers/s1'] = { title: 'One' };
        published['arc_speakers/s2'] = { title: 'Two' };
        const field = { ...SPEAKER, key: 'events-panel', type: 'checkbox' };
        const fields = await refreshLinkedEntries({ 'events-panel': ['s2', 'missing', 's1'] }, [field]);
        expect(fields['_ref_events-panel'].map((c: any) => c.title)).toEqual(['Two', 'One']);
    });

    it('leaves fields that do not link to another type alone', async () => {
        const fields = await refreshLinkedEntries({ 'events-price': '25' }, [{ key: 'events-price', type: 'number' }]);
        expect(fields).toEqual({ 'events-price': '25' });
    });
});
