/**
 * The Arc CMS features an app can turn off (docs/feature-flags-spec.md), and the
 * rules for resolving the app's choice in `src/custom/features.ts`. Everything not
 * listed here is core and always on.
 *
 * Plain TypeScript with no imports, because vite.config.ts and the functions
 * generator read it with Node as well as the app.
 */

export const FEATURE_IDS = [
    'content',
    'search',
    'seo',
    'forms',
    'audience',
    'email-marketing',
    'sms',
    'payments',
    'data',
    'pwa',
] as const;

export type FeatureId = (typeof FEATURE_IDS)[number];

export interface FeatureInfo {
    /** Name used in build messages. */
    label: string;
    /** On unless `off` lists it (true), or off unless `on` lists it (false). */
    defaultOn: boolean;
    /** Features that must be on for this one to work. */
    needs: readonly FeatureId[];
}

export const FEATURE_INFO: Record<FeatureId, FeatureInfo> = {
    content: { label: 'Content', defaultOn: true, needs: [] },
    search: { label: 'Search', defaultOn: true, needs: [] },
    seo: { label: 'SEO', defaultOn: true, needs: [] },
    forms: { label: 'Signup forms', defaultOn: true, needs: ['audience'] },
    audience: { label: 'Audience', defaultOn: true, needs: [] },
    'email-marketing': { label: 'Email marketing', defaultOn: true, needs: ['audience'] },
    sms: { label: 'SMS', defaultOn: true, needs: [] },
    payments: { label: 'Payments', defaultOn: true, needs: [] },
    data: { label: 'Data import and export', defaultOn: true, needs: [] },
    // A plain website should get no service worker, so the PWA waits to be asked for.
    pwa: { label: 'Installable app (PWA)', defaultOn: false, needs: [] },
};

/** What `src/custom/features.ts` exports. Empty: every feature on except the PWA. */
export interface FeatureChoice {
    /** Features that are off by default and this app wants (today only `pwa`). */
    on?: readonly FeatureId[];
    /** Features this app does not have. */
    off?: readonly FeatureId[];
}

/** A choice that cannot be built. The message says what to change. */
export class FeatureChoiceError extends Error {
    constructor(problems: readonly string[]) {
        super(`src/custom/features.ts:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
        this.name = 'FeatureChoiceError';
    }
}

const name = (id: FeatureId) => `${FEATURE_INFO[id].label} (${id})`;

function list(choice: FeatureChoice | undefined, key: 'on' | 'off'): FeatureId[] {
    const value: unknown = choice?.[key] ?? [];
    if (!Array.isArray(value)) {
        throw new FeatureChoiceError([`"${key}" must be a list, like ${key}: ['${key === 'on' ? 'pwa' : 'payments'}']`]);
    }
    const known = new Set<string>(FEATURE_IDS);
    const unknown = value.filter((id) => !known.has(id));
    if (unknown.length > 0) {
        throw new FeatureChoiceError([
            `unknown feature ${unknown.map((id) => `"${String(id)}"`).join(', ')} in "${key}". Features: ${FEATURE_IDS.join(', ')}`,
        ]);
    }
    return value as FeatureId[];
}

/**
 * The features that are on: the default-on ones, plus `on`, minus `off`.
 * Throws a FeatureChoiceError for an unknown id, a feature in both lists, or a
 * feature whose needs are off.
 */
export function resolveFeatures(choice: FeatureChoice | undefined): ReadonlySet<FeatureId> {
    const on = list(choice, 'on');
    const off = list(choice, 'off');

    const both = on.filter((id) => off.includes(id));
    if (both.length > 0) {
        throw new FeatureChoiceError([`${both.map(name).join(', ')} is in both "on" and "off". Keep it in one.`]);
    }

    const result = new Set<FeatureId>(FEATURE_IDS.filter((id) => FEATURE_INFO[id].defaultOn));
    for (const id of on) result.add(id);
    for (const id of off) result.delete(id);

    const problems: string[] = [];
    for (const id of result) {
        for (const need of FEATURE_INFO[id].needs) {
            if (!result.has(need)) {
                problems.push(`${name(id)} needs ${name(need)}, which is off. Turn off ${id} as well, or keep ${need}.`);
            }
        }
    }
    if (problems.length > 0) throw new FeatureChoiceError(problems);

    return result;
}
