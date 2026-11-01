/**
 * The version of this build, such as "v1.2.0.25 android" (docs/app/version.html,
 * specs/app-version-spec.md): `version` in custom/package.json, the build number
 * `npm run build` gave it, and its build label. Fixed when the site is built
 * (vite.config.ts, scripts/arc-version.mjs); an app shows it wherever it likes.
 */
export interface AppVersion {
    /** "v1.2.0.25 android", "v1.2.0" with no build number, '' when the app sets no version. */
    text: string;
    /** "1.2.0", or ''. */
    version: string;
    /** The build number, or null for a build without one (`npm run dev`, `--no-bump`). */
    build: number | null;
    /** "android", or ''. */
    label: string;
    /** The git commit the build was made from, such as "533b6d02" or "533b6d02+changes"; '' outside a git checkout. */
    commit: string;
}

/** The version of a build with none: no custom/package.json, or no version in it. */
export const NO_APP_VERSION: AppVersion = { text: '', version: '', build: null, label: '', commit: '' };

/** Set by vite.config.ts; undefined where Vite did not build the code (the tests). */
declare const __ARC_APP_VERSION__: AppVersion | undefined;

/** The version under Logout in the admin's side panel: '' with none, or when the app turns it off. */
export function panelVersion(version: AppVersion, brand: { showVersion?: boolean }): string {
    return brand.showVersion === false ? '' : version.text;
}

/** This build's version. */
export const APP_VERSION: AppVersion =
    typeof __ARC_APP_VERSION__ === 'undefined' ? NO_APP_VERSION : __ARC_APP_VERSION__;
