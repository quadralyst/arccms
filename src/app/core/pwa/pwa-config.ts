/**
 * The install's PWA settings (docs/pwa.md): Arc CMS defaults, with the app's own
 * `src/custom/pwa.ts` laid over them. Plain TypeScript with no Angular imports,
 * because vite.config.ts reads it at build time to write the manifest and the
 * service worker.
 */

export interface PwaConfig {
    /** Off: no manifest, no service worker, no install prompt (a plain website). */
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
}

export const DEFAULT_PWA_CONFIG: PwaConfig = {
    enabled: false,
    name: 'Arc CMS',
    shortName: 'Arc CMS',
    description: '',
    themeColor: '#1d47a3',
    backgroundColor: '#ffffff',
    startUrl: '/',
};

/** The icon the app provides, first match wins; else Arc CMS's own. Paths from the repo root. */
export const PWA_ICON_CANDIDATES = ['src/custom/pwa-icon.svg', 'src/custom/pwa-icon.png'];
export const DEFAULT_PWA_ICON = 'src/app/core/pwa/default-icon.svg';

export function resolvePwaConfig(custom: Partial<PwaConfig> | undefined): PwaConfig {
    const merged = { ...DEFAULT_PWA_CONFIG, ...(custom ?? {}) };
    return { ...merged, shortName: merged.shortName || merged.name };
}
