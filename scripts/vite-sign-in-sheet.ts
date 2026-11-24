/**
 * Asks for the sign-in page's stylesheet as soon as `/signup` is opened (F51), before
 * the app's own code: one HTML file is served for every address (__shell.html), so a
 * few lines in its head ask for the file there only. The page then rarely has to wait
 * for it (src/app/core/site/site-styles.ts). Nothing is added when the site has no
 * styles for the sign-in page. A site whose own security policy refuses inline scripts
 * loses only the head start.
 */
import type { Plugin } from 'vite';
import { signInSheetUrl } from './arc-site.mjs';

/** The script for the head, or '' when there is no stylesheet to ask for. */
export function signInSheetScript(url: string | null): string {
    if (!url) return '';
    // The address is a path this repository writes and a hex hash: nothing to escape.
    return `if(/^\\/signup\\/?$/.test(location.pathname)){(function(l){`
        + `l.rel='preload';l.as='style';l.href='${url}';document.head.appendChild(l)})(document.createElement('link'))}`;
}

/** The Vite plugin, for the dev server and the build alike. */
export function signInSheet(root = process.cwd()): Plugin {
    return {
        name: 'arc-sign-in-sheet',
        transformIndexHtml: () => {
            const children = signInSheetScript(signInSheetUrl(root));
            return children ? [{ tag: 'script', children, injectTo: 'head-prepend' }] : [];
        },
    };
}
