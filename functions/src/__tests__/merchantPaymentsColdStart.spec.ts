/**
 * Rule 8: a webhook must answer inside 10 seconds, cold start included, so its function loads
 * little. Walks what webhook.ts imports at the top of its files, as an instance loads them
 * (functions/src/load-functions.ts), and holds that to a short list.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Every file and package a file loads as it starts: not `import type`, and not `await import()`. */
function loadedBy(entry: string): { files: Set<string>; packages: Set<string> } {
    const files = new Set<string>();
    const packages = new Set<string>();
    const walk = (file: string) => {
        if (files.has(file)) return;
        files.add(file);
        for (const line of readFileSync(file, 'utf8').split('\n')) {
            const match = /^\s*(?:import|export)\s+(?!type\b)(?:[^'"]*\sfrom\s+)?['"]([^'"]+)['"]/.exec(line);
            if (!match) continue;
            const target = match[1];
            if (!target.startsWith('.')) {
                packages.add(target);
                continue;
            }
            const next = resolve(dirname(file), target.replace(/\.js$/, '.ts'));
            if (existsSync(next)) walk(next);
            else if (!/\.gen\.ts$/.test(next)) throw new Error(`cannot follow ${target} from ${file}`);
        }
    };
    walk(entry);
    return { files, packages };
}

describe('the webhook\'s cold start', () => {
    const { files, packages } = loadedBy(resolve(SRC, 'merchant-payments/webhook.ts'));
    const local = [...files].map((file) => relative(SRC, file)).sort();

    it('loads none of the app\'s code', () => {
        expect(local.filter((file) => file.startsWith('custom/'))).toEqual([]);
    });

    it('loads no provider\'s SDK and no slow library', () => {
        const slow = ['connect-sdk-nodejs', 'googleapis', 'cheerio', 'dodopayments', 'nodemailer', 'google-auth-library'];
        expect([...packages].filter((name) => slow.some((lib) => name === lib || name.startsWith(`${lib}/`)))).toEqual([]);
    });

    it('loads only its own code and the two files every function does', () => {
        const outside = local.filter((file) => !file.startsWith('merchant-payments/'));
        expect(outside).toEqual(['arc-config.ts', 'function-names.ts', 'init.ts']);
    });

    it('loads only what firebase gives every function', () => {
        const allowed = /^(node:|firebase-admin\/|firebase-functions(\/|$))/;
        expect([...packages].filter((name) => !allowed.test(name))).toEqual([]);
    });

    it('nothing in the connectors imports the SDK at the top', () => {
        const source = readFileSync(resolve(SRC, 'merchant-payments/connectors/worldlineConnect.ts'), 'utf8');
        expect(source).not.toMatch(/^import [^;]*connect-sdk-nodejs/m);
        expect(source).toContain("await import('connect-sdk-nodejs')");
    });

    it('sets a short limit, so a hung instance cannot hold a provider past its own', () => {
        const source = readFileSync(resolve(SRC, 'merchant-payments/webhook.ts'), 'utf8');
        expect(source).toMatch(/onRequest\(\{ timeoutSeconds: 10/);
        expect(source).toMatch(/ANSWER_WITHIN_MS = 6_000/);
    });
});
