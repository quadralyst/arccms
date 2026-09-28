/**
 * Values in trusted HTML (review F: a member's name in the admin Users page's
 * Delete and Block confirmations ran as script in the admin's session).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { escapeHtml } from './escape-html';

describe('escapeHtml', () => {
    it('escapes markup and quotes, and takes missing values', () => {
        expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
        expect(escapeHtml("Tom & Jerry's")).toBe('Tom &amp; Jerry&#39;s');
        expect(escapeHtml(undefined)).toBe('');
        expect(escapeHtml(null)).toBe('');
    });
});

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return sourceFiles(path);
        return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
    });
}

/** Values that are never typed by a person: numbers and fixed words. */
const SAFE = new Set(['days', 'action', 'used', "used === 1 ? '' : 's'", 'warning', 'label', 'email', 'actionText']);

describe('bypassSecurityTrustHtml', () => {
    it('gets every value in a template literal escaped', () => {
        const unescaped: string[] = [];
        for (const file of sourceFiles('src')) {
            const text = readFileSync(file, 'utf8');
            for (const call of text.matchAll(/bypassSecurityTrustHtml\(\s*`([^`]*)`/g)) {
                for (const value of call[1].matchAll(/\$\{([^}]*)\}/g)) {
                    const expr = value[1].trim();
                    if (SAFE.has(expr) || /^(escapeHtml|this\.escape)\(/.test(expr)) continue;
                    unescaped.push(`${file}: \${${expr}}`);
                }
            }
            for (const call of text.matchAll(/bypassSecurityTrustHtml\(\s*this\.(?:transloco\.translate|t)\([^,]+,\s*\{([^}]*)\}/g)) {
                for (const param of call[1].split(',')) {
                    const expr = param.split(':').slice(1).join(':').trim();
                    if (expr && !/^(escapeHtml|this\.escape)\(/.test(expr)) unescaped.push(`${file}: ${param.trim()}`);
                }
            }
        }
        expect(unescaped).toEqual([]);
    });
});
