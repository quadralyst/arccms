/**
 * The `/` menu's custom fields (specs/visual-editing-spec.md, VE-D28): "Field: FAQ"
 * for each field the body can place, and, on a type with no FAQ field, an FAQ line
 * that says where one is added instead of matching nothing.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { FieldPlace, FieldPlaces } from './field-place';
import { SlashCommands } from './slash-commands';

const translate = (key: string) => ({
    'common.slash_commands.field': 'Field: {label}',
    'common.slash_commands.faq': 'FAQ',
    'common.slash_commands.faq_no_field': 'No FAQ field here.',
} as Record<string, string>)[key] ?? key;

function places(fields: { key: string; label: string; type: string }[]): FieldPlaces {
    return { fields: () => fields, open: vi.fn(), summary: () => [], translate };
}

describe('the / menu offers custom fields', () => {
    let editor: Editor | null = null;
    beforeAll(() => {
        // jsdom draws no layout; the menu only asks where the caret is.
        const empty = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
        const rect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
        for (const proto of [Range.prototype, Element.prototype] as any[]) {
            proto.getClientRects ??= empty;
            proto.getBoundingClientRect ??= rect;
        }
    });
    afterEach(() => {
        editor?.destroy();
        editor = null;
        document.querySelectorAll('[data-tippy-root]').forEach((el) => el.remove());
    });

    function typeSlash(p: FieldPlaces | null, query: string): string[] {
        const element = document.createElement('div');
        document.body.appendChild(element);
        editor = new Editor({
            element,
            extensions: [StarterKit, FieldPlace.configure({ places: p }), SlashCommands.configure({ translate, places: p })],
            content: '<p></p>',
        });
        editor.commands.focus('end');
        editor.commands.insertContent(`/${query}`);
        return [...document.querySelectorAll('.slash-commands .slash-command-item')].map((b) => b.textContent?.trim() ?? '');
    }

    it('lists each field by name, and choosing one places it', () => {
        const items = typeSlash(places([{ key: 'a-faq', label: 'FAQ', type: 'faq' }, { key: 'a-pics', label: 'Photos', type: 'gallery' }]), 'f');
        expect(items).toContain('Field: FAQ');
        expect(items).toContain('Field: Photos');
        const faq = [...document.querySelectorAll<HTMLButtonElement>('.slash-commands .slash-command-item')].find((b) => b.textContent?.includes('Field: FAQ'))!;
        faq.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        expect(editor!.getHTML()).toContain('<div data-arc-place="a-faq"></div>');
        expect(editor!.getHTML()).not.toContain('/f');
    });

    it('says where an FAQ field is added on a type with none', () => {
        const items = typeSlash(places([{ key: 'a-pics', label: 'Photos', type: 'gallery' }]), 'faq');
        expect(items).toEqual(['FAQNo FAQ field here.']);
        const hint = document.querySelector<HTMLButtonElement>('.slash-commands .slash-command-item')!;
        hint.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        expect(editor!.getText()).toBe('/faq');
    });

    it('finds the FAQ field with /faq whatever its label says', () => {
        expect(typeSlash(places([{ key: 'a-qs', label: 'Questions', type: 'faq' }]), 'faq')).toEqual(['Field: Questions']);
    });

    it('offers no fields outside the body', () => {
        expect(typeSlash(null, 'field')).toEqual([]);
    });
});
