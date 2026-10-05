/**
 * The home page is republished when a setting it shows changes
 * (functions/src/publishQueue/onSiteSettingsWritten.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAdd } = vi.hoisted(() => ({ mockAdd: vi.fn() }));
vi.mock('../init', () => ({ db: { collection: () => ({ add: mockAdd }) } }));
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentWritten: vi.fn((_opts, handler) => handler) }));
vi.mock('firebase-admin/firestore', () => ({ Timestamp: { now: () => 'now' } }));
const { mockGetSiteFile, mockGetSiteManifest } = vi.hoisted(() => ({ mockGetSiteFile: vi.fn(), mockGetSiteManifest: vi.fn() }));
vi.mock('../shared/site-files', () => ({
    getSiteFile: (...a: unknown[]) => mockGetSiteFile(...a),
    getSiteManifest: (...a: unknown[]) => mockGetSiteManifest(...a),
}));

import { changesHomePage, onSiteSettingsWritten, siteUsesSiteInfo } from '../publishQueue/onSiteSettingsWritten.js';

const handler = onSiteSettingsWritten as unknown as (event: unknown) => Promise<void>;
const event = (settingId: string, before: unknown, after: unknown) => ({
    params: { settingId },
    data: { before: { data: () => before }, after: { data: () => after } },
});

describe('onSiteSettingsWritten', () => {
    // Leave no hosting setting behind for the next test file in this worker.
    afterEach(() => { delete process.env.ARC_HOSTING_SITE; });

    beforeEach(() => {
        vi.clearAllMocks();
        process.env.ARC_HOSTING_SITE = 'acme-arccms';
        mockGetSiteManifest.mockResolvedValue({ templates: { services: { partials: 'app' } }, pages: { terms: 'app' } });
        mockGetSiteFile.mockResolvedValue('<p>plain</p>');
    });

    // SS3: the site's details printed outside the home page.
    describe('when other pages print About', () => {
        it('looks in the header, footer, every template and every static page', async () => {
            expect(await siteUsesSiteInfo()).toBe(false);
            expect(mockGetSiteFile.mock.calls.map(([file]) => file)).toEqual([
                'header.html', 'footer.html', 'templates/services/partials.html', 'pages/terms.html',
            ]);
            mockGetSiteFile.mockImplementation(async (file: string) => (file === 'pages/terms.html' ? '<a data-arc-site="email"></a>' : ''));
            expect(await siteUsesSiteInfo()).toBe(true);
        });

        it('republishes every page when About changes and the footer prints it', async () => {
            mockGetSiteFile.mockImplementation(async (file: string) => (file === 'footer.html' ? '<span data-arc-site="phone"></span>' : ''));
            await handler(event('about', { phone: '1' }, { phone: '2' }));
            expect(mockAdd).toHaveBeenCalledWith({ action: 'redeploy-all', contentTypeSlug: '', docId: '', timestamp: 'now' });
        });

        it('still republishes only the home page for another setting it shows', async () => {
            mockGetSiteFile.mockResolvedValue('<span data-arc-site="phone"></span>');
            await handler(event('localization', undefined, { enabledLanguages: [] }));
            expect(mockAdd).toHaveBeenCalledWith({ action: 'home', timestamp: 'now' });
        });
    });

    it('knows which changes reach the home page', () => {
        expect(changesHomePage('about', { name: 'A' }, { name: 'B' })).toBe(true);
        expect(changesHomePage('localization', undefined, { enabledLanguages: [] })).toBe(true);
        expect(changesHomePage('about', { a: 1, b: 2 }, { b: 2, a: 1 })).toBe(false);
        expect(changesHomePage('email_status', { isEnabled: false }, { isEnabled: true })).toBe(false);
        expect(changesHomePage('about', { name: 'A' }, undefined)).toBe(false);
    });

    it('queues a home page republish when About changes', async () => {
        await handler(event('about', { name: 'Old' }, { name: 'New' }));
        expect(mockAdd).toHaveBeenCalledWith({ action: 'home', timestamp: 'now' });
    });

    it('queues nothing for a save that changed nothing, another setting, or with hosting off', async () => {
        await handler(event('about', { name: 'Same' }, { name: 'Same' }));
        await handler(event('discoverability', {}, { llms: true }));
        process.env.ARC_HOSTING_SITE = 'none';
        await handler(event('about', { name: 'Old' }, { name: 'New' }));
        expect(mockAdd).not.toHaveBeenCalled();
    });
});
