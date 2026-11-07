/**
 * The layout rules every admin page shares (src/styles.css), which a page cannot get wrong
 * on its own: a browser test would see them, these keep them from going.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as sass from 'sass';

const styles = readFileSync(resolve(__dirname, '../styles.css'), 'utf8');

describe('the admin layout', () => {
    it('gives a long hint its own room, so it never runs into the next field', () => {
        expect(styles).toMatch(/\.mat-mdc-form-field-hint-wrapper,[\s\S]{0,120}\.mat-mdc-form-field-error-wrapper \{\s*position: static;/);
        expect(styles).toMatch(/\.mat-mdc-form-field-subscript-wrapper:has\(mat-hint, mat-error\)::before \{\s*content: none;/);
    });

    it('sizes a page\'s drawer by the screen, so a long page leaves no blank area under it', () => {
        expect(styles).toMatch(/mat-drawer-container:not\(\.arc-main-page\) > mat-drawer \{\s*position: fixed;/);
    });

    it('lets a long button label wrap with room around it', () => {
        expect(styles).toMatch(/\.mat-mdc-raised-button[^{]*\{\s*height: auto;\s*min-height: 36px;/);
    });

    it('pads every content area, also a page with no style of its own', () => {
        expect(styles).toMatch(/\.arc-admin \.content-area \{\s*padding: 24px;/);
    });

    it('gives a field with a width of its own, in a row, that width: a label is never cut to "Dela"', () => {
        expect(styles).toMatch(/mat-form-field\[style\*="width"\] \{\s*flex-shrink: 0;/);
    });

    it('keeps Cancel and the main button in one row, Cancel first, also on a phone', () => {
        expect(styles).toMatch(/\.arc-admin \.action-row \{[^}]*flex-wrap: nowrap;[^}]*justify-content: flex-end;/);
        expect(styles).toMatch(/\.arc-admin \.drawer-actions \{\s*flex-direction: row;/);
        const pages = resolve(__dirname, 'pages/admin/(settings)');
        for (const file of ['integrations-setting/integrations-setting.page.ts', 'analytics-setting/analytics-setting.page.ts', 'payments/payments-setting.page.ts']) {
            expect(readFileSync(resolve(pages, file), 'utf8'), file).toContain('class="action-row');
        }
        // Cancel before the save button wherever they sit side by side.
        const search = readFileSync(resolve(pages, 'search/search-settings.page.ts'), 'utf8');
        expect(search.indexOf("editor.set(null)")).toBeLessThan(search.indexOf('(click)="save()"'));
        const profile = readFileSync(resolve(__dirname, 'pages/(auth)/(profile)/profile.page.html'), 'utf8');
        expect(profile.indexOf('cancelEditName()')).toBeLessThan(profile.indexOf('saveName()'));
        expect(profile.indexOf('cancelChangePassword()')).toBeLessThan(profile.indexOf('savePassword()'));
        const methods = readFileSync(resolve(__dirname, 'pages/(auth)/(profile)/sign-in-methods.component.ts'), 'utf8');
        expect(methods.indexOf('(click)="cancel()"', methods.indexOf('(click)="finish()"'))).toBe(-1);
        const full = readFileSync(resolve(__dirname, 'pages/admin/contents/create-content/fullscreen-editor-dialog/fullscreen-editor-dialog.component.ts'), 'utf8');
        expect(full.indexOf('(click)="cancel()"')).toBeLessThan(full.indexOf('(click)="save()"'));
    });

    it('centres the card of a settings page that is switched off in the panel', () => {
        expect(styles).toMatch(/\.arc-admin :has\(> \.disabled-state\) \{\s*max-width: none !important;/);
    });

    it('leaves the link colour of the page off the side panel: the person\'s name reads under the pointer', () => {
        const panel = readFileSync(resolve(__dirname, '../shared/components/side-navbar/side-navbar.component.scss'), 'utf8');
        expect(panel).toMatch(/\.brand-link,\s*\.user-info \{\s*&:hover,[\s\S]{0,120}color: var\(--arc-admin-panel-color\);/);
    });

    it('keeps the media manager\'s styles to the media manager', () => {
        // Its component is not encapsulated, and in a production build its styles were seen to
        // outlive it: a bare rule (`body`, `img`, `.form-control`, Material's subscript wrapper)
        // restyled the admin, so fields lost the room under them and their labels overlapped.
        const file = resolve(__dirname, 'pages/admin/(media)/media-manager.scss');
        const css = sass.compile(file).css;
        // Each selector sits after a `}`, a `{` (the first rule of a media query) or the start.
        const selectors = [...css.matchAll(/(?:^|[{};])\s*([^{};]+)\{/g)]
            .map((m) => m[1].trim())
            .filter((sel) => !sel.startsWith('@') && !/^(from|to|\d+(\.\d+)?%)/.test(sel));
        expect(selectors.length).toBeGreaterThan(100);
        const loose = selectors.filter((sel) => !sel.split(',').every((one) => /^(arc-media-manager\b|\.common-dialog-box\b)/.test(one.trim())));
        expect(loose).toEqual([]);
    });

    it('leaves the side panel\'s own height rule to the side panel', () => {
        const panel = readFileSync(resolve(__dirname, '../shared/components/side-navbar/side-navbar.component.scss'), 'utf8');
        expect(panel).toContain('::ng-deep .arc-side-panel > .mat-drawer-inner-container');
        expect(panel).not.toMatch(/^::ng-deep \.mat-drawer-inner-container/m);
    });
});
