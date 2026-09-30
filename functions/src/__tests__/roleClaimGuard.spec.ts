/**
 * CO-D7 guard (specs/coexistence-spec.md): the ArcCMS role is the `arccms_role`
 * claim. A plain `role` claim may belong to an app sharing the sign-in pool, so
 * reading it would make that app's admins ArcCMS admins, and writing it would
 * overwrite theirs. Checks go through isArcAdmin() / arcRoleOf() in
 * users/claims.ts; the rules through arcRole().
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const FUNCTIONS_SRC = join(__dirname, '..');
const REPO = join(FUNCTIONS_SRC, '..', '..');

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return name === '__tests__' || name === 'node_modules' ? [] : sourceFiles(path);
        return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
    });
}

const read = (paths: string[], root: string) =>
    paths.map((path) => ({ path: relative(root, path), code: readFileSync(path, 'utf8') }));

const functionsFiles = read(sourceFiles(FUNCTIONS_SRC), FUNCTIONS_SRC);
const browserFiles = read(sourceFiles(join(REPO, 'src')), REPO);

/** `token.role`, `token?.['role']`, `claims.role`, `customClaims?.['role']` and the like. */
const PLAIN_ROLE_READ = /\b(?:token|claims|customClaims)\??\.(?:role\b|\[\s*'role'\s*\])|\b(?:token|claims|customClaims)\[\s*'role'\s*\]/;
/** A claims patch or setCustomUserClaims() that writes a plain `role` key. */
const PLAIN_ROLE_WRITE = /(?:mergeUserClaims|setCustomUserClaims)\([^)]*[{,]\s*role\s*[:,}]/;

describe('role claim guard (CO-D7)', () => {
    it('no function reads a plain `role` claim', () => {
        const offenders = functionsFiles.filter((f) => PLAIN_ROLE_READ.test(f.code)).map((f) => f.path);
        expect(offenders).toEqual([]);
    });

    it('no function writes a plain `role` claim', () => {
        const offenders = functionsFiles.filter((f) => PLAIN_ROLE_WRITE.test(f.code)).map((f) => f.path);
        expect(offenders).toEqual([]);
    });

    it('no browser code reads a plain `role` claim', () => {
        const offenders = browserFiles.filter((f) => PLAIN_ROLE_READ.test(f.code)).map((f) => f.path);
        expect(offenders).toEqual([]);
    });

    it('the rules read the role only through arcRole()', () => {
        for (const file of ['firestore.rules', 'storage.rules']) {
            const rules = readFileSync(join(REPO, file), 'utf8');
            expect(rules, file).not.toMatch(/token\.role\b|token\.get\(\s*'role'/);
            expect(rules, file).toContain("request.auth.token.get('arccms_role', '')");
        }
    });

    it('the guard patterns catch what they are meant to', () => {
        for (const bad of ["request.auth.token.role !== 'admin'", "request.auth?.token?.['role']", "userRecord.customClaims?.role", "claims['role']"]) {
            expect(PLAIN_ROLE_READ.test(bad), bad).toBe(true);
        }
        expect(PLAIN_ROLE_READ.test('isArcAdmin(request.auth?.token)')).toBe(false);
        expect(PLAIN_ROLE_WRITE.test('mergeUserClaims(uid, { role: newRole })')).toBe(true);
        expect(PLAIN_ROLE_WRITE.test('setCustomUserClaims(uid, { role })')).toBe(true);
        expect(PLAIN_ROLE_WRITE.test('mergeUserClaims(uid, { [ROLE_CLAIM]: role || null })')).toBe(false);
    });
});
