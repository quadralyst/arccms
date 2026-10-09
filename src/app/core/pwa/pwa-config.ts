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
    /**
     * The square image, at least 512 by 512 pixels, every icon size is made from: an
     * .svg or .png, from the project folder (`src/custom/brands/acme/icon.svg`). Unset,
     * it is src/custom/pwa-icon.svg or .png, else Arc CMS's own. A white-label app names
     * each brand's here.
     */
    icon?: string;
    /**
     * The iPhone and iPad home-screen icon: `padded` (the default) shrinks the icon
     * onto a white tile, which suits a logo on a transparent background; `fill` makes
     * it fill its square with no padding, for an icon that is already a full coloured
     * square. Any transparent corner then shows `backgroundColor`.
     */
    appleIcon: AppleIconMode;
}

export const APPLE_ICON_MODES = ['padded', 'fill'] as const;
export type AppleIconMode = (typeof APPLE_ICON_MODES)[number];

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
    appleIcon: 'padded',
};

/** The range `navigationTimeoutSeconds` must be in. */
export const NAVIGATION_TIMEOUT_BOUNDS = { min: 1, max: 30 } as const;

/** The icon the app provides when pwa.ts names none, first match wins; else Arc CMS's own. Paths from the repo root. */
export const PWA_ICON_CANDIDATES = ['src/custom/pwa-icon.svg', 'src/custom/pwa-icon.png'];
export const DEFAULT_PWA_ICON = 'src/app/core/pwa/default-icon.svg';

/**
 * The image the PWA's icons are made from (`icon` in src/custom/pwa.ts, docs/features/pwa.html):
 * the file pwa.ts names, else the first of PWA_ICON_CANDIDATES that exists, else Arc CMS's
 * own. `exists` says whether a path from the repo root is a file. A named file that is
 * not an .svg or .png, or is not there, stops the build with what to change.
 */
export function resolvePwaIcon(custom: Partial<PwaConfig> | undefined, exists: (path: string) => boolean): string {
    const named = custom?.icon;
    if (named === undefined) return PWA_ICON_CANDIDATES.find(exists) ?? DEFAULT_PWA_ICON;
    if (typeof named !== 'string' || !/\.(svg|png)$/i.test(named)) {
        throw new Error(`src/custom/pwa.ts: icon must name an .svg or .png file, like 'src/custom/brands/acme/icon.svg', not ${JSON.stringify(named)}.`);
    }
    const path = named.replace(/^\.?\//, '');
    if (!exists(path)) {
        throw new Error(`src/custom/pwa.ts: icon names ${named}, which is not there. Give its path from the project folder, like 'src/custom/brands/acme/icon.svg'.`);
    }
    return path;
}

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
    if (custom?.appleIcon !== undefined && !APPLE_ICON_MODES.includes(custom.appleIcon)) {
        throw new Error(`src/custom/pwa.ts: appleIcon must be one of ${APPLE_ICON_MODES.join(', ')}, not ${JSON.stringify(custom.appleIcon)}.`);
    }
    const merged = { ...DEFAULT_PWA_CONFIG, ...(custom ?? {}), enabled };
    return { ...merged, shortName: merged.shortName || merged.name };
}

/**
 * How the build makes the iPhone icon (apple-touch-icon-180x180.png) from the image,
 * as options for the PWA assets generator. Unset is its default: 30% padding on white.
 */
export function appleIconAsset(config: Pick<PwaConfig, 'appleIcon' | 'backgroundColor'>):
    { padding: number; resizeOptions: { fit: 'cover'; background: string } } | undefined {
    if (config.appleIcon !== 'fill') return undefined;
    return { padding: 0, resizeOptions: { fit: 'cover', background: config.backgroundColor } };
}
