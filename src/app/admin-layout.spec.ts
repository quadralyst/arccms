/**
 * The layout rules every admin page shares (src/styles.css), which a page cannot get wrong
 * on its own: a browser test would see them, these keep them from going.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

    it('leaves the side panel\'s own height rule to the side panel', () => {
        const panel = readFileSync(resolve(__dirname, '../shared/components/side-navbar/side-navbar.component.scss'), 'utf8');
        expect(panel).toContain('::ng-deep .arc-side-panel > .mat-drawer-inner-container');
        expect(panel).not.toMatch(/^::ng-deep \.mat-drawer-inner-container/m);
    });
});
