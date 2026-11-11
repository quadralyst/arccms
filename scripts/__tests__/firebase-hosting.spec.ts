import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PRIVATE_PAGES, SITE_WIDE, withAppHeaders } from '../arc-headers.mjs';

const ROOT = join(__dirname, '..', '..');
const firebase = JSON.parse(readFileSync(join(ROOT, 'firebase.json'), 'utf8'));
const rewrites: Array<{ source: string; destination?: string; function?: { functionId: string } }> = firebase.hosting.rewrites;
const group: string = firebase.functions[0].codebase;

const functionSource = (path: string) => readFileSync(join(ROOT, 'functions/src', path), 'utf8');

describe('firebase.json hosting rewrites for public email links', () => {
    const cases = [
        { path: '/unsubscribe', functionName: 'handleUnsubscribe', file: 'email-core/handleUnsubscribe.ts' },
        { path: '/email-preferences', functionName: 'handleEmailPreferences', file: 'email-core/handleEmailPreferences.ts' },
    ];

    for (const { path, functionName, file } of cases) {
        it(`sends ${path} to the ${group}-${functionName} function, before the catch-all`, () => {
            const index = rewrites.findIndex((r) => r.source === path);
            expect(index).toBeGreaterThanOrEqual(0);
            expect(rewrites[index].function?.functionId).toBe(`${group}-${functionName}`);
            expect(index).toBeLessThan(rewrites.findIndex((r) => r.source === '**'));
            expect(functionSource(file)).toContain(`export const ${functionName} = onRequest(`);
        });
    }

    it('matches the exact paths only, so the old /unsubscribe/:waitlistId/:userId pages still reach the app', () => {
        for (const { path } of cases) expect(path).not.toMatch(/[*:]/);
    });

    it('builds the emailed links on the same paths', () => {
        const source = functionSource('email-core/unsubscribeToken.ts');
        expect(source).toContain('}unsubscribe?e=');
        expect(source).toContain('}email-preferences?e=');
    });
});

// RF6 6.3: sign-in, member, admin, checkout and setup addresses stay out of search with
// a header, which works before any script runs; public addresses never get it.
describe('firebase.json keeps private addresses out of search', () => {
    type Rule = { source?: string; regex?: string; headers: Array<{ key: string; value: string }> };
    const noindexFor = (config: { hosting: { headers: Rule[] } }, path: string) => config.hosting.headers
        .filter((rule) => rule.regex && new RegExp(rule.regex).test(path))
        .some((rule) => rule.headers.some((h) => h.key === 'X-Robots-Tag' && h.value === 'noindex'));

    it('sends X-Robots-Tag: noindex on them', () => {
        const rule = (firebase.hosting.headers as Rule[]).find((r) => r.regex === PRIVATE_PAGES);
        expect(rule?.headers).toEqual([{ key: 'X-Robots-Tag', value: 'noindex' }]);
        for (const path of ['/admin', '/admin/dashboard', '/signup', '/signup/', '/profile', '/account', '/auth-checker',
            '/user/dashboard', '/user/payments', '/onboarding', '/checkout/success']) {
            expect(noindexFor(firebase, path), path).toBe(true);
        }
    });

    it('leaves public addresses alone', () => {
        for (const path of ['/', '/pricing', '/waitlist/launch', '/articles/my-post', '/hi', '/search', '/signups-explained', '/users-guide', '/pages/terms']) {
            expect(noindexFor(firebase, path), path).toBe(false);
        }
    });

    it('keeps the header in the config a deploy builds with the app\'s own headers', () => {
        const built = withAppHeaders(firebase, [{ source: '**', headers: [{ key: 'Permissions-Policy', value: 'camera=(self)' }] }]);
        expect(noindexFor(built, '/admin/dashboard')).toBe(true);
    });
});

describe('firebase.json hosting headers for the site\'s source files', () => {
    it('keeps /_site/ (raw templates, header, home page source) out of search engines', () => {
        const rule = (firebase.hosting.headers as Array<{ source: string; headers: Array<{ key: string; value: string }> }>)
            .find((h) => h.source === '/_site/**');
        expect(rule?.headers).toContainEqual({ key: 'X-Robots-Tag', value: 'noindex' });
    });
});

type HeaderRule = { source?: string; regex?: string; headers: Array<{ key: string; value: string }> };
type HostingConfig = { hosting?: { headers?: HeaderRule[] } };

/** The headers every address gets: Arc CMS's site-wide rule (scripts/arc-headers.mjs SITE_WIDE). */
const everyAddress = (config: HostingConfig) => Object.fromEntries(
    (config.hosting?.headers ?? []).filter((rule) => rule.regex === SITE_WIDE).flatMap((rule) => rule.headers.map((h) => [h.key, h.value])),
);

describe('firebase.json security headers on every address (docs/operations/deploy.html#security-headers)', () => {
    const headers = everyAddress(firebase);

    it('sends them on every address but Firebase\'s own under /__/ (its sign-in helper is framed from the auth domain)', () => {
        expect(Object.keys(headers).length).toBeGreaterThan(0);
        expect(new RegExp(SITE_WIDE).test('/__/auth/iframe')).toBe(false);
        expect(new RegExp(SITE_WIDE).test('/admin')).toBe(true);
        // The app shell the service worker serves offline is a page like any other.
        for (const path of ['/', '/__shell.html', '/__', '/_site/x.json', '/_arc/y']) expect(new RegExp(SITE_WIDE).test(path)).toBe(true);
        expect(new RegExp(SITE_WIDE).test('/__/auth/handler')).toBe(false);
    });

    it('sends frame protection, nosniff, a referrer policy and HSTS for the site\'s own domain only', () => {
        expect(headers['X-Frame-Options']).toBe('SAMEORIGIN');
        expect(headers['X-Content-Type-Options']).toBe('nosniff');
        expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
        // Apps run on their owners' domains: no includeSubDomains, no preload.
        expect(headers['Strict-Transport-Security']).toBe('max-age=31536000');
    });

    it('turns off the camera, geolocation and payments, which core never uses, and keeps the microphone for voice feedback', () => {
        const policy = headers['Permissions-Policy'];
        expect(policy).toContain('camera=()');
        expect(policy).toContain('geolocation=()');
        expect(policy).toContain('payment=()');
        expect(policy).toContain('microphone=(self)');
        expect(readFileSync(join(ROOT, 'src/app/core/feedback/voice-recorder.ts'), 'utf8')).toContain('getUserMedia({ audio: true })');
    });

    it('reports, without enforcing, a Content-Security-Policy with no reporting address, and refuses other sites\' frames', () => {
        expect(headers['Content-Security-Policy']).toBeUndefined();
        const csp = headers['Content-Security-Policy-Report-Only'];
        expect(csp).not.toMatch(/report-(uri|to)/);
        const directives = Object.fromEntries(csp.split(';').map((d: string) => d.trim().split(/\s+/)).map(([name, ...values]: string[]) => [name, values]));
        expect(directives['frame-ancestors']).toEqual(["'self'"]);
        expect(directives['object-src']).toEqual(["'none'"]);
        expect(directives['default-src']).toEqual(["'self'"]);
        // What core loads: Firebase and Google, analytics, sign-in with Google, the editor's YouTube embeds.
        expect(directives['connect-src']).toEqual(expect.arrayContaining(["'self'", 'https://*.googleapis.com', 'https://*.cloudfunctions.net', 'https://*.google-analytics.com']));
        expect(directives['script-src']).toEqual(expect.arrayContaining(["'self'", 'https://apis.google.com', 'https://www.googletagmanager.com']));
        expect(directives['frame-src']).toEqual(expect.arrayContaining(['https://*.firebaseapp.com', 'https://www.youtube-nocookie.com']));
        expect(directives['style-src']).toContain("'unsafe-inline'");
    });

    it('lets a sandboxed preview frame load the site\'s fonts', () => {
        const fonts = (firebase.hosting.headers as HeaderRule[]).find((rule) => rule.source === '**/*.@(woff|woff2|ttf|otf)');
        expect(fonts?.headers).toContainEqual({ key: 'Access-Control-Allow-Origin', value: '*' });
    });

    it('reaches the generated per-project file and the website deploy\'s config unchanged', async () => {
        const configure = await import('../arc-configure.mjs');
        const generated = configure.renderFirebaseConfig(firebase, configure.normalizeConfig({ databaseId: 'arccms', hostingSite: 'acme-arccms', functionsRegion: 'asia-south1' }));
        expect(generated).not.toBeNull();
        expect(everyAddress(generated)).toEqual(headers);
        const { withAppRedirects } = await import('../arc-redirects.mjs');
        expect(everyAddress(withAppRedirects(generated, [{ source: '/old.html', destination: '/new', type: 301 }]))).toEqual(headers);
    });
});
