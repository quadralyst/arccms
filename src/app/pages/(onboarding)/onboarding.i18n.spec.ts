/**
 * The setup wizard speaks the admin's language: every word on it comes from
 * `admin.onboarding.*` (en and hi), every field has a label tied to it, and every
 * icon-only button has a name. These read the files, so an English sentence typed
 * straight into the template, or a toast with literal text, fails here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EMAIL_PROVIDERS } from '../admin/(settings)/email-setting/email-setting.model';

const html = readFileSync(resolve(__dirname, 'onboarding.page.html'), 'utf8');
const ts = readFileSync(resolve(__dirname, 'onboarding.page.ts'), 'utf8');
const en = JSON.parse(readFileSync(resolve(__dirname, '../../../assets/i18n/en.json'), 'utf8'));
const hi = JSON.parse(readFileSync(resolve(__dirname, '../../../assets/i18n/hi.json'), 'utf8'));

const lookup = (tree: any, key: string) => key.split('.').reduce((node, part) => node?.[part], tree);

/** Names and examples that are the same in every language. */
const NOT_WORDS = new Set(['Outlook / Microsoft 365', 'Yahoo Mail', 'Zoho Mail', 'resend.com/api-keys', '(SSL)', 'xxxx xxxx xxxx xxxx']);

describe('the setup wizard\'s words', () => {
    it('has no English typed into the template: every word goes through Transloco', () => {
        const stripped = html
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/\{\{[\s\S]*?\}\}/g, ' ')
            .replace(/@let [^;]*;/g, ' ')
            .replace(/@(if|for|else if|else)\b[^{]*\{/g, ' ')
            .replace(/\}/g, ' ');
        const offenders = [...stripped.matchAll(/>([^<>]*)</g)]
            .map((m) => m[1].replace(/&[a-z]+;/g, ' ').trim())
            .flatMap((text) => text.split(/\s*[:,]\s*/))
            .map((text) => text.trim())
            .filter((text) => /[A-Za-z]{2,}/.test(text) && !NOT_WORDS.has(text) && !/^[\w-]+(\.[\w-]+)+$/.test(text)); // a host name is not a word
        expect(offenders).toEqual([]);
    });

    it('has no English in a fixed placeholder, title or label attribute (examples such as an address are fine)', () => {
        const offenders = [...html.matchAll(/\s(placeholder|title|aria-label|alt)="([^"]*)"/g)]
            .map((m) => m[2])
            .filter((value) => /[A-Za-z]{2,}/.test(value) && !/[@:/_.\d]/.test(value) && !NOT_WORDS.has(value));
        expect(offenders).toEqual([]);
    });

    it('shows no toast or error with literal text', () => {
        expect(ts).not.toMatch(/notify\.\w+\(\s*['"`][^'"`]*\s[^'"`]*['"`]/); // a sentence, not a key
        expect(ts).not.toMatch(/notify\.raw\(/);
        expect(ts).not.toMatch(/toastService/);
        expect(ts).not.toMatch(/errorMessage\.set\(\s*['"`][^'"`]+['"`]/);
        expect(ts).not.toMatch(/error\.message|result\.message\s*\|\|/);
    });

    it('has every key it uses in English and Hindi', () => {
        const keys = new Set([...(html + ts).matchAll(/'(admin\.onboarding\.[\w.]+)'/g)].map((m) => m[1]));
        for (const provider of EMAIL_PROVIDERS) {
            for (const text of ['name', 'description', 'best_for', 'free_tier']) keys.add(`admin.onboarding.email.providers.${provider.id}.${text}`);
        }
        expect(keys.size).toBeGreaterThan(50);
        const missing = [...keys].flatMap((key) => [
            ...(typeof lookup(en, key) === 'string' ? [] : [`en ${key}`]),
            ...(typeof lookup(hi, key) === 'string' ? [] : [`hi ${key}`]),
        ]);
        expect(missing).toEqual([]);
    });

    it('uses no dashes in its English or Hindi text', () => {
        const all = JSON.stringify([en.admin.onboarding, hi.admin.onboarding]);
        expect(all).not.toMatch(/[–—]/);
    });
});

describe('the setup wizard\'s fields and buttons', () => {
    it('ties every label to its field', () => {
        const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
        const labels = [...html.matchAll(/<label\b([^>]*)>/g)].map((m) => m[1]);
        expect(labels.length).toBeGreaterThan(10);
        const unlinked = labels.filter((attrs) => !ids.has(attrs.match(/\sfor="([^"]+)"/)?.[1] ?? ''));
        expect(unlinked).toEqual([]);
    });

    it('names every show-password button, and makes it a real button', () => {
        const toggles = [...html.matchAll(/<(\w+)\b[^>]*class="input-group-text[^"]*eye_btn[^"]*"[^>]*>/g)];
        expect(toggles.length).toBe(5);
        for (const [tag, name] of toggles) {
            expect(name, tag).toBe('button');
            expect(tag).toMatch(/type="button"/);
            expect(tag).toMatch(/\[attr\.aria-label\]=/);
        }
    });

    it('makes Skip for now a button a keyboard can reach', () => {
        expect(html).toMatch(/<button\s+type="button"\s+class="skip-link"/);
        expect(html).not.toMatch(/<a\b[^>]*\(click\)/);
    });
});
