import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
// @ts-expect-error: plain ESM script without type declarations
import { build, checkAppRules, coreNames, injectAppRules, mergeIndexes, parseRules, splitIndexes, subtractIndexes, MARKER } from '../arc-rules-build.mjs';

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

    describe('app rules that reach into core', () => {
        const firestoreCore = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');
        const storageCore = readFileSync(join(ROOT, 'storage.rules'), 'utf8');
        const firestore = (app: string) => () => injectAppRules(firestoreCore, app, 'firestore.app.rules');
        const storage = (app: string) => () => injectAppRules(storageCore, app, 'storage.app.rules');

        it('reads the core collections and folders from the core files', () => {
            const fs = coreNames(firestoreCore);
            expect(fs.storage).toBe(false);
            expect([...fs.names]).toEqual(expect.arrayContaining(['users', 'Settings', 'Products', 'Waitlists', 'email_lookup']));
            expect(fs.prefixes).toEqual(expect.arrayContaining(['arc_', 'Tags_']));
            const st = coreNames(storageCore);
            expect(st.storage).toBe(true);
            expect([...st.names]).toEqual(expect.arrayContaining(['users', 'avatars', 'mediaFiles', 'mediaImages']));
            expect([...st.userFolders]).toContain('feedback');
        });

        it("lets an app's own collections and member subcollections through", () => {
            const app = [
                'function appIsTeacher() { return request.auth.token.get(\'app_role\', \'\') == \'teacher\'; }',
                'match /Lessons/{lessonId} {',
                '  allow read: if isSignedIn();',
                '  match /{rest=**} { allow read: if appIsTeacher(); }',
                '}',
                'match /users/{userDocId}/children/{childId} {',
                '  allow read, write: if ownsUserRecord(userDocId);',
                '}',
                'match /users/{userDocId} {',
                '  match /progress/{id} { allow read: if ownsUserRecord(userDocId); }',
                '}',
                'match /MerchantAccounts/{accountId} {',
                '  allow read: if isSignedIn() && resource.data.get(\'ownerUid\', \'\') == request.auth.uid;',
                '}',
            ].join('\n');
            expect(firestore(app)).not.toThrow();
            expect(storage('match /users/{userDocId}/recordings/{fileName} { allow write: if ownsUserRecord(userDocId); }\n'
                + 'match /{prefix}/users/{userDocId}/recordings/{fileName} { allow write: if ownsUserRecord(userDocId); }\n'
                + 'match /tills/{pos}/{file} { allow read: if isSignedIn(); }')).not.toThrow();
        });

        it('refuses a recursive match at the top, naming the line and the fix', () => {
            expect(firestore('match /Lessons/{id} {\n  allow read: if true;\n}\nmatch /{path=**} {\n  allow read: if true;\n}'))
                .toThrow(/firestore\.app\.rules line 4 \(match \/\{path=\*\*\}\) matches every path in the database.*such as \/lessons\/\{id\}/);
            expect(storage('match /{allPaths=**} { allow read: if true; }')).toThrow(/storage\.app\.rules line 1 .*every path in the bucket/);
        });

        it("lets a collection-group rule through for a name core does not use", () => {
            expect(firestore('match /{path=**}/progress/{id} {\n  allow read: if isSignedIn();\n}')).not.toThrow();
            expect(firestore('match /users/{userDocId}/progress/{id} { allow write: if ownsUserRecord(userDocId); }\n'
                + 'match /{path=**}/progress/{id} { allow read: if isAdmin(); }')).not.toThrow();
        });

        it('refuses a collection-group rule on a name core uses, at any depth', () => {
            expect(firestore('match /{path=**}/users/{id} { allow read: if true; }')).toThrow(/line 1 .*"users" at any depth, and core uses that name/);
            expect(firestore('match /{path=**}/translations/{id} { allow read: if true; }')).toThrow(/"translations" at any depth/);
            expect(firestore('match /{path=**}/arc_lessons/{id} { allow read: if true; }')).toThrow(/"arc_lessons" at any depth/);
            expect(firestore('match /{path=**}/{name}/{id} { allow read: if true; }')).toThrow(/matches every path in the database/);
            expect(storage('match /{path=**}/progress/{file} { allow read: if true; }')).toThrow(/every path in the bucket/);
        });

        it('refuses a match on every collection', () => {
            expect(firestore('match /{collection}/{docId} { allow read: if true; }')).toThrow(/matches every collection/);
            expect(storage('match /{first}/{second} { allow write: if isSignedIn(); }')).toThrow(/matches every folder/);
        });

        it('refuses a core collection by name, also when nested or in a catch-all prefix', () => {
            expect(firestore('match /Settings/{id} { allow read: if true; }')).toThrow(/line 1 .*the core collection "Settings"/);
            expect(firestore('match /Waitlists/{id} {\n  match /users/{memberId} {\n    allow create: if true;\n  }\n}')).toThrow(/line 2 .*"Waitlists"/);
            expect(firestore('match /arc_lessons/{id} { allow write: if isSignedIn(); }')).toThrow(/"arc_lessons"/);
            expect(storage('match /avatars/{uid}/{file} { allow write: if isSignedIn(); }')).toThrow(/core folder "avatars"/);
            expect(storage('match /{prefix}/mediaImages/{file} { allow write: if isSignedIn(); }')).toThrow(/core folder "mediaImages"/);
        });

        it("refuses grants on a member's record itself and on core's folders under it", () => {
            expect(firestore('match /users/{userDocId} { allow update: if isSignedIn(); }')).toThrow(/member's record, which is core's/);
            expect(firestore('match /users/{userDocId}/{sub}/{id} { allow read: if true; }')).toThrow(/every collection under a member's record/);
            expect(storage('match /users/{userDocId}/feedback/{id}/{file} { allow write: if true; }')).toThrow(/"feedback" under a member's record/);
        });

        it('a match with no grant of its own is not checked', () => {
            expect(firestore('match /Settings/{id} {\n  // nothing yet\n}')).not.toThrow();
        });

        it('refuses unbalanced braces, naming where', () => {
            expect(firestore('match /Lessons/{id} {\n  allow read: if true;\n')).toThrow(/firestore\.app\.rules: a "\{" is never closed \(inside "match \/Lessons\/\{id\}" at line 1\)/);
            expect(firestore('match /Lessons/{id} {\n  allow read: if true;\n}\n}')).toThrow(/firestore\.app\.rules line 4: a "\}" closes nothing/);
        });

        it('ignores braces and the word allow in comments and strings', () => {
            expect(firestore('// match /Settings/{id} { allow read: if true;\nmatch /Lessons/{id} {\n  allow read: if resource.data.note != \'}{ allow\';\n}')).not.toThrow();
        });

        it('passes the core files themselves and the empty starter files', () => {
            expect(() => parseRules(firestoreCore, 'firestore.rules')).not.toThrow();
            expect(() => parseRules(storageCore, 'storage.rules')).not.toThrow();
            expect(() => checkAppRules(firestoreCore, '', 'firestore.app.rules')).not.toThrow();
            expect(() => checkAppRules(storageCore, '\n', 'storage.app.rules')).not.toThrow();
        });

        it('stops the build with the message', () => {
            const dir = mkdtempSync(join(tmpdir(), 'arc-rules-'));
            try {
                writeFileSync(join(dir, 'firestore.rules'), firestoreCore);
                writeFileSync(join(dir, 'storage.rules'), storageCore);
                writeFileSync(join(dir, 'firestore.indexes.json'), JSON.stringify({ indexes: [], fieldOverrides: [] }));
                writeFileSync(join(dir, 'firestore.app.rules'), 'match /users/{id} { allow write: if true; }\n');
                expect(() => build(dir)).toThrow(/firestore\.app\.rules line 1/);
                expect(existsSync(join(dir, '.arc-build/firestore.rules'))).toBe(false);
            } finally {
                rmSync(dir, { recursive: true, force: true });
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

        it("leaves out a site's content list indexes, with or without an app file", () => {
            const core = { collectionGroup: 'Transactions', queryScope: 'COLLECTION', fields: [] };
            const list = { collectionGroup: 'arc_articles_drafts', queryScope: 'COLLECTION', fields: [] };
            expect(subtractIndexes({ indexes: [core, list], fieldOverrides: [] }, null).indexes).toEqual([core]);
            expect(subtractIndexes({ indexes: [core, list], fieldOverrides: [] }, { indexes: [] }).indexes).toEqual([core]);
        });

        it('keeps a content list index the core file already ships, and drops one it does not', () => {
            const fields = [{ fieldPath: 'publishedStatus', order: 'ASCENDING' }, { fieldPath: 'modifiedAt', order: 'DESCENDING' }];
            const shipped = { collectionGroup: 'arc_articles_drafts', queryScope: 'COLLECTION', fields };
            const live = { ...shipped, fields: [...fields, { fieldPath: '__name__', order: 'DESCENDING' }] };
            const sites = { ...live, collectionGroup: 'arc_info_drafts' };

            const kept = subtractIndexes({ indexes: [live, sites], fieldOverrides: [] }, null, { indexes: [shipped] }).indexes;

            expect(kept).toEqual([live]);
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

    // An app rule may not name a collection core's rules name (checkAppRules), so every
    // collection the Cloud Functions keep must be named in firestore.rules, if only to
    // deny it, or an app rule could open it (form codes, counters, consent records).
    describe('every collection the functions use is named in firestore.rules', () => {
        const functionsSrc = join(ROOT, 'functions', 'src');
        const sources = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
            const path = join(dir, name);
            if (statSync(path).isDirectory()) return name === '__tests__' || name === 'custom' ? [] : sources(path);
            return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
        });
        const constantsIn = (text: string) => {
            const found = new Map<string, string>();
            for (const m of text.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*'([A-Za-z0-9_-]+)'/g)) found.set(m[1], m[2]);
            for (const m of text.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*\{\s*collection:\s*'([A-Za-z0-9_-]+)'/g)) found.set(`${m[1]}.collection`, m[2]);
            return found;
        };

        /** `db.collection(...)` names: a quoted name or an UPPER_CASE constant, resolved in the file or uniquely across functions/src. */
        function topLevelCollections() {
            const files = sources(functionsSrc).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
            const everywhere = new Map<string, Set<string>>();
            for (const { text } of files) {
                for (const [key, value] of constantsIn(text)) everywhere.set(key, new Set([...(everywhere.get(key) ?? []), value]));
            }
            const names = new Map<string, string>();
            const unresolved: string[] = [];
            for (const { path, text } of files) {
                const local = constantsIn(text);
                for (const m of text.matchAll(/\bdb\s*\.\s*collection\(\s*([^),]+?)\s*[),]/g)) {
                    const arg = m[1];
                    let name = /^['"]([A-Za-z0-9_-]+)['"]$/.exec(arg)?.[1];
                    if (!name && /^[A-Z][A-Z0-9_]*(\.collection)?$/.test(arg)) {
                        const shared = everywhere.get(arg);
                        name = local.get(arg) ?? (shared?.size === 1 ? [...shared][0] : undefined);
                        if (!name) unresolved.push(`${path.slice(ROOT.length + 1)}: ${arg}`);
                    }
                    if (name) names.set(name, path.slice(ROOT.length + 1));
                }
            }
            return { names, unresolved };
        }

        it('finds the collections, and can tell what each constant names', () => {
            const { names, unresolved } = topLevelCollections();
            expect(unresolved).toEqual([]);
            for (const known of ['users', 'Transactions', 'form_otps', 'CountedBuyers', '_sms_daily', 'TestCheckouts']) {
                expect(names.has(known), known).toBe(true);
            }
        });

        it('names each of them in firestore.rules', () => {
            const { names: coreCollections } = coreNames(readFileSync(join(ROOT, 'firestore.rules'), 'utf8'));
            const missing = [...topLevelCollections().names].filter(([name]) => !coreCollections.has(name)).map(([name, file]) => `${name} (${file})`);
            expect(missing, 'add a match for each to firestore.rules, with `allow read, write: if false;` when only the functions use it').toEqual([]);
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
