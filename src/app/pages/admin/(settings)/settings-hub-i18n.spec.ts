/**
 * Every Settings tile has its name and description in every language: the hub
 * shows `admin.settings.hub.<id>.label`, and a missing key shows as the raw key
 * (the Automations tile did, review UI bug).
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
    }
});
