/**
 * The app's own response headers (scripts/arc-headers.mjs, docs/operations/deploy.html#security-headers):
 * src/custom/site/headers.json, checked, and put in the website deploy's Hosting config.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { APP_HEADERS, SITE_WIDE, headerProblems, readAppHeaders, withAppHeaders } from '../arc-headers.mjs';
import { websiteConfigPath, writeWebsiteConfig } from '../arc-redirects.mjs';

const ROOT = resolve(__dirname, '../..');
const committedFirebase = JSON.parse(readFileSync(join(ROOT, 'firebase.json'), 'utf8'));
const CAMERA = 'camera=(self), microphone=(self), geolocation=(), payment=()';

type Rule = { source?: string; regex?: string; headers: { key: string; value: string }[] };
const rules = (config: { hosting: { headers: Rule[] } }) => config.hosting.headers;
/** A rule's headers by its source, or `**` for Arc CMS's site-wide rule. */
const valueOf = (config: { hosting: { headers: Rule[] } }, source: string, key: string) =>
    rules(config).filter((rule) => (source === '**' ? rule.regex === SITE_WIDE : rule.source === source))
        .flatMap((rule) => rule.headers).filter((h) => h.key === key).map((h) => h.value);

describe('withAppHeaders', () => {
    it('replaces Arc CMS\'s value of a header on every address, so one value is in force, and keeps the rest', () => {
        const out = withAppHeaders(committedFirebase, [{ source: '**', headers: [{ key: 'permissions-policy', value: CAMERA }] }]);
        expect(valueOf(out, '**', 'permissions-policy')).toEqual([CAMERA]);
        expect(valueOf(out, '**', 'Permissions-Policy')).toEqual([]);
        expect(valueOf(out, '**', 'X-Frame-Options')).toEqual(['SAMEORIGIN']);
        expect(rules(out).filter((rule) => rule.source === '**' || rule.regex === SITE_WIDE)).toHaveLength(1);
        // The committed config itself is untouched.
        expect(valueOf(committedFirebase, '**', 'Permissions-Policy')[0]).toContain('camera=()');
    });

    it('adds a new header on every address, and a rule for some addresses after Arc CMS\'s own', () => {
        const kiosk = { source: '/kiosk/**', headers: [{ key: 'Cache-Control', value: 'no-store' }] };
        const out = withAppHeaders(committedFirebase, [{ source: '**', headers: [{ key: 'Cross-Origin-Opener-Policy', value: 'same-origin' }] }, kiosk]);
        expect(valueOf(out, '**', 'Cross-Origin-Opener-Policy')).toEqual(['same-origin']);
        expect(rules(out).at(-1)).toEqual(kiosk);
        expect(rules(out)).toHaveLength(rules(committedFirebase).length + 1);
    });

    it('leaves a config without Hosting, or no rules, as it is', () => {
        expect(withAppHeaders(committedFirebase, [])).toBe(committedFirebase);
        const noHosting = { functions: [] };
        expect(withAppHeaders(noHosting, [{ source: '**', headers: [{ key: 'X', value: 'y' }] }])).toBe(noHosting);
    });
});

describe('Arc CMS\'s site-wide rule', () => {
    it('matches every address but Firebase\'s own under /__/, whose sign-in helper another origin frames', () => {
        const site = new RegExp(SITE_WIDE);
        // The app shell (/__shell.html), which the service worker serves offline, is a page like any other.
        for (const path of ['/', '/admin/dashboard', '/_site/site.json', '/_arc/version.json', '/_', '/a__b', '/__shell.html', '/__']) expect(site.test(path), path).toBe(true);
        for (const path of ['/__/auth/iframe', '/__/auth/handler', '/__/firebase/init.json']) expect(site.test(path), path).toBe(false);
        expect(rules(committedFirebase).filter((rule) => rule.regex === SITE_WIDE)).toHaveLength(1);
    });
});

describe('headerProblems', () => {
    it('takes a well-formed list', () => {
        expect(headerProblems([
            { source: '**', headers: [{ key: 'Permissions-Policy', value: CAMERA }] },
            { regex: '^/kiosk/.*$', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
        ], committedFirebase)).toEqual([]);
    });

    it('names each mistake', () => {
        const problems = headerProblems([
            { source: 'kiosk', headers: [{ key: 'X', value: 'y' }] },
            { source: '/a', headers: [] },
            { source: '/b', headers: [{ key: 'Bad Name', value: 'x\ny' }] },
            { source: '/c', headers: [{ key: 'Permissions-Policy', value: CAMERA }] },
            { source: '/d', regex: '^/d$', target: 1, headers: [{ key: 'X', value: 'y' }] },
        ], committedFirebase);
        expect(problems).toEqual([
            'Rule 1 ("kiosk"): "source" must be an address pattern starting with "/" or "**".',
            'Rule 2 ("/a") has no "headers": a list of { "key": ..., "value": ... }.',
            'Rule 3 ("/b"), header 1: "key" must be a header name such as "Permissions-Policy".',
            'Rule 3 ("/b"), header 1: "value" must be text on one line.',
            'Rule 4 ("/c"), header 1: Arc CMS sends Permissions-Policy on every address, so change it in a "**" rule, which replaces Arc CMS\'s value.',
            'Rule 5 ("/d") has an unknown field "target" (allowed: source, regex, headers).',
            'Rule 5 ("/d") has both "source" and "regex": give one.',
        ]);
        expect(headerProblems({ source: '**' })).toHaveLength(1);
    });
});

describe('the app\'s headers file', () => {
    let dir: string;
    const put = (text: string) => {
        const file = join(dir, APP_HEADERS);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, text);
    };

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'arc-headers-'));
        writeFileSync(join(dir, 'firebase.json'), JSON.stringify(committedFirebase));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('is optional', () => {
        expect(readAppHeaders(dir)).toEqual([]);
    });

    it('stops with what is wrong, naming the docs page', () => {
        put('{ nope');
        expect(() => readAppHeaders(dir)).toThrow(/headers\.json is not valid JSON/);
        put(JSON.stringify([{ source: '/x', headers: [{ key: 'X-Frame-Options', value: 'DENY' }] }]));
        expect(() => readAppHeaders(dir)).toThrow(/a problem \(see docs\/operations\/deploy\.html#security-headers\)/);
    });

    it('goes into the website deploy\'s config, with or without redirects', () => {
        const list = [{ source: '**', headers: [{ key: 'Permissions-Policy', value: CAMERA }] }];
        put(JSON.stringify(list));
        const headers = readAppHeaders(dir);
        const path = writeWebsiteConfig('acme-dev', committedFirebase, [], dir, headers);
        expect(path).toBe(websiteConfigPath('acme-dev', dir));
        expect(valueOf(JSON.parse(readFileSync(path!, 'utf8')), '**', 'Permissions-Policy')).toEqual([CAMERA]);
        rmSync(path!);
        expect(writeWebsiteConfig('acme-dev', committedFirebase, [], dir, [])).toBeNull();
        expect(existsSync(websiteConfigPath('acme-dev', dir))).toBe(false);
    });
});
