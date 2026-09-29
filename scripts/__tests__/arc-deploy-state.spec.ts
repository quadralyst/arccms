/** What a deploy records for the guided deploy's "only what changed" (scripts/arc-deploy-state.mjs). */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deployedParts, readState, recordDeploy, writeState } from '../arc-deploy-state.mjs';

describe('deploy records', () => {
    it('counts only whole parts as deployed, never single functions', () => {
        expect(deployedParts(null)).toEqual(['functions', 'rules', 'storage', 'website']);
        expect(deployedParts('functions:arccms,firestore,storage')).toEqual(['functions', 'rules', 'storage']);
        expect(deployedParts('functions')).toEqual(['functions']);
        expect(deployedParts('functions:arccms:arccms.search,functions:arccms:arccms.processBroadcast')).toEqual([]);
        expect(deployedParts('firestore:rules')).toEqual([]);
        expect(deployedParts('hosting')).toEqual(['website']);
    });

    it('records per project and keeps the other projects and parts', () => {
        const start = { lastProject: 'a', deployed: { a: { rules: { commit: 'old', at: 't0' } }, b: { storage: { commit: 'b1', at: 't0' } } } };
        const next = recordDeploy(start, 'a', ['functions'], { commit: 'new', at: 't1', names: ['search'] });
        expect(next.deployed.a).toEqual({ rules: { commit: 'old', at: 't0' }, functions: { commit: 'new', at: 't1', names: ['search'] } });
        expect(next.deployed.b).toEqual(start.deployed.b);
        expect(next.lastProject).toBe('a');
        expect(recordDeploy({}, 'a', ['rules'], { commit: 'c', at: 't', names: ['x'] }).deployed.a.rules).toEqual({ commit: 'c', at: 't' });
    });

    it('reads nothing from a missing or broken file, and round-trips a written one', () => {
        const dir = mkdtempSync(join(tmpdir(), 'arc-state-'));
        try {
            expect(readState(join(dir, 'missing.json'))).toEqual({});
            const path = join(dir, 'state.json');
            writeState({ lastProject: 'x' }, path);
            expect(readState(path)).toEqual({ lastProject: 'x' });
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
