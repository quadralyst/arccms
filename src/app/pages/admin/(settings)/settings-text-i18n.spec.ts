/**
 * Every word an admin reads on the Settings pages, and on Users, Authors and App
 * users, goes through Transloco (RF5, 5.3): no English typed into a template, an
 * attribute people read, or a toast. Technical values stay as they are: code,
 * addresses, example values and product names.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const admin = join(__dirname, '..');
const roots = ['(settings)', 'users', '(authors)', '(app-users)'].map((d) => join(admin, d));

function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return files(path);
        return /\.(ts|html)$/.test(name) && !name.endsWith('.spec.ts') ? [path] : [];
    });
}

/** The template of a page: the .html file, or the inline `template:` of a component. */
function template(path: string): string {
    const source = readFileSync(path, 'utf8');
    if (path.endsWith('.html')) return source;
    const at = source.indexOf('template: `');
    return at < 0 ? '' : source.slice(at + 11, source.indexOf('`', at + 11));
}

/** Text that is not words to translate: product names, units and technical values. */
const LITERAL = /^(Outlook \/ Microsoft 365|Yahoo Mail|Zoho Mail|PDF|USD|KB|MB|SSL|TLS|resend\.com\/api-keys|https?:\/\/\S+|\/\S+)$/;

/** The template without Angular's control flow: `@if (...) {`, `@for (...) {`, `@let x = ...;` and the braces. */
function withoutControlFlow(html: string): string {
    let out = '';
    for (let i = 0; i < html.length;) {
        const block = /^@(if|for|switch|case|else if|else|default|empty|defer|placeholder|loading)\b\s*/.exec(html.slice(i));
        const assign = /^@let\b[^;]*;/.exec(html.slice(i));
        if (assign) { i += assign[0].length; continue; }
        if (!block) { out += html[i] === '}' && /^\s*$/.test(html.slice(html.lastIndexOf('\n', i - 1) + 1, i)) ? '' : html[i]; i++; continue; }
        i += block[0].length;
        if (html[i] === '(') {
            let depth = 0;
            for (; i < html.length; i++) {
                if (html[i] === '(') depth++;
                else if (html[i] === ')' && --depth === 0) { i++; break; }
            }
        }
        const brace = html.indexOf('{', i);
        if (brace >= 0 && /^\s*$/.test(html.slice(i, brace))) i = brace + 1;
    }
    return out.replace(/\}/g, ' ');
}

function englishIn(html: string): string[] {
    const text = withoutControlFlow(html
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\{\{[\s\S]*?\}\}/g, ' ')
        .replace(/<code[^>]*>[\s\S]*?<\/code>/g, ' ')
        // A Material icon's ligature is its name, not words.
        .replace(/<mat-icon[^>]*>[\s\S]*?<\/mat-icon>/g, ' '));
    const found: string[] = [];
    for (const [, node] of text.matchAll(/>([^<>]*)</g)) {
        const words = node
            .replace(/&\w+;|&#\d+;/g, ' ')
            .split(/[,:()]/)
            .map((part) => part.trim())
            .filter((part) => /[A-Za-z]{3,}/.test(part) && !LITERAL.test(part));
        found.push(...words);
    }
    for (const [, name, value] of text.matchAll(/\s(placeholder|title|aria-label|matTooltip|alt|label)="([^"]*)"/g)) {
        if (/[A-Za-z]{3,}/.test(value) && !/@|\.(com|dev|io)\b|^e\.g\. |^https?:|^\/|_|\.\.\.$|^x-my-key$|^[x ]+$/.test(value)) found.push(`${name}="${value}"`);
    }
    return found;
}

describe('admin text goes through Transloco (RF5)', () => {
    for (const root of roots) {
        for (const path of files(root)) {
            const name = relative(admin, path);
            it(`${name} has no English typed into its template`, () => {
                expect(englishIn(template(path))).toEqual([]);
            });
            it(`${name} has no toast or error with English typed into it`, () => {
                const source = readFileSync(path, 'utf8');
                const toasts = [...source.matchAll(/(?:toastService|toast|notify|snackBar)\.(?:success|error|warning|info|raw|openCustomSnackbar|open)\(\s*(['"`])([^'"`]*)\1/g)]
                    .map((m) => m[2])
                    .filter((text) => /\s/.test(text) && /[A-Za-z]{3,}/.test(text));
                expect(toasts).toEqual([]);
            });
        }
    }

    it('shows no raw error message to an admin: err.message only goes to the console', () => {
        const offenders: string[] = [];
        for (const root of roots) {
            for (const path of files(root)) {
                readFileSync(path, 'utf8').split('\n').forEach((line, i) => {
                    if (/\b(err|error|e|ex)\)?\??\.message\b/.test(line) && /(\.set\(|toast|notify|snackBar|\{ ?(error|detail|message): )/.test(line) && !/console\./.test(line)) {
                        offenders.push(`${relative(admin, path)}:${i + 1}: ${line.trim()}`);
                    }
                });
            }
        }
        expect(offenders).toEqual([]);
    });
});
