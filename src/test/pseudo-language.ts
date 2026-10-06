import { TranslocoTestingModule } from '@jsverse/transloco';
import en from '../assets/i18n/en.json';
import { isMemberKey } from '../app/core/i18n/member-keys';
// The same rule as `npm run i18n:pseudo`, so the tests and the by-eye check agree.
import { pseudo } from '../../scripts/i18n-pseudo.mjs';

/**
 * A pseudo language for member screens (specs/app-member-language-spec.md, L-D11): every
 * member key from English, accented and in brackets, and no other key. Rendered in it, a
 * member screen shows brackets around all of its text; plain English is text that is not
 * translated, or a key that is missing from the member list.
 */
export function pseudoMemberLanguage(node: unknown = en, prefix = ''): Record<string, unknown> {
    return Object.fromEntries(Object.entries(node as Record<string, unknown>).flatMap(([key, value]) => {
        const path = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === 'object') {
            const inner = pseudoMemberLanguage(value, path);
            return Object.keys(inner).length ? [[key, inner]] : [];
        }
        return isMemberKey(path) ? [[key, pseudo(String(value))]] : [];
    }));
}

/** Every leaf of a translation file in the pseudo language. */
function pseudoAll(node: unknown): unknown {
    if (!node || typeof node !== 'object') return pseudo(String(node));
    return Object.fromEntries(Object.entries(node as Record<string, unknown>).map(([key, value]) => [key, pseudoAll(value)]));
}

function merge(base: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> {
    const out = { ...base };
    for (const [key, value] of Object.entries(over)) {
        const inner = out[key];
        out[key] = value && typeof value === 'object' && inner && typeof inner === 'object'
            ? merge(inner as Record<string, unknown>, value as Record<string, unknown>)
            : value;
    }
    return out;
}

/**
 * Transloco for a spec, in the pseudo language `zz` (English still loaded, as in an app).
 * Pass the app's own English (src/custom/i18n/en.json) to check its screens too.
 */
export function pseudoTestingModule(ownEnglish: Record<string, unknown> = {}) {
    return TranslocoTestingModule.forRoot({
        langs: {
            en: merge(en, ownEnglish),
            zz: merge(pseudoMemberLanguage(), pseudoAll(ownEnglish) as Record<string, unknown>),
        },
        translocoConfig: {
            availableLangs: ['en', 'zz'],
            defaultLang: 'zz',
            // No English fallback: a key missing from the member list shows as the key, and fails.
            missingHandler: { useFallbackTranslation: false, logMissingKey: false },
        },
        preloadLangs: true,
    });
}

/**
 * The visible text of a rendered screen that is not in the pseudo language: each text
 * node with letters must hold a bracket. `allow` lists text that is data, not wording
 * (a name, an email, an admin's own text).
 */
export function textNotInPseudo(root: Element, allow: readonly string[] = []): string[] {
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const found: string[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent?.trim() ?? '';
        if (!/[A-Za-z]{2,}/.test(text) || /[[\]]/.test(text)) continue;
        if (node.parentElement?.closest('style, script')) continue;
        if (!allow.includes(text)) found.push(text);
    }
    return found;
}
