/**
 * The published standard pages for the footer (shared/site-info-source.ts,
 * specs/site-sections-spec.md SS6).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { state } = vi.hoisted(() => ({
    state: {
        type: null as Record<string, unknown> | null,
        entries: [] as Record<string, unknown>[],
        translations: {} as Record<string, Record<string, unknown>>,
        reads: 0,
    },
}));

vi.mock('../init', () => ({
    db: {
        collection: (name: string) => {
            if (name === 'ContentTypes') {
                return { where: () => ({ limit: () => ({ get: async () => ({ empty: !state.type, docs: state.type ? [{ data: () => state.type }] : [] }) }) }) };
            }
            return {
                doc: (id: string) => ({
                    collection: () => ({
                        doc: (lang: string) => ({
                            get: async () => {
                                const t = state.translations[`${id}:${lang}`];
                                return { exists: !!t, data: () => t };
                            },
                        }),
                    }),
                }),
            };
        },
    },
}));
vi.mock('../pages/published-entries', () => ({
    readPublishedInDisplayOrder: async () => { state.reads++; return state.entries; },
}));
vi.mock('../shared/site-settings', () => ({ getAboutConfig: async () => ({ name: 'Kumar', sameAs: [] }) }));

import { clearSiteInfoCache, siteInfoFor, standardPageLinks } from '../shared/site-info-source.js';

describe('standard pages for the footer', () => {
    beforeEach(() => {
        clearSiteInfoCache();
        state.type = { slug: 'info', standard: 'pages', entryOrder: 'manual' };
        state.entries = [{ id: 'a', title: 'About', urlSlug: 'about' }, { id: 't', title: 'Terms', urlSlug: 'terms' }];
        state.translations = { 'a:hi': { title: 'हमारे बारे में' } };
        state.reads = 0;
    });

    it('lists the published pages in their order, at /info/{page}', async () => {
        expect(await standardPageLinks('en', 'en')).toEqual([{ title: 'About', url: '/info/about' }, { title: 'Terms', url: '/info/terms' }]);
    });

    it('titles them in the page\'s language, keeping the default title where none is translated', async () => {
        expect(await standardPageLinks('hi', 'en')).toEqual([{ title: 'हमारे बारे में', url: '/info/about' }, { title: 'Terms', url: '/info/terms' }]);
    });

    it('lists none without the Pages type, or with its public pages off', async () => {
        state.type = null;
        expect(await standardPageLinks('en', 'en')).toEqual([]);
        clearSiteInfoCache();
        state.type = { slug: 'info', standard: 'pages', hasPublicUrl: false };
        expect(await standardPageLinks('en', 'en')).toEqual([]);
    });

    it('reads once for a whole-site republish', async () => {
        await standardPageLinks('en', 'en');
        await standardPageLinks('en', 'en');
        expect(state.reads).toBe(1);
    });

    it('gives a page About, this year and the pages', async () => {
        expect(await siteInfoFor('en', 'en')).toMatchObject({ name: 'Kumar', year: new Date().getFullYear(), pages: [{ url: '/info/about' }, { url: '/info/terms' }] });
    });
});
