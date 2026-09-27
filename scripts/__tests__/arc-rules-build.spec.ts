import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
// @ts-expect-error: plain ESM script without type declarations
import { build, injectAppRules, mergeIndexes, splitIndexes, subtractIndexes, MARKER } from '../arc-rules-build.mjs';

const ROOT = resolve(__dirname, '..', '..');
const committedFirebase = JSON.parse(readFileSync(join(ROOT, 'firebase.json'), 'utf8'));

const CORE = `service cloud.firestore {\n  match /databases/{database}/documents {\n    function isSignedIn() { return request.auth != null; }\n    ${MARKER}\n  }\n}\n`;

describe('arc-rules-build', () => {
    describe('injectAppRules', () => {
        it('puts the app rules where the marker is, indented to match', () => {
            const out = injectAppRules(CORE, 'match /children/{id} {\n  allow read: if isSignedIn();\n}\n', 'firestore.app.rules');
            expect(out).toContain('    match /children/{id} {\n      allow read: if isSignedIn();\n    }');
            expect(out).toContain('// ---- firestore.app.rules');
            expect(out).not.toContain(MARKER);
            expect(out.trimEnd().endsWith('}')).toBe(true);
        });

        it('leaves the core untouched without app rules', () => {
            expect(injectAppRules(CORE, null)).toBe(CORE);
            expect(injectAppRules(CORE, '  \n')).toBe(CORE);
        });

        it('refuses a core file that lost its marker', () => {
            expect(() => injectAppRules('service cloud.firestore {}', 'x', 'firestore.app.rules')).toThrow(/firestore.app.rules/);
        });

        it('finds the marker in both committed rules files', () => {
            for (const file of ['firestore.rules', 'storage.rules']) {
                expect(readFileSync(join(ROOT, file), 'utf8').split('\n').some((l) => l.trim() === MARKER)).toBe(true);
            }
        });
    });

    describe('indexes', () => {
        const a = { collectionGroup: 'users', queryScope: 'COLLECTION', fields: [{ fieldPath: 'status', order: 'ASCENDING' }] };
        const b = { collectionGroup: 'children', queryScope: 'COLLECTION', fields: [{ fieldPath: 'age', order: 'ASCENDING' }] };
        const o = { collectionGroup: 'children', fieldPath: 'name', indexes: [] };

        it('adds the app indexes without duplicates', () => {
            const merged = mergeIndexes({ indexes: [a], fieldOverrides: [] }, { indexes: [a, b], fieldOverrides: [o] });
            expect(merged.indexes).toEqual([a, b]);
            expect(merged.fieldOverrides).toEqual([o]);
        });

        it('refuses a field override defined differently in both files', () => {
            expect(() => mergeIndexes({ indexes: [], fieldOverrides: [o] }, { fieldOverrides: [{ ...o, indexes: [{ order: 'ASCENDING' }] }] }))
                .toThrow(/children\/name/);
        });

        it('takes the app indexes out of a live export, so they never land in the core file', () => {
            expect(subtractIndexes({ indexes: [a, b], fieldOverrides: [o] }, { indexes: [b], fieldOverrides: [o] }))
                .toEqual({ indexes: [a], fieldOverrides: [] });
        });
    });

    describe('build', () => {
        let dir: string;
        beforeEach(() => {
            dir = mkdtempSync(join(tmpdir(), 'arc-rules-'));
            writeFileSync(join(dir, 'firestore.rules'), CORE);
            writeFileSync(join(dir, 'storage.rules'), `service firebase.storage {\n  ${MARKER}\n}\n`);
            writeFileSync(join(dir, 'firestore.indexes.json'), JSON.stringify({ indexes: [], fieldOverrides: [] }));
        });
        afterEach(() => rmSync(dir, { recursive: true, force: true }));

        it('writes the combined files, with or without app files', () => {
            build(dir);
            expect(readFileSync(join(dir, '.arc-build/firestore.rules'), 'utf8')).toBe(CORE);
            writeFileSync(join(dir, 'firestore.app.rules'), 'match /children/{id} { allow read: if false; }\n');
            writeFileSync(join(dir, 'firestore.app.indexes.json'), JSON.stringify({ indexes: [{ collectionGroup: 'children' }] }));
            const report = build(dir);
            expect(readFileSync(join(dir, '.arc-build/firestore.rules'), 'utf8')).toContain('match /children/{id}');
            expect(JSON.parse(readFileSync(join(dir, '.arc-build/firestore.indexes.json'), 'utf8')).indexes).toHaveLength(1);
            expect(report.join('\n')).toContain('firestore.rules + firestore.app.rules');
            expect(existsSync(join(dir, '.arc-build/storage.rules'))).toBe(true);
        });

        it('splitIndexes rewrites the core index file from a live export', () => {
            writeFileSync(join(dir, 'firestore.app.indexes.json'), JSON.stringify({ indexes: [{ collectionGroup: 'children' }] }));
            writeFileSync(join(dir, 'live.json'), JSON.stringify({ indexes: [{ collectionGroup: 'users' }, { collectionGroup: 'children' }], fieldOverrides: [] }));
            splitIndexes('live.json', dir);
            expect(JSON.parse(readFileSync(join(dir, 'firestore.indexes.json'), 'utf8')).indexes).toEqual([{ collectionGroup: 'users' }]);
        });
    });

    it('firebase.json deploys the combined files and builds them first', () => {
        expect(committedFirebase.firestore.rules).toBe('.arc-build/firestore.rules');
        expect(committedFirebase.firestore.indexes).toBe('.arc-build/firestore.indexes.json');
        expect(committedFirebase.storage.rules).toBe('.arc-build/storage.rules');
        expect(committedFirebase.firestore.predeploy).toContain('arc-rules-build.mjs');
        expect(committedFirebase.storage.predeploy).toContain('arc-rules-build.mjs');
    });
});
