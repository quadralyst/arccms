import { describe, it, expect } from 'vitest';
import { draftAsCard } from './preview-session';
import { UNSAVED_DRAFT_ID } from '../../page.parts/card-draft';

describe('draftAsCard (VE2.2)', () => {
    const now = new Date('2026-11-17T12:00:00Z');

    it('a saved draft keeps its id and publish date, and counts as published', () => {
        const card = draftAsCard({ content: { id: 'e1', title: 'T', publishedOn: '2026-01-01', publishedStatus: false }, lang: '', translation: null }, now);
        expect(card).toMatchObject({ id: 'e1', title: 'T', publishedOn: '2026-01-01', publishedStatus: true });
    });

    it('a draft never saved stands under a fixed id and sorts as the newest', () => {
        const card = draftAsCard({ content: { id: '', title: 'New' }, lang: '', translation: null }, now);
        expect(card['id']).toBe(UNSAVED_DRAFT_ID);
        expect(card['publishedOn']).toBe(now.toISOString());
    });

    it('a never published draft sorts by when it was made', () => {
        expect(draftAsCard({ content: { id: 'e1', createdAt: '2026-05-05' }, lang: '', translation: null }, now)['publishedOn']).toBe('2026-05-05');
    });

    it('shows the translation on screen', () => {
        const card = draftAsCard({ content: { id: 'e1', title: 'Hello', summary: 'S' }, lang: 'hi', translation: { lang: 'hi', title: 'नमस्ते' } as any }, now);
        expect(card['title']).toBe('नमस्ते');
        expect(card['summary']).toBe('S');
    });
});
