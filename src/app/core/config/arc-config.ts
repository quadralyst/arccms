/**
 * Install configuration for the browser app and SSR (specs/coexistence-spec.md, CO-D2, CO-D3).
 *
 * Read from `src/environments/arc-install.ts`, which `npm run arc:configure`
 * writes from `arccms.config.json`: one entry per Firebase project, so a build
 * for dev and a build for production each get their own settings. The app uses
 * the entry for `environment.firebaseConfig.projectId`. Every key is optional;
 * no entry or a missing key means today's behaviour: the `(default)` Firestore
 * database, the bucket named in `firebaseConfig.storageBucket`, and uploads at
 * the bucket root.
 *
 * This module is the only place in the frontend that reads them.
 */
import { arcInstall } from '../../../environments/arc-install';
import { environment } from '../../../environments/environment';

/** The id Firestore gives the database every project starts with. */
export const DEFAULT_DATABASE_ID = '(default)';

/** Where Firebase puts functions that name no region. */
export const DEFAULT_FUNCTIONS_REGION = 'us-central1';

/**
 * Firestore's offline cache (docs/app/offline.html): `off`, or kept on the device for one
 * tab at a time, or shared by every tab of the site.
 */
export const OFFLINE_CACHE_MODES = ['off', 'single-tab', 'multi-tab'] as const;
export type OfflineCacheMode = (typeof OFFLINE_CACHE_MODES)[number];

/**
 * When Google Analytics tracks a visitor (docs/features/analytics.html): `always`, as
 * Arc CMS always did, or `required`, only once they accepted the site usage banner.
 */
export const ANALYTICS_CONSENT_MODES = ['always', 'required'] as const;
export type AnalyticsConsentMode = (typeof ANALYTICS_CONSENT_MODES)[number];

/** One project's entry in `arc-install.ts`, as written by `arc:configure`. */
export interface ArcInstallConfig {
    /** Firestore database id. Default `(default)`. */
    databaseId?: string;
    /** Storage bucket name (without `gs://`). Default: `firebaseConfig.storageBucket`. */
    storageBucket?: string;
    /** Folder prepended to every new upload, such as `arccms/`. Default: none. */
    storagePrefix?: string;
    /**
     * Admin-only sign-in (CO6.6): onboarding turns sign-ups off once the first
     * admin exists. Set by `arc:configure` (on by default for the backend profile).
     */
    adminOnlySignIn?: boolean;
    /**
     * The region the Cloud Functions run in, next to the database. Set by
     * `arc:configure` (docs/operations/deploy.html#regions). Default us-central1.
     */
    functionsRegion?: string;
    /**
     * The install's own Firebase Hosting site, or `none` when it publishes no
     * website. Set by `arc:configure`. Default: the project's default site.
     */
    hostingSite?: string;
    /**
     * Firestore's offline cache: data loaded stays on the device and writes made
     * offline are sent later. Set by `arc:configure --offline-cache`. Default off.
     */
    offlineCache?: OfflineCacheMode;
    /**
     * Whether analytics waits for consent. Set by `arc:configure --analytics-consent`.
     * Default `always`.
     */
    analyticsConsent?: AnalyticsConsentMode;
}

export interface ResolvedArcConfig {
    databaseId: string;
    /** `null` means the bucket from `firebaseConfig`. */
    storageBucket: string | null;
    /** Empty, or a folder ending in `/`. */
    storagePrefix: string;
    adminOnlySignIn: boolean;
    functionsRegion: string;
    /** The install's own Hosting site, `none` for no website, or '' for the project's default site. */
    hostingSite: string;
    /** `off` unless the install turned it on. */
    offlineCache: OfflineCacheMode;
    /** `always` unless the install asks for consent first. */
    analyticsConsent: AnalyticsConsentMode;
}

/** Fills in the defaults and normalises what was given. */
export function resolveArcConfig(raw: ArcInstallConfig | undefined): ResolvedArcConfig {
    const bucket = raw?.storageBucket?.trim().replace(/^gs:\/\//, '').replace(/\/+$/, '');
    const prefix = (raw?.storagePrefix ?? '').trim().replace(/^\/+/, '');
    return {
        databaseId: raw?.databaseId?.trim() || DEFAULT_DATABASE_ID,
        storageBucket: bucket || null,
        storagePrefix: prefix && !prefix.endsWith('/') ? `${prefix}/` : prefix,
        adminOnlySignIn: raw?.adminOnlySignIn === true,
        functionsRegion: raw?.functionsRegion?.trim() || DEFAULT_FUNCTIONS_REGION,
        hostingSite: raw?.hostingSite?.trim() || '',
        // Anything but a known mode is off: a typo must never half-enable a cache.
        offlineCache: OFFLINE_CACHE_MODES.includes(raw?.offlineCache as OfflineCacheMode)
            ? (raw!.offlineCache as OfflineCacheMode)
            : 'off',
        // Only the exact word turns consent on; anything else keeps today's tracking.
        analyticsConsent: raw?.analyticsConsent === 'required' ? 'required' : 'always',
    };
}

/**
 * This build's entry: the one for its Firebase project. A file written before
 * CO3.2 held a single entry for every project, and is still read that way.
 */
export function installConfigFor(
    file: Record<string, unknown>,
    projectId: string | undefined,
): ArcInstallConfig | undefined {
    const isSingleEntry = ['databaseId', 'storageBucket', 'storagePrefix'].some((key) => key in file);
    if (isSingleEntry) return file as ArcInstallConfig;
    return projectId ? (file[projectId] as ArcInstallConfig | undefined) : undefined;
}

export const arcConfig: ResolvedArcConfig = resolveArcConfig(
    installConfigFor(arcInstall as Record<string, unknown>, environment.firebaseConfig?.projectId),
);

/**
 * Puts a new upload's path inside the install's storage folder. A path that is
 * already inside it is returned unchanged, so re-importing an export does not
 * nest the folder twice. With no prefix configured the path is untouched.
 */
export function withStoragePrefix(path: string, prefix: string = arcConfig.storagePrefix): string {
    if (!prefix || path.startsWith(prefix)) return path;
    return `${prefix}${path.replace(/^\/+/, '')}`;
}
