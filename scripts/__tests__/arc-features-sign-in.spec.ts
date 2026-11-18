/**
 * The password and PIN strength, and the sign-in choices the app fixed, reach the
 * functions through a generated file (scripts/arc-features.mjs, specs/sign-in-strength-spec.md
 * SS-D10, SS-D11, specs/sign-in-pin-spec.md).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
// @ts-expect-error: plain ESM script without type declarations
import { renderOwnAccountFile, renderSignInFile } from '../arc-features.mjs';

const SCRIPT = resolve(__dirname, '../arc-features.mjs');
const STRENGTH = resolve(__dirname, '../../src/shared/utils/sign-in-strength.ts');
const OWN_ACCOUNT_RULE = resolve(__dirname, '../../src/shared/utils/own-account.ts');

/**
 * signInStrength() as a build runs it, in Node itself: it loads the TypeScript files
 * directly, which Vitest's loader does not do for files outside the project.
 */
async function run(fn: 'signInStrength' | 'pinStrength' | 'fixedSignIn' | 'ownAccount', paths: Record<string, string>): Promise<string> {
    const code = `const m = await import(${JSON.stringify('file://' + SCRIPT)});
        try { const r = await m.${fn}(${JSON.stringify(paths)}); process.stdout.write(typeof r === 'string' ? r : JSON.stringify(r)); }
        catch (e) { process.stdout.write('ERROR ' + e.message); }`;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
    if (out.startsWith('ERROR ')) throw new Error(out.slice(6));
    return out;
}
const signInStrength = (paths: { strengthPath: string; customPath: string }) => run('signInStrength', paths);
const fixedSignIn = async (paths: { strengthPath: string; customPath: string }) => JSON.parse(await run('fixedSignIn', paths));
const pinStrength = (paths: { strengthPath: string; customPath: string }) => run('pinStrength', paths);
const ownAccount = async (paths: { rulePath: string; customPath: string }) => JSON.parse(await run('ownAccount', paths));
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
    it('writes the strength, and the choices the app fixed, as typed constants', () => {
        expect(renderSignInFile('simple')).toBe(
            '// Generated from src/custom/sign-in.ts by scripts/arc-features.mjs. Do not edit.\n'
                + "import type { FixedSignIn, SignInStrength } from './shared/sign-in-strength.js';\n\n"
                + 'export const SIGN_IN_STRENGTH: SignInStrength = "simple";\n'
                + 'export const SIGN_IN_PIN_STRENGTH: SignInStrength = "simple";\n'
                + 'export const SIGN_IN_FIXED: FixedSignIn = {"emailSignIn":null,"newDeviceCode":null};\n',
        );
        expect(renderSignInFile('strict', { emailSignIn: 'pin', newDeviceCode: true })).toContain(
            'export const SIGN_IN_FIXED: FixedSignIn = {"emailSignIn":"pin","newDeviceCode":true};\n',
        );
        expect(renderSignInFile('simple', undefined, 'strict')).toContain('export const SIGN_IN_PIN_STRENGTH: SignInStrength = "strict";\n');
    });

    it("refuses easy PINs under strict, or with weakPins: 'refuse' while passwords stay simple (F44)", async () => {
        const choice = (body: string) => ({ strengthPath: STRENGTH, customPath: customFile(`export const CUSTOM_SIGN_IN = ${body};\n`) });
        expect(await pinStrength(choice("{ strength: 'simple', weakPins: 'refuse' }"))).toBe('strict');
        expect(await signInStrength(choice("{ strength: 'simple', weakPins: 'refuse' }"))).toBe('simple');
        expect(await pinStrength(choice("{ strength: 'simple' }"))).toBe('simple');
        expect(await pinStrength(choice('{}'))).toBe('strict');
        await expect(pinStrength(choice("{ weakPins: 'allow' }"))).rejects.toThrow(/weakPins: 'refuse'/);
    });

    it('reads the choices the app fixed, none when it fixed none or has no file (F31)', async () => {
        const fixed = "export const CUSTOM_SIGN_IN = { emailSignIn: 'pin', newDeviceCode: false };\n";
        expect(await fixedSignIn({ strengthPath: STRENGTH, customPath: customFile(fixed) })).toEqual({ emailSignIn: 'pin', newDeviceCode: false });
        expect(await fixedSignIn({ strengthPath: STRENGTH, customPath: customFile('export const CUSTOM_SIGN_IN = {};\n') })).toEqual({ emailSignIn: null, newDeviceCode: null });
        expect(await fixedSignIn({ strengthPath: STRENGTH, customPath: join(tmpdir(), 'no-such-dir', 'sign-in.ts') })).toEqual({ emailSignIn: null, newDeviceCode: null });
    });

    it('stops the build on an email sign-in or new-device choice that is not one', async () => {
        await expect(fixedSignIn({ strengthPath: STRENGTH, customPath: customFile("export const CUSTOM_SIGN_IN = { emailSignIn: 'code' };\n") }))
            .rejects.toThrow(/emailSignIn: 'pin' or 'password'/);
        await expect(fixedSignIn({ strengthPath: STRENGTH, customPath: customFile("export const CUSTOM_SIGN_IN = { newDeviceCode: 'yes' };\n") }))
            .rejects.toThrow(/newDeviceCode: true or false/);
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

describe("what a person may do to their own account, for the functions (F44)", () => {
    function ownFile(body: string): string {
        dir = mkdtempSync(join(realpathSync(tmpdir()), 'arc-own-account-'));
        const path = join(dir, 'own-account.ts');
        writeFileSync(path, body);
        return path;
    }

    it('writes the choice as a typed constant', () => {
        expect(renderOwnAccountFile({ selfDelete: false, moveIdentifiers: true })).toBe(
            '// Generated from src/custom/own-account.ts by scripts/arc-features.mjs. Do not edit.\n'
                + "import type { OwnAccount } from './own-account-choice.js';\n\n"
                + 'export const OWN_ACCOUNT: OwnAccount = {"selfDelete":false,"moveIdentifiers":true};\n',
        );
    });

    it('allows both when empty or with no file, and reads a choice of false', async () => {
        expect(await ownAccount({ rulePath: OWN_ACCOUNT_RULE, customPath: ownFile('export const CUSTOM_OWN_ACCOUNT = {};\n') })).toEqual({ selfDelete: true, moveIdentifiers: true });
        expect(await ownAccount({ rulePath: OWN_ACCOUNT_RULE, customPath: join(tmpdir(), 'no-such-dir', 'own-account.ts') })).toEqual({ selfDelete: true, moveIdentifiers: true });
        expect(await ownAccount({ rulePath: OWN_ACCOUNT_RULE, customPath: ownFile('export const CUSTOM_OWN_ACCOUNT = { selfDelete: false, moveIdentifiers: false };\n') }))
            .toEqual({ selfDelete: false, moveIdentifiers: false });
    });

    it('stops the build on a value that is not true or false', async () => {
        await expect(ownAccount({ rulePath: OWN_ACCOUNT_RULE, customPath: ownFile("export const CUSTOM_OWN_ACCOUNT = { selfDelete: 'no' };\n") }))
            .rejects.toThrow(/selfDelete: false/);
    });
});
