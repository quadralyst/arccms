/**
 * `data-arc-t` on live DOM: the site header and footer, which the app renders from
 * the site's HTML rather than compiling (src/app/pages/page.parts/site-fragment.ts).
 *
 * The same three annotations, with the same rules, as `applyStrings` in
 * TemplateHydrationService and in the publish functions, so a header reads the
 * same in the app and on a published page (src/app/core/i18n/annotation-parity.spec.ts).
 * Works on elements instead of an HTML string so the header needs no HTML parser.
 */
import { interpolate, parseParams } from './interpolate';

const usable = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

/** Replaces annotated text and attributes under `root` with `strings`; untranslated keys keep the authored text. */
export function applyStringsToElement(root: ParentNode, strings: Record<string, string> | null | undefined): void {
    const table = strings || {};

    root.querySelectorAll<HTMLElement>('[data-arc-t]').forEach((element) => {
        const translated = table[element.getAttribute('data-arc-t') || ''];
        if (usable(translated)) {
            element.textContent = interpolate(translated, parseParams(element.getAttribute('data-arc-t-params')));
        }
        element.removeAttribute('data-arc-t');
    });

    root.querySelectorAll<HTMLElement>('[data-arc-t-attr]').forEach((element) => {
        const params = parseParams(element.getAttribute('data-arc-t-params'));
        for (const pair of (element.getAttribute('data-arc-t-attr') || '').split(',')) {
            const [attr, key] = pair.split(':').map((part) => part.trim());
            if (!attr || !key) continue;
            const translated = table[key];
            if (usable(translated)) element.setAttribute(attr, interpolate(translated, params));
        }
        element.removeAttribute('data-arc-t-attr');
    });

    root.querySelectorAll('[data-arc-t-params]').forEach((element) => element.removeAttribute('data-arc-t-params'));
}
