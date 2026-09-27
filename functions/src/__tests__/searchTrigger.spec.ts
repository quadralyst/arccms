/**
 * The wildcard trigger fires for every top-level write in the database. It
 * must cost nothing for collections no source watches, and index the rest.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-functions/v2/firestore', () => ({
    onDocumentWritten: vi.fn((_path: string, handler: unknown) => handler),
}));

const indexDocument = vi.fn().mockResolvedValue(1);
const buildSearchContext = vi.fn(async (collection: string, docId: string) => ({
    collection, docId, localization: { defaultLanguage: 'en', enabledLanguages: [] }, contentTypes: new Map(),
}));

vi.mock('../search/writer.js', () => ({ indexDocument: (...args: unknown[]) => indexDocument(...args) }));
vi.mock('../search/context.js', () => ({
    buildSearchContext: (...args: unknown[]) => buildSearchContext(...(args as [string, string])),
    loadContentTypes: vi.fn(),
    clearSearchContextCache: vi.fn(),
}));
vi.mock('../init.js', () => ({ db: {}, owner: {} }));

import { onAnyDocumentWritten, onTranslationWritten, syncDocument } from '../search/onAnyDocumentWritten.js';
import { findSources } from '../search/registry.js';

type Handler = (event: { params: Record<string, string>; data?: unknown }) => Promise<void>;
const handler = onAnyDocumentWritten as unknown as Handler;
const translationHandler = onTranslationWritten as unknown as Handler;

beforeEach(() => {
    indexDocument.mockClear();
    buildSearchContext.mockClear();
});

describe('registry', () => {
    it('matches draft and published content collections to their sources', () => {
        expect(findSources('arc_articles_drafts').map(s => s.id)).toEqual(['content-drafts']);
        expect(findSources('arc_articles').map(s => s.id)).toEqual(['content']);
        expect(findSources('EmailLogs')).toEqual([]);
        expect(findSources('SearchIndex')).toEqual([]);
    });
});

describe('onAnyDocumentWritten', () => {
    it('does nothing at all for an unregistered collection', async () => {
        await handler({ params: { collection: 'EmailLogs', docId: 'x' }, data: { after: { exists: true, data: () => ({}) } } });
        expect(buildSearchContext).not.toHaveBeenCalled();
        expect(indexDocument).not.toHaveBeenCalled();
    });

    it('indexes a draft write', async () => {
        const doc = { title: 'Hello' };
        await handler({
            params: { collection: 'arc_articles_drafts', docId: 'a1' },
            data: { after: { exists: true, data: () => doc } },
        });
        expect(buildSearchContext).toHaveBeenCalledWith('arc_articles_drafts', 'a1');
        expect(indexDocument).toHaveBeenCalledTimes(1);
        expect(indexDocument.mock.calls[0][0]).toMatchObject({ id: 'content-drafts' });
        expect(indexDocument.mock.calls[0][1]).toBe(doc);
    });

    it('passes null on delete so the entries are removed', async () => {
        await handler({
            params: { collection: 'arc_articles_drafts', docId: 'a1' },
            data: { after: { exists: false } },
        });
        expect(indexDocument.mock.calls[0][1]).toBeNull();
    });

    it('leaves trigger:false sources to their explicit writer', async () => {
        await handler({
            params: { collection: 'arc_articles', docId: 'a1' },
            data: { after: { exists: true, data: () => ({ title: 'Hello' }) } },
        });
        expect(indexDocument).not.toHaveBeenCalled();
    });

    it('survives a failing source without throwing', async () => {
        indexDocument.mockRejectedValueOnce(new Error('boom'));
        const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await expect(syncDocument('arc_articles_drafts', 'a1', { title: 'x' })).resolves.toBeUndefined();
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });
});

describe('onTranslationWritten', () => {
    it('re-indexes the parent document', async () => {
        const parentData = { title: 'Parent' };
        const parent = { get: vi.fn().mockResolvedValue({ exists: true, data: () => parentData }) };
        await translationHandler({
            params: { collection: 'arc_articles_drafts', docId: 'a1', lang: 'hi' },
            data: { after: { ref: { parent: { parent } } } },
        });
        expect(indexDocument).toHaveBeenCalledTimes(1);
        expect(indexDocument.mock.calls[0][1]).toBe(parentData);
    });

    it('ignores translations of unregistered collections', async () => {
        await translationHandler({ params: { collection: 'Other', docId: 'a1', lang: 'hi' }, data: {} });
        expect(indexDocument).not.toHaveBeenCalled();
    });
});
