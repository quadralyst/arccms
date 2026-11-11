/**
 * Every Settings tile has its name and description in every language: the hub
 * shows `admin.settings.hub.<id>.label`, and a missing key shows as the raw key
 * (the Automations tile did, review UI bug). The group headings are
 * `admin.settings.hub.groups.<group>`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const page = readFileSync(resolve(__dirname, 'settings.page.ts'), 'utf8');
const ids = [...page.matchAll(/id: '([\w-]+)'/g)].map((m) => m[1]);

describe('Settings hub translations', () => {
    it('finds the tiles', () => {
        expect(ids.length).toBeGreaterThan(5);
        expect(ids).toContain('automations');
    });

    for (const lang of ['en', 'hi']) {
        it(`has a label and description for every tile in ${lang}`, () => {
            const hub = JSON.parse(readFileSync(resolve(__dirname, `../../../../assets/i18n/${lang}.json`), 'utf8')).admin.settings.hub;
            const missing = ids.filter((id) => !hub[id]?.label || !hub[id]?.description);
            expect(missing).toEqual([]);
        });

        it(`has a heading for every group in ${lang}`, () => {
            const hub = JSON.parse(readFileSync(resolve(__dirname, `../../../../assets/i18n/${lang}.json`), 'utf8')).admin.settings.hub;
            const groups = [...(page.match(/SETTING_GROUPS = \[([^\]]+)\]/)?.[1] ?? '').matchAll(/'([\w-]+)'/g)].map((m) => m[1]);
            expect(groups.length).toBe(6);
            expect(groups.filter((g) => !hub.groups?.[g])).toEqual([]);
            expect(hub.all_settings).toBeTruthy();
        });
    }
});
