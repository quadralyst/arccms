/**
 * The install's PWA settings (docs/features/pwa.html): Arc CMS defaults, with the app's own
 * `src/custom/pwa.ts` laid over them. Plain TypeScript with no Angular imports,
 * because vite.config.ts reads it at build time to write the manifest and the
 * service worker.
 */

export interface PwaConfig {
    /**
     * Off: no manifest, no service worker, no install prompt (a plain website).
     * Set by `on: ['pwa']` in src/custom/features.ts, not in pwa.ts.
     */
    enabled: boolean;
    /** Full name, shown when installing and in the app switcher. */
    name: string;
    /** Under the home-screen icon; keep it to about 12 characters. */
    shortName: string;
    description: string;
    /** Browser bar and status bar colour. */
    themeColor: string;
    /** Splash screen background while the app opens. */
    backgroundColor: string;
    /** The page the home-screen icon opens. */
    startUrl: string;
    /**
     * Which screens' code is stored on the device when the app installs or updates
     * (docs/app/pwa.html#open-screens-offline-and-after-a-deploy): `visited` (only
     * what every page needs; the rest as it is first opened), `app` (every screen
     * outside the admin area too) or `all` (every screen).
     */
    routeCode: RouteCodeMode;
    /**
     * How many seconds a page waits for the network before the stored copy opens
     * (docs/features/pwa.html). Lower it for an app that is often on a network
     * without internet, such as a kiosk on a closed Wi-Fi. From 1 to 30.
     */
    navigationTimeoutSeconds: number;
}

export const ROUTE_CODE_MODES = ['visited', 'app', 'all'] as const;
export type RouteCodeMode = (typeof ROUTE_CODE_MODES)[number];

export const DEFAULT_PWA_CONFIG: PwaConfig = {
    enabled: false,
    name: 'Arc CMS',
    shortName: 'Arc CMS',
    description: '',
    themeColor: '#1d47a3',
    backgroundColor: '#ffffff',
    startUrl: '/',
    routeCode: 'visited',
    navigationTimeoutSeconds: 4,
};

/** The range `navigationTimeoutSeconds` must be in. */
export const NAVIGATION_TIMEOUT_BOUNDS = { min: 1, max: 30 } as const;

/** The icon the app provides, first match wins; else Arc CMS's own. Paths from the repo root. */
export const PWA_ICON_CANDIDATES = ['src/custom/pwa-icon.svg', 'src/custom/pwa-icon.png'];
export const DEFAULT_PWA_ICON = 'src/app/core/pwa/default-icon.svg';

/**
 * The PWA's settings. `enabled` comes from the features (`on: ['pwa']` in
 * src/custom/features.ts), never from pwa.ts: an app that still switches it there
 * gets an error saying where the switch went, rather than a PWA that silently
 * changes state after an update.
 */
export function resolvePwaConfig(custom: Partial<PwaConfig> | undefined, enabled: boolean): PwaConfig {
    if (custom && 'enabled' in custom) {
        throw new Error(
            "src/custom/pwa.ts: the PWA is now switched in src/custom/features.ts. " +
            "Delete `enabled` from pwa.ts, and to keep the PWA add on: ['pwa'] to CUSTOM_FEATURES.",
        );
    }
    if (custom?.routeCode !== undefined && !ROUTE_CODE_MODES.includes(custom.routeCode)) {
        throw new Error(`src/custom/pwa.ts: routeCode must be one of ${ROUTE_CODE_MODES.join(', ')}, not "${custom.routeCode}".`);
    }
    const timeout = custom?.navigationTimeoutSeconds;
    const { min, max } = NAVIGATION_TIMEOUT_BOUNDS;
    if (timeout !== undefined && !(typeof timeout === 'number' && Number.isFinite(timeout) && timeout >= min && timeout <= max)) {
        throw new Error(`src/custom/pwa.ts: navigationTimeoutSeconds must be a number of seconds from ${min} to ${max}, not ${JSON.stringify(timeout)}.`);
    }
    const merged = { ...DEFAULT_PWA_CONFIG, ...(custom ?? {}), enabled };
    return { ...merged, shortName: merged.shortName || merged.name };
}
