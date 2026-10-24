/**
 * Every deploy rebuilds firebase.<projectId>.json from firebase.json (docs/operations/deploy.html).
 * The file used to be written once by arc:configure and kept whatever firebase.json said
 * then, so a Hosting header added later (no-store on /_arc/, found 2026-10-24) never went
 * live on a project whose deploys use the generated file.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as configure from '../arc-configure.mjs';

const ROOT = resolve(__dirname, '../..');
const committedFirebase = JSON.parse(readFileSync(join(ROOT, 'firebase.json'), 'utf8'));
const OWN_SITE = { databaseId: 'arccms', hostingSite: 'acme-arccms', storageBucket: 'acme-arccms' };

describe('rebuilding firebase.<projectId>.json on every deploy', () => {
    let dir: string;
    let paths: Record<string, string>;
    const generated = (id: string) => join(dir, `firebase.${id}.json`);
    const read = (id: string) => JSON.parse(readFileSync(generated(id), 'utf8'));
    const headerSources = (config: { hosting?: { headers?: { source: string }[] } }) => (config.hosting?.headers ?? []).map((h) => h.source);

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'arc-refresh-'));
        mkdirSync(join(dir, 'functions'));
        paths = {
            config: join(dir, 'arccms.config.json'),
            firebase: join(dir, 'firebase.json'),
            firebaserc: join(dir, '.firebaserc'),
            root: dir,
            install: join(dir, 'arc-install.ts'),
            functionsDir: join(dir, 'functions'),
        };
        writeFileSync(paths.firebase, JSON.stringify(committedFirebase));
        writeFileSync(paths.firebaserc, JSON.stringify({ projects: { default: 'acme-dev' } }));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('brings a header added to firebase.json into a file arc:configure wrote before it', () => {
        writeFileSync(paths.config, JSON.stringify({ projects: { 'acme-dev': OWN_SITE } }));
        expect(configure.main(['--project=default'], paths, () => {})).toBe(0);
        expect(headerSources(read('acme-dev'))).toContain('/_arc/**');

        // firebase.json gains a header after the project was set up.
        const later = structuredClone(committedFirebase);
        later.hosting.headers.push({ source: '/_later/**', headers: [{ key: 'Cache-Control', value: 'no-store' }] });
        writeFileSync(paths.firebase, JSON.stringify(later));

        expect(configure.refreshFirebaseConfig('acme-dev', paths)).toBe('updated');
        const config = read('acme-dev');
        expect(headerSources(config)).toContain('/_later/**');
        // The project's own settings stay: its site and named database.
        expect(config.hosting.site).toBe('acme-arccms');
        expect(config.firestore[0].database).toBe('arccms');
        expect(configure.refreshFirebaseConfig('acme-dev', paths)).toBe('unchanged');
    });

    it('writes exactly what arc:configure writes', () => {
        writeFileSync(paths.config, JSON.stringify({ projects: { 'acme-dev': { ...OWN_SITE, functionsRegion: 'asia-south1' } } }));
        expect(configure.main(['--project=default'], paths, () => {})).toBe(0);
        expect(configure.refreshFirebaseConfig('acme-dev', paths)).toBe('unchanged');
    });

    it('creates the file for a set-up project that has none, as arc:configure would', () => {
        writeFileSync(paths.config, JSON.stringify({ projects: { 'acme-dev': OWN_SITE } }));
        expect(configure.refreshFirebaseConfig('acme-dev', paths)).toBe('created');
        expect(read('acme-dev').hosting.site).toBe('acme-arccms');
    });

    it('leaves alone a project arccms.config.json does not set up, or one that needs no generated file', () => {
        expect(configure.refreshFirebaseConfig('acme-dev', paths)).toBe('skipped'); // no arccms.config.json
        writeFileSync(paths.config, JSON.stringify({ projects: { other: OWN_SITE } }));
        expect(configure.refreshFirebaseConfig('acme-dev', paths)).toBe('skipped');
        expect(configure.refreshFirebaseConfig('', paths)).toBe('skipped');

        // Settings that change nothing in the Firebase config: a file someone left there is kept.
        writeFileSync(paths.config, JSON.stringify({ projects: { 'acme-dev': { production: 'yes' } } }));
        writeFileSync(generated('acme-dev'), '{"kept": true}\n');
        expect(configure.refreshFirebaseConfig('acme-dev', paths)).toBe('skipped');
        expect(readFileSync(generated('acme-dev'), 'utf8')).toBe('{"kept": true}\n');
        expect(existsSync(paths.install)).toBe(false);
    });

    it('runs in every deploy before the generated file is read', () => {
        const source = readFileSync(join(ROOT, 'scripts/arc-deploy.mjs'), 'utf8');
        const body = source.slice(source.indexOf('export async function runDeploy('));
        const refresh = body.indexOf('refreshFirebaseConfig)(projectId)');
        expect(refresh).toBeGreaterThan(-1);
        expect(refresh).toBeLessThan(body.indexOf('const generated = '));
    });
});
