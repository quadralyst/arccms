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

/**
 * The PWA has one switch, `enabled` in `src/custom/pwa.ts`, beside its name and
 * icon. It is off by default where every other feature is on, so it cannot be
 * switched from the features file.
 */
export type SwitchableFeatureId = Exclude<FeatureId, 'pwa'>;

export const SWITCHABLE_FEATURE_IDS: readonly SwitchableFeatureId[] = FEATURE_IDS.filter(
    (id): id is SwitchableFeatureId => id !== 'pwa',
);

export interface FeatureInfo {
    /** Name used in build messages. */
    label: string;
    /** Features that must be on for this one to work. */
    needs: readonly FeatureId[];
}

export const FEATURE_INFO: Record<FeatureId, FeatureInfo> = {
    content: { label: 'Content', needs: [] },
    search: { label: 'Search', needs: [] },
    seo: { label: 'SEO', needs: [] },
    forms: { label: 'Signup forms', needs: ['audience'] },
    audience: { label: 'Audience', needs: [] },
    'email-marketing': { label: 'Email marketing', needs: ['audience'] },
    sms: { label: 'SMS', needs: [] },
    payments: { label: 'Payments', needs: [] },
    data: { label: 'Data import and export', needs: [] },
    pwa: { label: 'Installable app (PWA)', needs: [] },
};

/** What `src/custom/features.ts` exports. Empty: every feature on. */
export interface FeatureChoice {
    /** The features this app does not have. */
    off?: readonly SwitchableFeatureId[];
}

/** A choice that cannot be built. The message says what to change. */
export class FeatureChoiceError extends Error {
    constructor(problems: readonly string[]) {
        super(`src/custom/features.ts:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
        this.name = 'FeatureChoiceError';
    }
}

const name = (id: FeatureId) => `${FEATURE_INFO[id].label} (${id})`;

/**
 * The features that are on. `pwaEnabled` is `enabled` from `src/custom/pwa.ts`,
 * the PWA's only switch.
 * Throws a FeatureChoiceError for an unknown id or a feature whose needs are off.
 */
export function resolveFeatures(choice: FeatureChoice | undefined, pwaEnabled: boolean): ReadonlySet<FeatureId> {
    const off: unknown = choice?.off ?? [];
    if (!Array.isArray(off)) {
        throw new FeatureChoiceError([`"off" must be a list, like off: ['payments', 'sms']`]);
    }

    if (off.includes('pwa')) {
        throw new FeatureChoiceError([`the PWA is switched in src/custom/pwa.ts (enabled: true or false), not here.`]);
    }
    const known = new Set<string>(SWITCHABLE_FEATURE_IDS);
    const unknown = off.filter((id) => !known.has(id));
    if (unknown.length > 0) {
        throw new FeatureChoiceError([
            `unknown feature ${unknown.map((id) => `"${String(id)}"`).join(', ')}. Features: ${SWITCHABLE_FEATURE_IDS.join(', ')}`,
        ]);
    }

    const on = new Set<FeatureId>(SWITCHABLE_FEATURE_IDS.filter((id) => !off.includes(id)));
    if (pwaEnabled) on.add('pwa');

    const problems: string[] = [];
    for (const id of on) {
        for (const need of FEATURE_INFO[id].needs) {
            if (!on.has(need)) {
                problems.push(`${name(id)} needs ${name(need)}, which is off. Turn off ${id} as well, or keep ${need}.`);
            }
        }
    }
    if (problems.length > 0) throw new FeatureChoiceError(problems);

    return on;
}
