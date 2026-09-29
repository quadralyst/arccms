/**
 * The functions in the current build (functions/lib), the `arccms` group as
 * index.js exports it. Its own module: a dynamic import in a script that starts
 * with a #! line breaks the test runner's transform.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './arc-install-config.mjs';

export async function builtArccms() {
    const { arccms } = await import(`${pathToFileURL(resolve(ROOT, 'functions/lib/index.js')).href}?t=${Date.now()}`);
    return arccms;
}
