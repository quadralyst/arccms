/**
 * CO2 guard (docs/coexistence-spec.md): the install's database and hosting site
 * come from arc-config. Code that opens Firestore itself, or builds hosting URLs
 * from the project id, silently ignores that config on a shared-project install.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..');

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
        return path.endsWith('.ts') ? [path] : [];
    });
}

const files = sourceFiles(SRC).map((path) => ({
    path: relative(SRC, path),
    code: readFileSync(path, 'utf8'),
}));

describe('arc-config guard (functions)', () => {
    it('only init.ts calls getFirestore()', () => {
        const offenders = files
            .filter((f) => f.path !== 'init.ts' && /\bgetFirestore\s*\(/.test(f.code))
            .map((f) => f.path);
        expect(offenders).toEqual([]);
    });

    it('only arc-config.ts derives the hosting site from GCLOUD_PROJECT', () => {
        const offenders = files
            .filter((f) => f.path !== 'arc-config.ts')
            .filter((f) => /GCLOUD_PROJECT[^\n]*\.web\.app|siteId\s*=[^\n]*GCLOUD_PROJECT|deployBatchToHosting\(\s*process\.env\.GCLOUD_PROJECT/.test(f.code))
            .map((f) => f.path);
        expect(offenders).toEqual([]);
    });

    // The one trigger that watches another database on purpose: the host app's users (CO6.4).
    const HOST_TRIGGER = 'app-audience/onAppUserWritten.ts';

    it('every Firestore trigger binds to the install database through arcDocument()', () => {
        const trigger = /onDocument(?:Created|Updated|Deleted|Written)(?:WithAuthContext)?\((?!\s*(?:arcDocument\(|\{\s*\.\.\.arcDocument\())/;
        const offenders = files
            .filter((f) => f.path !== 'arc-config.ts' && f.path !== HOST_TRIGGER)
            .filter((f) => trigger.test(f.code))
            .map((f) => f.path);
        expect(offenders).toEqual([]);
    });

    it('the App audience trigger binds to the host collection set at deploy time, never a fixed one', () => {
        const code = files.find((f) => f.path === HOST_TRIGGER)?.code ?? '';
        expect(code).toMatch(/onDocumentWritten\(\s*\{\s*document:\s*appUsersPathParam,\s*database:\s*appUsersDatabaseParam\s*\}/);
    });
});
