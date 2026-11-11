/**
 * Announcements (RF5): notification settings that did not load say so, with Retry,
 * and cannot be saved over; a failed save says so instead of failing silently.
 */
import { describe, expect, it, vi } from 'vitest';
import { Injector, signal } from '@angular/core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const getDoc = vi.hoisted(() => vi.fn());
const setDoc = vi.hoisted(() => vi.fn());
vi.mock('@angular/fire/firestore', async (orig) => ({
    ...(await orig<object>()),
    doc: vi.fn(() => ({})),
    getDoc,
    setDoc,
}));

import AnnouncementsPage from './announcements.page';

const proto = AnnouncementsPage.prototype as unknown as Record<string, (this: unknown) => Promise<void>>;

function page() {
    const c: Record<string, any> = {
        firestore: {},
        injector: Injector.create({ providers: [] }),
        toast: { success: vi.fn(), error: vi.fn() },
        t: (key: string) => key,
        configLoaded: signal(false),
        configError: signal(false),
        saving: signal(false),
        types: signal<unknown[]>([]),
        mappings: signal<unknown[]>([]),
        rawTypes: {},
        rawMappings: {},
    };
    c['readConfig'] = (proto as any)['readConfig'].bind(c);
    return c;
}

describe('AnnouncementsPage', () => {
    it('says the settings did not load, and will not save over them', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        getDoc.mockRejectedValue(new Error('permission-denied'));
        const c = page();
        await proto['loadConfig'].call(c);
        expect(c['configError']()).toBe(true);
        expect(c['configLoaded']()).toBe(false);
        await proto['saveTypes'].call(c);
        expect(setDoc).not.toHaveBeenCalled();
    });

    it('loads on Retry, and says when a save fails', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        getDoc.mockResolvedValue({ data: () => ({ types: { welcome: { label: 'Welcome' } }, mappings: {} }) });
        const c = page();
        await proto['loadConfig'].call(c);
        expect(c['configError']()).toBe(false);
        expect(c['configLoaded']()).toBe(true);
        expect(c['types']()).toEqual([expect.objectContaining({ key: 'welcome', label: 'Welcome' })]);

        setDoc.mockRejectedValueOnce(new Error('offline'));
        await proto['saveTypes'].call(c);
        expect(c['toast'].error).toHaveBeenCalledWith('admin.announcements.save_failed');
        expect(c['saving']()).toBe(false);

        setDoc.mockResolvedValueOnce(undefined);
        await proto['saveMappings'].call(c);
        expect(c['toast'].success).toHaveBeenCalledWith('admin.announcements.mappings_saved');
    });

    it('offers Retry in the settings tabs', () => {
        const html = readFileSync(resolve(__dirname, 'announcements.page.html'), 'utf8');
        expect(html).toContain('(click)="loadConfig()"');
        expect(html).toContain('[disabled]="!configLoaded() || saving()"');
    });
});
