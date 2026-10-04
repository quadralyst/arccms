/**
 * The home page is republished when a setting it shows changes
 * (functions/src/publishQueue/onSiteSettingsWritten.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAdd } = vi.hoisted(() => ({ mockAdd: vi.fn() }));
vi.mock('../init', () => ({ db: { collection: () => ({ add: mockAdd }) } }));
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentWritten: vi.fn((_opts, handler) => handler) }));
vi.mock('firebase-admin/firestore', () => ({ Timestamp: { now: () => 'now' } }));

import { changesHomePage, onSiteSettingsWritten } from '../publishQueue/onSiteSettingsWritten.js';

const handler = onSiteSettingsWritten as unknown as (event: unknown) => Promise<void>;
const event = (settingId: string, before: unknown, after: unknown) => ({
    params: { settingId },
    data: { before: { data: () => before }, after: { data: () => after } },
});

describe('onSiteSettingsWritten', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.ARC_HOSTING_SITE = 'acme-arccms';
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
