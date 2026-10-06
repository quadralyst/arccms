/**
 * No English is left on a member screen (specs/app-member-language-spec.md, L-D12):
 * every text and every placeholder, title, label, alt or aria-label in the templates of
 * MEMBER_SCREEN_FILES comes from a translation key, and no English sentence is put into a
 * message or a toast. A screen whose text is not translated yet cannot slip back in.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MEMBER_SCREEN_FILES } from './member-keys';

const ROOT = resolve(__dirname, '../../../..');


function templatesOf(file: string): string[] {
    const source = readFileSync(resolve(ROOT, file), 'utf8');
    const inline = [...source.matchAll(/template:\s*`([\s\S]*?)`,?\s*\n\s*(styles|styleUrls|changeDetection|host|providers|\})/g)].map((m) => m[1]);
    const url = /templateUrl:\s*'([^']+)'/.exec(source)?.[1];
    return [...inline, ...(url ? [readFileSync(resolve(ROOT, file, '..', url), 'utf8')] : [])];
}

/** A quoted English phrase: a capital, then lower case letters (keys are all lower case). */
const ENGLISH_LITERAL = /'[A-Z][^'\n]*[a-z][^'\n]*'/g;

/** Literal words in a template: text between tags, text attributes, and English in expressions. */
export function untranslated(template: string): string[] {
    const uncommented = template.replace(/<!--[\s\S]*?-->/g, '');
    // English written into an expression, such as a fallback: {{ name || 'Member' }}.
    const expressions = [...uncommented.matchAll(/\{\{([\s\S]*?)\}\}|\[[\w.-]+\]="([^"]*)"/g)].map((m) => m[1] ?? m[2]);
    const inExpressions = expressions.flatMap((e) => [...e.matchAll(ENGLISH_LITERAL)].map((m) => m[0]));
    const clean = uncommented
        .replace(/<svg[\s\S]*?<\/svg>/g, '')
        .replace(/\{\{[\s\S]*?\}\}/g, ' ')
        .replace(/@(if|else if|for|switch|case|let|default)\b[^{]*\{|@else\s*\{|\}/g, ' ');
    // Attribute values may hold `>` (`[class.pos]="n > 0"`): blank them before reading text.
    const markup = clean.replace(/="[^"]*"/g, '=""');
    const text = [...markup.matchAll(/>([^<>]+)</g)].map((m) => m[1].replace(/&[a-z]+;|&#\d+;/g, ' ').trim())
        .filter((t) => /[A-Za-z]{2,}/.test(t));
    const attributes = [...clean.matchAll(/\s(placeholder|title|alt|aria-label|label)="([^"]*)"/g)]
        .map((m) => `${m[1]}="${m[2]}"`)
        .filter((a) => /="[^"]*[A-Za-z]{2,}/.test(a));
    return [...text, ...attributes, ...inExpressions];
}

/** English sentences handed to messages, errors and toasts in code, or picked as a fallback. */
export function literalMessages(source: string): string[] {
    // Log lines (console.error and the like) are for developers, not people.
    const sinks = [...source.matchAll(/(?<!console)\.(set|success|error|info|warning)\(\s*(['"`])([A-Z][^'"`]*[a-z][^'"`]*)\2/g)].map((m) => m[3]);
    // A fallback or a choice in code: `name || 'Member'`, `bad ? 'Try again.' : ...`.
    const phrase = `'([A-Z][^'\\n]*[a-z][^'\\n]*)'`;
    const choice = new RegExp(`(?:\\|\\||\\?\\?|\\?(?!\\.))\\s*${phrase}|\\?(?!\\.)[^?:;\\n]*:\\s*${phrase}`, 'g');
    const choices = [...source.matchAll(choice)].map((m) => m[1] ?? m[2]);
    return [...sinks, ...choices];
}

describe('member screens', () => {
    const files = MEMBER_SCREEN_FILES;

    it('show no literal English in their templates', () => {
        const problems = files.flatMap((file) => templatesOf(file).flatMap(untranslated).map((t) => `${file}: ${t}`));
        expect(problems).toEqual([]);
    });

    it('put no English sentence into a message or a toast', () => {
        const problems = files.flatMap((file) => literalMessages(readFileSync(resolve(ROOT, file), 'utf8')).map((t) => `${file}: ${t}`));
        expect(problems).toEqual([]);
    });

    it('catch what they are meant to catch', () => {
        expect(untranslated('<p>Hello there</p><input placeholder="Your name"><b>{{ x }}</b>')).toEqual(['Hello there', 'placeholder="Your name"']);
        expect(untranslated('<p>{{ \'a.b\' | transloco }}</p><input [placeholder]="\'a.b\' | transloco">')).toEqual([]);
        expect(literalMessages("this.error.set('Try again.'); this.error.set(''); this.toast.success(this.t('a.b')); console.error('Log it:', e);")).toEqual(['Try again.']);
        expect(untranslated('<span [class.pos]="e.delta > 0">{{ e.delta }}</span>')).toEqual([]);
        expect(untranslated('<b>{{ name || \'Member\' }}</b><i [title]="t || \'Pro plan\'"></i><b>{{ x || (\'user.pro\' | transloco) }}</b>')).toEqual(["'Member'", "'Pro plan'"]);
        expect(literalMessages("return u?.name || 'Member'; this.e.set(bad ? 'Try again.' : this.t('a.b')); const k = x ?? 'user.pro'; const o = { title: 'Rose' }; const m = ok ? this.t('a.b') : 'Failed.';")).toEqual(['Member', 'Try again.', 'Failed.']);
    });
});
