/**
 * The member area's colours (docs/app/member-area.html#colours): an app sets a few
 * --arc-member-* variables in src/custom/styles.css, and the member shell and the
 * premium and payments pages read them, each with Arc CMS's own colour as its
 * fallback. This fails when one of those colours is written there without one.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILES = ['user-shell.component.ts', 'premium/premium.page.ts', 'payments/payments.page.ts'];
// Arc CMS's member colours: the panel, its words, the accent and its old tint.
const MEMBER_COLOURS = /#(0d1b2a|e0e6ed|1b98e0|eaf6fd)\b/gi;

describe('the member area\'s colours', () => {
    it.each(FILES)('%s writes its colours only as fallbacks of --arc-member-*', (file) => {
        const source = readFileSync(resolve(__dirname, file), 'utf8');
        const fallbacks = source.replace(/var\(--arc-member-[a-z-]+,\s*#[0-9a-f]{3,8}\)/gi, '');
        expect(fallbacks.match(MEMBER_COLOURS) ?? []).toEqual([]);
    });

    it('lets an app set the panel, its words, the accent and the menu hover', () => {
        const shell = readFileSync(resolve(__dirname, 'user-shell.component.ts'), 'utf8');
        for (const name of ['panel-background', 'panel-color', 'accent', 'menu-hover-background']) {
            expect(shell).toContain(`var(--arc-member-${name},`);
        }
    });
});
