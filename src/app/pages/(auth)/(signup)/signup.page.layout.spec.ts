/**
 * The sign-in page on a phone (F19): it fits the visible screen. jsdom cannot lay
 * a page out, so this checks the rules that make it fit, compiled from the
 * page's SCSS. Measured in a browser at 375 by 667 and 393 by 852: no scroll.
 */
import { describe, it, expect } from 'vitest';
import { compile } from 'sass';
import { resolve } from 'node:path';

const css = compile(resolve(__dirname, 'signup.page.scss')).css;

/** The declarations of the first rule whose selector is exactly `selector`, outside any @media. */
function rule(selector: string, source = css): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = source.match(new RegExp(`(^|\\n)${escaped} \\{([^}]*)\\}`));
    return match?.[2] ?? '';
}

describe('the sign-in page fits a phone screen (F19)', () => {
    it('fills the visible screen, not the room behind the browser bars, less the Built with Arc CMS line', () => {
        const column = rule('.auth-form-column');
        expect(column).toContain('display: flex');
        expect(column).toContain('flex-direction: column');
        // The last one a browser understands wins: dvh, else svh, else vh.
        const heights = [...column.matchAll(/min-height: ([^;]+);/g)].map((m) => m[1]);
        expect(heights).toEqual([
            'calc(100vh - var(--arc-powered-by-height, 0px))',
            'calc(100svh - var(--arc-powered-by-height, 0px))',
            'calc(100dvh - var(--arc-powered-by-height, 0px))',
        ]);
    });

    it('centres the logo and the card together, with the footer at the foot', () => {
        expect(rule('.auth-form-column .auth-form-container')).toContain('margin-top: auto');
        expect(rule('.auth-form-column .copyright')).toContain('margin-top: auto');
        expect(rule('.auth-form-column > form,\n.auth-form-column > .auth-opening')).toContain('flex: 1 0 auto');
    });

    it('gives the card no height of its own, which pushed the footer off the screen', () => {
        expect(css).not.toMatch(/min-height:\s*6\dvh/);
        expect(rule('.verification-container,\n.signup-container,\n.request-container')).not.toContain('min-height');
    });
});

describe('the show-password eye beside a field (F25)', () => {
    // Measured in a browser on a phone, a tablet, at 150% text and with dir="rtl": a gap
    // between the field and the eye, each rounded all round.
    const eye = rule('.input-group > .form-control + .btn');
    const field = rule('.input-group > .form-control:has(+ .btn)');

    it('has a gap from the field on the eye\'s start side, whatever the direction, not Bootstrap\'s overlap', () => {
        expect(eye).toMatch(/margin-inline: 0\.5rem 0 !important/);
        expect(eye).not.toMatch(/margin-left/);
    });

    it('rounds the eye all round and the field\'s end corners, by the field radius variable', () => {
        expect(eye).toContain('border-radius: var(--arc-sign-in-field-radius, 8px) !important');
        expect(field).toContain('border-start-end-radius: var(--arc-sign-in-field-radius, 8px) !important');
        expect(field).toContain('border-end-end-radius: var(--arc-sign-in-field-radius, 8px) !important');
    });

    it('rounds the field\'s end corners focused or invalid too, which the field rules give 3px', () => {
        expect(field).not.toContain(':not(:focus)');
        expect(css).toContain('.input-group > .form-control:has(+ .btn) {');
    });

    it('uses logical corners beside the lock icon, so a right-to-left language joins the right side', () => {
        const joined = rule('.input-group > .input-group-text + .form-control:not(:focus):not(.is-invalid)');
        expect(joined).toContain('border-start-start-radius');
        expect(joined).toContain('border-end-start-radius');
        expect(joined).not.toMatch(/border-(top|bottom)-(left|right)-radius/);
    });
});
