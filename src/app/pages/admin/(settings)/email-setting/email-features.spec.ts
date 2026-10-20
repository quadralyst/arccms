/**
 * The feature toggles in Settings, Email: every one the functions check has a row,
 * App emails included (specs/app-email-spec.md, AE-D12), and all start on.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EMAIL_FEATURES, EMAIL_FEATURE_META } from './email-setting.model';

describe('email feature toggles', () => {
    it('offer App emails, on unless switched off', () => {
        expect(DEFAULT_EMAIL_FEATURES.appEmails).toBe(true);
        expect(EMAIL_FEATURE_META.find((f) => f.key === 'appEmails')?.label).toBe('App emails');
    });

    it('have a row for every toggle the functions know, and no other', () => {
        const types = readFileSync(resolve(__dirname, '../../../../../../functions/src/types.ts'), 'utf8');
        const block = types.slice(types.indexOf('export interface EmailFeatureToggles'), types.indexOf('}', types.indexOf('export interface EmailFeatureToggles')));
        const serverKeys = [...block.matchAll(/^\s+(\w+)\?: boolean;/gm)].map((m) => m[1]).sort();
        expect(EMAIL_FEATURE_META.map((f) => f.key).sort()).toEqual(serverKeys);
        expect(Object.keys(DEFAULT_EMAIL_FEATURES).sort()).toEqual(serverKeys);
        expect(Object.values(DEFAULT_EMAIL_FEATURES).every((on) => on)).toBe(true);
    });
});
