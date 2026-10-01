import { createRequire } from 'node:module';
import type * as Cheerio from 'cheerio';

/**
 * cheerio, loaded the first time a function parses HTML rather than when the
 * codebase loads. Every function loads the whole codebase on a cold start, so a
 * library imported at the top of a file slows the start of every function,
 * sign-in included, even ones that never use it (docs/app/functions.html, "Keep cold starts short").
 */
const require = createRequire(import.meta.url);
let cheerio: typeof Cheerio | undefined;

export function loadHtml(...args: Parameters<typeof Cheerio.load>): Cheerio.CheerioAPI {
    cheerio ??= require('cheerio') as typeof Cheerio;
    return cheerio.load(...args);
}
