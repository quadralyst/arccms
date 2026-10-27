/**
 * CO2 guard (specs/coexistence-spec.md): the browser app opens Firestore and
 * Storage only through arc-firebase.ts, so the install's database and bucket
 * apply everywhere.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..', '..', '..');

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return sourceFiles(path);
        return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
    });
}

describe('arc-config guard (frontend)', () => {
    it('only arc-firebase.ts opens Firestore and only arc-storage-bucket.ts Storage, or sets up or clears the offline cache', () => {
        // The bucket has its own file, loaded when first used, so Storage stays out of the first script (F34).
        const own = [join('core', 'config', 'arc-firebase.ts'), join('core', 'config', 'arc-storage-bucket.ts')];
        const offenders = sourceFiles(SRC)
            .filter((path) => !own.some((file) => path.endsWith(file)))
            .filter((path) => /\b(getFirestore|getStorage|initializeFirestore|persistentLocalCache|clearIndexedDbPersistence|enableIndexedDbPersistence|enableMultiTabIndexedDbPersistence)\s*\(/.test(readFileSync(path, 'utf8')))
            .map((path) => relative(SRC, path));
        expect(offenders).toEqual([]);
    });
});
