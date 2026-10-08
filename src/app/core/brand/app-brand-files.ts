/**
 * The app's brand files in the custom space (docs/app/admin-look.html), found by the
 * bundler: a missing file is simply none, with nothing to declare and no build error.
 * Core specs see none (src/test/setup.ts); an app's own specs see its files.
 */

/** The first file found, in the order of `extensions`, as a URL the page can load, or ''. */
function first(files: Record<string, string>, extensions: string[]): string {
    const ext = (path: string) => extensions.indexOf(path.slice(path.lastIndexOf('.') + 1));
    const paths = Object.keys(files).sort((a, b) => ext(a) - ext(b));
    return paths.length ? files[paths[0]] : '';
}

/** src/custom/logo.svg, .png or .webp: the logo beside the site's name. */
export const APP_LOGO = first(
    import.meta.glob<string>('../../../custom/logo.{svg,png,webp}', { eager: true, query: '?url', import: 'default' }),
    ['svg', 'png', 'webp'],
);

/** src/custom/sign-in-image.*: the image that fills the sign-in page's brand panel. */
export const SIGN_IN_IMAGE = first(
    import.meta.glob<string>('../../../custom/sign-in-image.{webp,jpg,jpeg,png,svg}', { eager: true, query: '?url', import: 'default' }),
    ['webp', 'jpg', 'jpeg', 'png', 'svg'],
);
