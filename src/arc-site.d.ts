/** The public website's header, footer and manifest, from scripts/vite-arc-site.ts. */
declare module 'virtual:arc-site' {
    import type { SiteManifest } from './app/core/site/site';

    /** The site header, an HTML fragment (/_site/header.html). */
    export const header: string;
    /** The site footer, an HTML fragment (/_site/footer.html). */
    export const footer: string;
    /** The sign-in page's brand panel, an HTML fragment (/_site/sign-in.html). */
    export const signIn: string;
    /** What the site holds (/_site/site.json). */
    export const manifest: SiteManifest;
}
