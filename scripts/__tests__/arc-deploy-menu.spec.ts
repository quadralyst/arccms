/** The guided deploy (scripts/arc-deploy-menu.mjs): the choices it offers and the checks it makes. */
import { describe, it, expect } from 'vitest';
import {
    affectedFunctions, askSetup, changedFilesSince, committedInstallEntry, deployChoices, functionTargets, functionsGraph,
    hasInstallSettings, installProblems, installSummary, needsTypedConfirmation, projectOptions, setupFlags,
} from '../arc-deploy-menu.mjs';
import { createdFunctions } from '../arc-deploy.mjs';

describe('the project', () => {
    const aliases = { default: 'acme-dev', production: 'acme-live' };

    it('offers every alias, preferring the last deploy, then firebase use, then default', () => {
        expect(projectOptions(aliases, 'acme-live', '').defaultIndex).toBe(1);
        expect(projectOptions(aliases, 'acme-live', 'acme-dev').defaultIndex).toBe(0);
        expect(projectOptions(aliases, '', '').defaultIndex).toBe(0);
        expect(projectOptions(aliases, '', '').options.map((o) => o.label)).toEqual(['default (acme-dev)', 'production (acme-live)']);
    });

    it('adds the firebase use project when it has no alias', () => {
        const { options, defaultIndex } = projectOptions(aliases, 'other-id', '');
        expect(options[2]).toMatchObject({ alias: '', projectId: 'other-id' });
        expect(defaultIndex).toBe(2);
    });

    it('asks for the id to be typed for production', () => {
        expect(needsTypedConfirmation('production', 'acme')).toBe(true);
        expect(needsTypedConfirmation('', 'arc-cms-live')).toBe(true);
        expect(needsTypedConfirmation('', 'shop-prod')).toBe(true);
        expect(needsTypedConfirmation('default', 'xlm-project-864ff')).toBe(false);
        expect(needsTypedConfirmation('default', 'deliverables')).toBe(false);
    });
});

describe('the install check (review O5)', () => {
    const installTs = `export const arcInstall: Record<string, ArcInstallConfig> = {
    "acme-dev": {
        databaseId: "arccms",
        storagePrefix: "arccms/",
    },
    "acme-other": {
        storageBucket: "b",
    },
};
`;

    it('reads a project\'s committed entry', () => {
        expect(committedInstallEntry(installTs, 'acme-dev')).toEqual({ databaseId: 'arccms', storagePrefix: 'arccms/' });
        expect(committedInstallEntry(installTs, 'acme-other')).toEqual({ storageBucket: 'b' });
        expect(committedInstallEntry(installTs, 'nope')).toBeNull();
    });

    it('knows when arccms.config.json covers a project', () => {
        expect(hasInstallSettings({ projects: { a: { databaseId: 'x' } } }, 'a')).toBe(true);
        expect(hasInstallSettings({ profile: 'backend' }, 'a')).toBe(true);
        expect(hasInstallSettings({ projects: { b: {} } }, 'a')).toBe(false);
        expect(hasInstallSettings({}, 'a')).toBe(false);
        // The defaults written down set nothing up.
        expect(hasInstallSettings({ databaseId: '(default)', profile: 'standalone', projects: { b: {} } }, 'a')).toBe(false);
        expect(hasInstallSettings({ databaseId: 'arccms' }, 'a')).toBe(true);
    });

    it('stops a checkout without the settings the committed file says the project has', () => {
        const problems = installProblems({ projectId: 'acme-dev', settings: null, committed: { databaseId: 'arccms' } });
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain('"arccms"');
        expect(problems[0]).toContain('arccms.config.json');
    });

    it('stops when the two disagree about the database, and passes when they agree', () => {
        expect(installProblems({ projectId: 'p', settings: { databaseId: 'one' }, committed: { databaseId: 'two' } })).toHaveLength(1);
        expect(installProblems({ projectId: 'p', settings: { databaseId: 'arccms' }, committed: { databaseId: 'arccms' } })).toEqual([]);
        expect(installProblems({ projectId: 'p', settings: {}, committed: null })).toEqual([]);
        expect(installProblems({ projectId: 'p', settings: null, committed: null })).toEqual([]);
    });

    it('says what the install uses in plain words', () => {
        expect(installSummary({ databaseId: 'arccms', hostingSite: 'none', storagePrefix: 'arccms/', appUsersPath: 'users/{id}', appUsersDatabase: '(default)' })).toEqual([
            'Database:   arccms',
            'Website:    off',
            'Storage:    the default bucket, folder arccms/',
            'App users:  users/{id} in (default)',
        ]);
        expect(installSummary({})[1]).toBe("Website:    the project's main site");
    });
});

describe('what to deploy', () => {
    it('offers the website only when it is on and has a build for the project', () => {
        const keys = (o: object) => deployChoices(o as never).map((c: { key: string }) => c.key);
        expect(keys({ websiteOn: true, websiteBuild: {}, changed: null })).toEqual(['everything', 'functions', 'rules', 'storage', 'website']);
        expect(keys({ websiteOn: false, websiteBuild: {}, changed: null })).toEqual(['everything', 'functions', 'rules', 'storage']);
        expect(keys({ websiteOn: true, websiteBuild: undefined, changed: null })).toEqual(['everything', 'functions', 'rules', 'storage']);
    });

    it('puts the changed functions first when there are some, and marks changed targets', () => {
        const choices = deployChoices({ websiteOn: false, changed: { names: ['a', 'b'], targets: ['functions:arccms:arccms.a', 'functions:arccms:arccms.b'] }, dirty: { rules: true } } as never);
        expect(choices[0]).toMatchObject({ key: 'changed', label: 'Only the functions changed since the last deploy (2)' });
        expect(choices.find((c: { key: string }) => c.key === 'rules').label).toContain('changed since the last deploy');
        expect(choices.find((c: { key: string }) => c.key === 'everything').only).toEqual(['functions:arccms', 'firestore', 'storage']);
    });
});

describe('only the functions changed since the last deploy', () => {
    const graph = functionsGraph([
        ['email-core/queueEmail.ts', "import { db } from '../init.js';\nexport async function queueEmail() {}"],
        ['email-core/dripSend.ts', "import { queueEmail } from './queueEmail.js';\nexport const processDripQueue = onSchedule('x', () => {});"],
        ['email-core/appEvents.ts', "export const onAppEventCreate = onDocumentCreated(doc, async () => { await import('./dripSend.js'); });"],
        ['search/search.ts', "import { db } from '../init.js';\nexport const search = onCall<{ q: string }>(async () => {});"],
        ['custom/index.ts', "export const hello = onCall(() => 1);"],
        ['init.ts', 'export const db = 1;'],
    ]);
    const deployable = ['onAppEventCreate', 'processDripQueue', 'search', 'custom'];

    it('follows imports, including a dynamic import, to the functions that use a changed file', () => {
        const res = affectedFunctions({ graph, changed: ['functions/src/email-core/queueEmail.ts'], deployable, previous: deployable });
        expect(res).toEqual({ all: false, names: ['onAppEventCreate', 'processDripQueue'] });
        expect(functionTargets(res.names)).toEqual(['functions:arccms:arccms.onAppEventCreate', 'functions:arccms:arccms.processDripQueue']);
    });

    it('a shared file reaches every function that uses it; a doc change reaches none', () => {
        expect(affectedFunctions({ graph, changed: ['functions/src/init.ts'], deployable, previous: deployable }).names)
            .toEqual(['onAppEventCreate', 'processDripQueue', 'search']);
        expect(affectedFunctions({ graph, changed: ['docs/x.md'], deployable, previous: deployable }).names).toEqual([]);
    });

    it('deploys the app\'s custom group as one, and new functions as well', () => {
        expect(affectedFunctions({ graph, changed: ['functions/src/custom/index.ts'], deployable, previous: deployable }).names).toEqual(['custom']);
        expect(affectedFunctions({ graph, changed: [], deployable, previous: ['search'] }).names).toEqual(['custom', 'onAppEventCreate', 'processDripQueue']);
    });

    it('says "all" when dependencies or settings change', () => {
        expect(affectedFunctions({ graph, changed: ['functions/package.json'], deployable, previous: deployable }).all).toBe(true);
        expect(affectedFunctions({ graph, changed: ['functions/.env.acme-dev'], deployable, previous: deployable }).all).toBe(true);
    });

    it('lists committed and uncommitted changes, and nothing to compare with an unknown commit', () => {
        const run = (args: string[]) => {
            if (args[0] === 'cat-file') return args[2].startsWith('abc') ? '' : null;
            if (args[0] === 'diff') return 'functions/src/a.ts\nsrc/app/x.ts\n';
            if (args[0] === 'status') return ' M functions/src/b.ts\n?? functions/src/new.ts\nR  old.ts -> functions/src/moved.ts\n';
            return null;
        };
        expect(changedFilesSince('abc123', run)?.sort()).toEqual([
            'functions/src/a.ts', 'functions/src/b.ts', 'functions/src/moved.ts', 'functions/src/new.ts', 'src/app/x.ts',
        ]);
        expect(changedFilesSince('zzz', run)).toBeNull();
        expect(changedFilesSince(undefined, run)).toBeNull();
    });
});

describe('the first-time setup', () => {
    /** A prompt that answers in order; '' is pressing Enter for the default. */
    const scripted = (answers: string[]) => ({ question: async () => answers.shift() ?? '' });

    it('asks the questions for a shared project and takes the defaults on Enter', async () => {
        const log = console.log;
        console.log = () => undefined;
        try {
            // Shared; database, own site and its name, bucket, folder, users path and database all on Enter.
            const answers = await askSetup(scripted(['2', '', '1', '', '', '', '', '']) as never, 'acme');
            expect(answers).toEqual({
                shared: true, database: 'arccms', site: 'acme-arccms', bucket: 'acme-arccms', prefix: 'arccms/',
                appUsers: 'host', appUsersDatabase: '(default)', appUsersPath: 'users/{id}',
            });
            // Shared, and the other app has no users.
            expect((await askSetup(scripted(['2', '', '2', '', '', 'none']) as never, 'acme')).appUsers).toBe('none');
            // Only Arc CMS: its own users are the App audience, with no question; website off.
            expect(await askSetup(scripted(['1', 'n']) as never, 'acme')).toEqual({ shared: false, site: 'none', appUsers: 'own' });
            expect(await askSetup(scripted(['1', '']) as never, 'acme')).toEqual({ shared: false, appUsers: 'own' });
        } finally {
            console.log = log;
        }
    });

    it('a project only Arc CMS uses', () => {
        expect(setupFlags('acme', { shared: false, appUsers: 'none' })).toEqual(['--project=acme', '--profile=standalone']);
        expect(setupFlags('acme', { shared: false, site: 'none', appUsers: 'own' }))
            .toEqual(['--project=acme', '--profile=standalone', '--site=none', '--app-users=own']);
    });

    it('a project shared with another app', () => {
        expect(setupFlags('acme', {
            shared: true, database: 'arccms', site: 'acme-arccms', bucket: 'acme-arccms', prefix: 'arccms/',
            appUsers: 'host', appUsersDatabase: '(default)', appUsersPath: 'users/{uid}',
        })).toEqual([
            '--project=acme', '--profile=backend', '--database=arccms', '--site=acme-arccms', '--bucket=acme-arccms',
            '--prefix=arccms/', '--app-users-database=(default)', '--app-users-path=users/{uid}',
        ]);
    });
});

describe('the deploy result', () => {
    it('names the functions a deploy created, not updated', () => {
        const output = [
            '✔  functions[arccms:arccms-newThing(us-central1)] Successful create operation.',
            '✔  functions[arccms:arccms-search(us-central1)] Successful update operation.',
            '\x1b[32m✔  functions[arccms:arccms-custom-hello(us-central1)] Successful create operation.\x1b[39m',
            '✔  functions[other:hostFn(us-central1)] Successful create operation.',
        ].join('\n');
        expect(createdFunctions(output)).toEqual(['custom-hello', 'newThing']);
    });
});
