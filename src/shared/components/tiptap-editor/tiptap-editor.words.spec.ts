/**
 * The editor's toolbar and slash menu speak the admin's language (RF5, 5.3 and 5.8):
 * every toolbar button has a name a screen reader can say, and no menu title is English text.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../../assets/i18n/en.json';

const template = readFileSync(resolve(__dirname, 'tiptap-editor.component.html'), 'utf8');
const slash = readFileSync(resolve(__dirname, 'service/slash-commands.ts'), 'utf8');

describe('editor words', () => {
    it('names every toolbar button: an aria-label, or translated text inside', () => {
        const buttons = [...template.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
        expect(buttons.length).toBeGreaterThan(10);
        const unnamed = buttons.filter(([, attrs, body]) => !attrs.includes('[attr.aria-label]') && !body.includes('| transloco'));
        expect(unnamed.map(([whole]) => whole.replace(/\s+/g, ' ').slice(0, 80))).toEqual([]);
    });

    it('titles every slash command through a translation key that exists', () => {
        expect(slash).not.toMatch(/title: '[A-Z]/);
        const keys = [...slash.matchAll(/title: t\('(\w+)'\)/g)].map((m) => m[1]);
        expect(keys.length).toBeGreaterThan(15);
        const group = (en as any).common.slash_commands;
        expect(keys.filter((k) => !(k in group))).toEqual([]);
        for (const kind of ['faq', 'takeaways', 'howto', 'definition']) expect(group[`block_${kind}`]).toBeTruthy();
    });
});
