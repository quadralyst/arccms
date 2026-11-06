/**
 * A functions deploy from a checkout without functions/.env.<projectId> used every function
 * against the `(default)` database and reported success (found on 2026-11-06, from a git
 * worktree). The deploy now stops when those files do not give what arccms.config.json says.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { functionsEnvProblem } from '../arc-deploy.mjs';
import { normalizeConfig, updateFunctionsEnv } from '../arc-configure.mjs';

const ID = 'acme-site';
const OWN_SITE = normalizeConfig({ databaseId: 'arccms', hostingSite: 'acme-arccms', storageBucket: 'acme-arccms' });
const DEFAULTS = normalizeConfig({});

describe('functionsEnvProblem', () => {
    let dir: string;
    const write = (file: string, text: string) => writeFileSync(join(dir, file), text);

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'arc-functions-env-'));
        // What the repository ships, as in every checkout.
        write('.env', updateFunctionsEnv('', DEFAULTS));
    });

    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('stops when the project file is missing, and says what to run', () => {
        const problem = functionsEnvProblem(ID, OWN_SITE, dir);

        expect(problem).toContain(`functions/.env.${ID} is missing`);
        expect(problem).toContain('ARC_DATABASE_ID: arccms.config.json says arccms, the functions would get (default)');
        expect(problem).toContain(`npm run arc:configure -- --project=${ID}`);
        expect(problem).toContain('Nothing was deployed');
    });

    it('passes when the project file gives what the config says', () => {
        write(`.env.${ID}`, updateFunctionsEnv('', OWN_SITE));
        expect(functionsEnvProblem(ID, OWN_SITE, dir)).toBe('');
    });

    it('stops when the project file is there but out of date', () => {
        write(`.env.${ID}`, updateFunctionsEnv('', { ...OWN_SITE, databaseId: 'old-database' }));

        const problem = functionsEnvProblem(ID, OWN_SITE, dir);

        expect(problem).toContain('ARC_DATABASE_ID');
        expect(problem).not.toContain('is missing');
    });

    it('does not stop an install on the defaults, which needs no project file', () => {
        expect(functionsEnvProblem(ID, DEFAULTS, dir)).toBe('');
    });

    it('a project file wins over functions/.env, as it does in the Firebase CLI', () => {
        write('.env', updateFunctionsEnv('', { ...DEFAULTS, databaseId: 'something-else' }));
        write(`.env.${ID}`, updateFunctionsEnv('', OWN_SITE));
        expect(functionsEnvProblem(ID, OWN_SITE, dir)).toBe('');
    });

    it('keeps other lines of an env file out of it, and reads a quoted value', () => {
        const env = updateFunctionsEnv('MY_APP_KEY=abc\n# a note\n', OWN_SITE).replace('ARC_DATABASE_ID=arccms', 'ARC_DATABASE_ID="arccms"');
        write(`.env.${ID}`, env);
        expect(functionsEnvProblem(ID, OWN_SITE, dir)).toBe('');
    });
});
