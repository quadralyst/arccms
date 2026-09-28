/** Scripts outside the Firebase CLI read ARC_* settings as the CLI does (review O3). */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { loadArcEnv } = require('../../functions/scripts/arc-env.cjs') as {
    loadArcEnv: (dir: string, projectId: string, env: Record<string, string | undefined>) => Record<string, string | undefined>;
};

describe('loadArcEnv', () => {
    let dir: string;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'arc-env-'));
        writeFileSync(join(dir, '.env'), 'ARC_DATABASE_ID=(default)\nARC_APP_USERS_PATH=none/{id}\nOTHER=x\n');
        writeFileSync(join(dir, '.env.dev-project'), 'ARC_DATABASE_ID=arccms\nARC_HOSTING_SITE=none\n');
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it("lets the project's own file override the committed one", () => {
        const env = loadArcEnv(dir, 'dev-project', {});
        expect(env).toEqual({ ARC_DATABASE_ID: 'arccms', ARC_HOSTING_SITE: 'none', ARC_APP_USERS_PATH: 'none/{id}' });
    });

    it('keeps values already in the environment', () => {
        expect(loadArcEnv(dir, 'dev-project', { ARC_DATABASE_ID: 'from-shell' }).ARC_DATABASE_ID).toBe('from-shell');
    });

    it('uses the committed file alone for a project without its own', () => {
        expect(loadArcEnv(dir, 'other-project', {}).ARC_DATABASE_ID).toBe('(default)');
    });
});
