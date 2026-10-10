/**
 * The password and PIN strength reaches the functions through a generated file
 * (scripts/arc-features.mjs, specs/sign-in-strength-spec.md SS-D10, SS-D11).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
// @ts-expect-error: plain ESM script without type declarations
import { renderSignInFile } from '../arc-features.mjs';

const SCRIPT = resolve(__dirname, '../arc-features.mjs');
const STRENGTH = resolve(__dirname, '../../src/shared/utils/sign-in-strength.ts');

/**
 * signInStrength() as a build runs it, in Node itself: it loads the TypeScript files
 * directly, which Vitest's loader does not do for files outside the project.
 */
async function signInStrength({ strengthPath, customPath }: { strengthPath: string; customPath: string }): Promise<string> {
    const code = `const m = await import(${JSON.stringify('file://' + SCRIPT)});
        try { process.stdout.write(await m.signInStrength(${JSON.stringify({ strengthPath, customPath })})); }
        catch (e) { process.stdout.write('ERROR ' + e.message); }`;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
    if (out.startsWith('ERROR ')) throw new Error(out.slice(6));
    return out;
}
let dir = '';

function customFile(body: string): string {
    dir = mkdtempSync(join(realpathSync(tmpdir()), 'arc-sign-in-'));
    const path = join(dir, 'sign-in.ts');
    writeFileSync(path, body);
    return path;
}

afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = '';
});

describe('the sign-in strength for the functions', () => {
    it('writes the strength as a typed constant', () => {
        expect(renderSignInFile('simple')).toBe(
            '// Generated from src/custom/sign-in.ts by scripts/arc-features.mjs. Do not edit.\n'
                + "import type { SignInStrength } from './shared/sign-in-strength.js';\n\n"
                + 'export const SIGN_IN_STRENGTH: SignInStrength = "simple";\n',
        );
    });

    it('reads the app\'s choice, strict when empty', async () => {
        expect(await signInStrength({ strengthPath: STRENGTH, customPath: customFile("export const CUSTOM_SIGN_IN = { strength: 'simple' };\n") })).toBe('simple');
        expect(await signInStrength({ strengthPath: STRENGTH, customPath: customFile('export const CUSTOM_SIGN_IN = {};\n') })).toBe('strict');
    });

    it('is strict for a copy that has no sign-in file yet', async () => {
        expect(await signInStrength({ strengthPath: STRENGTH, customPath: join(tmpdir(), 'no-such-dir', 'sign-in.ts') })).toBe('strict');
    });

    it('stops the build on a value that is not a strength', async () => {
        await expect(signInStrength({ strengthPath: STRENGTH, customPath: customFile("export const CUSTOM_SIGN_IN = { strength: 'easy' };\n") }))
            .rejects.toThrow(/strength: 'simple'/);
    });
});
