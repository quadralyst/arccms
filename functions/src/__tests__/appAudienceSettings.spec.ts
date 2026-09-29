/** Settings, App audience defaults (app-audience/settings.ts). */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const m = vi.hoisted(() => ({ stored: undefined as Record<string, unknown> | undefined }));
vi.mock('../init', () => ({
    db: { collection: vi.fn(() => ({ doc: vi.fn(() => ({ get: vi.fn(async () => ({ exists: !!m.stored, data: () => m.stored })) })) })) },
}));

import { OWN_USERS_SETTINGS, readAppAudienceSettings } from '../app-audience/settings.js';

describe('readAppAudienceSettings', () => {
    const clear = () => {
        delete process.env.ARC_APP_USERS_PATH;
        delete process.env.ARC_APP_USERS_DATABASE;
        delete process.env.ARC_DATABASE_ID;
    };
    beforeEach(() => { m.stored = undefined; clear(); });
    afterAll(clear);

    it("knows the fields of the site's own users, so that audience works before anyone saves settings", async () => {
        process.env.ARC_APP_USERS_PATH = 'users/{id}';
        process.env.ARC_APP_USERS_DATABASE = '(default)';
        expect(await readAppAudienceSettings()).toEqual(OWN_USERS_SETTINGS);
        expect(OWN_USERS_SETTINGS).toMatchObject({ emailField: 'email', nameField: 'name', phoneField: 'phone' });
    });

    it("assumes nothing about another app's users", async () => {
        process.env.ARC_APP_USERS_PATH = 'profiles/{uid}';
        process.env.ARC_APP_USERS_DATABASE = '(default)';
        expect((await readAppAudienceSettings()).emailField).toBeUndefined();
    });

    it('uses what an admin saved, always', async () => {
        process.env.ARC_APP_USERS_PATH = 'users/{id}';
        process.env.ARC_APP_USERS_DATABASE = '(default)';
        m.stored = { key: { source: 'docId' }, emailField: 'contactEmail', watchedFields: ['isPro'] };
        expect(await readAppAudienceSettings()).toMatchObject({ emailField: 'contactEmail', watchedFields: ['isPro'] });
    });
});
