import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error: plain ESM script without type declarations
import { DOCS_SPECS, docsProblems, gateKeys, javaEnv, judgeRules, judgeSuite, readStamps, recordGreen, runGate, stampFile, summarizeSuite, watchForStalls } from '../gate.mjs';

const git = (root: string, ...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

describe('the code a pass is recorded for', () => {
    let repo: string;

    beforeEach(() => {
        repo = realpathSync(mkdtempSync(join(tmpdir(), 'gate-spec-')));
        git(repo, 'init', '-q');
        git(repo, 'config', 'user.email', 'test@example.com');
        git(repo, 'config', 'user.name', 'Test');
        writeFileSync(join(repo, '.gitignore'), 'ignored.txt\n');
        writeFileSync(join(repo, 'a.ts'), 'one');
        writeFileSync(join(repo, 'firestore.rules'), 'rules');
        git(repo, 'add', '-A');
        git(repo, 'commit', '-qm', 'first');
    });

    afterEach(() => rmSync(repo, { recursive: true, force: true }));

    it('changes with an edit, committed or not, and with a new file', () => {
        const before = gateKeys(repo).suite;
        writeFileSync(join(repo, 'a.ts'), 'two');
        const edited = gateKeys(repo).suite;
        expect(edited).not.toBe(before);
        writeFileSync(join(repo, 'b.spec.ts'), 'new');
        expect(gateKeys(repo).suite).not.toBe(edited);
    });

    it('stays the same when the same code is committed, and for a file git ignores', () => {
        writeFileSync(join(repo, 'a.ts'), 'two');
        const uncommitted = gateKeys(repo).suite;
        git(repo, 'add', '-A');
        git(repo, 'commit', '-qm', 'second');
        expect(gateKeys(repo).suite).toBe(uncommitted);
        writeFileSync(join(repo, 'ignored.txt'), 'x');
        expect(gateKeys(repo).suite).toBe(uncommitted);
    });

    it('leaves the real index alone', () => {
        writeFileSync(join(repo, 'b.ts'), 'new');
        gateKeys(repo);
        expect(git(repo, 'status', '--short')).toContain('?? b.ts');
    });

    it('changes the rules key only when the rules or their tests change', () => {
        const before = gateKeys(repo).rules;
        writeFileSync(join(repo, 'a.ts'), 'two');
        expect(gateKeys(repo).rules).toBe(before);
        writeFileSync(join(repo, 'firestore.rules'), 'changed');
        const changed = gateKeys(repo).rules;
        expect(changed).not.toBe(before);
        mkdirSync(join(repo, 'tests/rules'), { recursive: true });
        writeFileSync(join(repo, 'tests/rules/x.spec.ts'), 'new');
        expect(gateKeys(repo).rules).not.toBe(changed);
    });

    it('is shared with the other worktrees of the clone, so a fast-forward merge needs no second run', () => {
        const other = `${repo}-worktree`;
        git(repo, 'worktree', 'add', '-q', other);
        try {
            expect(gateKeys(other).suite).toBe(gateKeys(repo).suite);
            expect(stampFile(other)).toBe(stampFile(repo));
            recordGreen(other, 'suite', 'abc', 'then');
            expect(readStamps(repo).suite.abc).toBe('then');
        } finally {
            rmSync(other, { recursive: true, force: true });
        }
    });

    it('keeps the latest records only, and reads a missing or broken file as none', () => {
        expect(readStamps(repo)).toEqual({ suite: {}, rules: {} });
        recordGreen(repo, 'suite', 'first', 'then');
        const full = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, 'then']));
        writeFileSync(stampFile(repo), JSON.stringify({ suite: full, rules: {} }));
        recordGreen(repo, 'suite', 'newest', 'now');
        const { suite } = readStamps(repo);
        expect(Object.keys(suite)).toHaveLength(100);
        expect(suite.k0).toBeUndefined();
        expect(suite.newest).toBe('now');
        writeFileSync(stampFile(repo), 'not json');
        expect(readStamps(repo)).toEqual({ suite: {}, rules: {} });
    });
});

describe('the order of the gate', () => {
    const keys = { tree: 'tree123456789', suite: 'suite-key', rules: 'rules-key' };
    const pass = (summary = 'fine') => vi.fn(async () => ({ ok: true, summary }));
    const fail = (summary = 'broken', lines: string[] = []) => vi.fn(async () => ({ ok: false, summary, lines }));

    function setup(overrides: Record<string, unknown> = {}, known = { suite: {}, rules: {} } as { suite: Record<string, string>; rules: Record<string, string> }) {
        const steps = { keys: vi.fn(() => keys), docs: pass(), typecheck: pass(), suite: pass(), changedSpecs: pass(), rules: pass(), affectedDocs: vi.fn(async () => [] as string[]), ...overrides };
        const stamps = { read: vi.fn(() => known), record: vi.fn() };
        const lines: string[] = [];
        return { steps, stamps, lines, print: (line: string) => lines.push(line) };
    }

    it('runs the docs checks, the type check, the suite and the rules tests in that order, then records the pass', async () => {
        const s = setup();
        expect(await runGate(s)).toBe(0);
        const order = [s.steps.docs, s.steps.typecheck, s.steps.suite, s.steps.rules].map((step) => step.mock.invocationCallOrder[0]);
        expect(order).toEqual([...order].sort((a, b) => a - b));
        expect(s.lines[0]).toMatch(/^gate: docs checks ok/);
        expect(s.steps.typecheck).toHaveBeenCalledOnce();
        expect(s.steps.suite).toHaveBeenCalledOnce();
        expect(s.steps.rules).toHaveBeenCalledOnce();
        expect(s.stamps.record.mock.calls).toEqual([['suite', 'suite-key'], ['rules', 'rules-key']]);
        expect(s.lines.at(-1)).toMatch(/^GATE GREEN/);
    });

    it('stops at a docs failure, before anything slower starts, and records nothing', async () => {
        const s = setup({ docs: fail('1 failed of 62', ['FAIL docs.spec.ts > has no broken link']) });
        expect(await runGate(s)).toBe(1);
        expect(s.steps.typecheck).not.toHaveBeenCalled();
        expect(s.steps.suite).not.toHaveBeenCalled();
        expect(s.steps.rules).not.toHaveBeenCalled();
        expect(s.stamps.record).not.toHaveBeenCalled();
        expect(s.lines).toContain('  FAIL docs.spec.ts > has no broken link');
        expect(s.lines.at(-1)).toMatch(/^GATE RED: fix the docs/);
    });

    it('stops at a type error, before the suite starts, and records nothing', async () => {
        const s = setup({ typecheck: fail('errors in app', ['src/a.ts(1,1): error']) });
        expect(await runGate(s)).toBe(1);
        expect(s.steps.suite).not.toHaveBeenCalled();
        expect(s.steps.rules).not.toHaveBeenCalled();
        expect(s.stamps.record).not.toHaveBeenCalled();
        expect(s.lines).toContain('  src/a.ts(1,1): error');
        expect(s.lines.at(-1)).toMatch(/^GATE RED/);
    });

    it('records nothing when the suite fails, and does not start the rules tests', async () => {
        const s = setup({ suite: fail() });
        expect(await runGate(s)).toBe(1);
        expect(s.steps.rules).not.toHaveBeenCalled();
        expect(s.stamps.record).not.toHaveBeenCalled();
    });

    it('records the suite only when the rules tests fail', async () => {
        const s = setup({ rules: fail() });
        expect(await runGate(s)).toBe(1);
        expect(s.stamps.record).not.toHaveBeenCalled();
    });

    it('answers at once for code that already passed', async () => {
        const s = setup({}, { suite: { 'suite-key': 'earlier' }, rules: { 'rules-key': 'earlier' } });
        expect(await runGate(s)).toBe(0);
        expect(s.steps.docs).not.toHaveBeenCalled();
        expect(s.steps.typecheck).not.toHaveBeenCalled();
        expect(s.steps.suite).not.toHaveBeenCalled();
        expect(s.steps.rules).not.toHaveBeenCalled();
        expect(s.lines.at(-1)).toMatch(/^GATE GREEN/);
    });

    it('skips the rules tests when nothing they depend on changed, and runs them when it did', async () => {
        const unchanged = setup({}, { suite: {}, rules: { 'rules-key': 'earlier' } });
        await runGate(unchanged);
        expect(unchanged.steps.suite).toHaveBeenCalledOnce();
        expect(unchanged.steps.rules).not.toHaveBeenCalled();
        const changed = setup({}, { suite: { 'suite-key': 'earlier' }, rules: {} });
        await runGate(changed);
        expect(changed.steps.suite).not.toHaveBeenCalled();
        expect(changed.steps.rules).toHaveBeenCalledOnce();
    });

    it('runs everything with --force, whatever was recorded', async () => {
        const s = setup({}, { suite: { 'suite-key': 'earlier' }, rules: { 'rules-key': 'earlier' } });
        expect(await runGate({ ...s, force: true })).toBe(0);
        expect(s.steps.docs).toHaveBeenCalledOnce();
        expect(s.steps.suite).toHaveBeenCalledOnce();
        expect(s.steps.rules).toHaveBeenCalledOnce();
    });

    it('does not count a pass when a file changed during the run', async () => {
        const s = setup({ keys: vi.fn().mockReturnValueOnce(keys).mockReturnValue({ ...keys, tree: 'other', suite: 'other' }) });
        expect(await runGate(s)).toBe(1);
        expect(s.stamps.record).not.toHaveBeenCalled();
        expect(s.lines.at(-1)).toMatch(/^GATE RED.*files changed/);
    });

    it('with --changed runs the docs checks, the type check and the changed specs, records nothing and does not call it a merge check', async () => {
        const s = setup({}, { suite: { 'suite-key': 'earlier' }, rules: {} });
        expect(await runGate({ ...s, changed: true })).toBe(0);
        expect(s.steps.docs).toHaveBeenCalledOnce();
        expect(s.steps.typecheck).toHaveBeenCalledOnce();
        expect(s.steps.changedSpecs).toHaveBeenCalledOnce();
        expect(s.steps.suite).not.toHaveBeenCalled();
        expect(s.steps.rules).not.toHaveBeenCalled();
        expect(s.stamps.record).not.toHaveBeenCalled();
        expect(s.lines.at(-1)).toMatch(/before a merge/);
    });

    it('lists the docs pages on a pass, and a failure to list them changes nothing', async () => {
        const listed = setup({ affectedDocs: vi.fn(async () => ['page one', 'page two']) });
        await runGate(listed);
        expect(listed.lines.join('\n')).toContain('page one, page two');
        const many = setup({ affectedDocs: vi.fn(async () => Array.from({ length: 19 }, (_, i) => `page ${i}`)) });
        await runGate(many);
        expect(many.lines.join('\n')).toContain('page 5, and 13 more (npm run docs:affected)');
        expect(many.lines.join('\n')).not.toContain('page 6');
        const broken = setup({ affectedDocs: vi.fn(async () => { throw new Error('no docs'); }) });
        expect(await runGate(broken)).toBe(0);
    });
});

describe('the docs step', () => {
    it('lists each problem in the docs checks\' own words, once, in the shape of Vitest\'s log', () => {
        const log = [
            ' FAIL  |server| scripts/__tests__/docs/docs.spec.ts > the docs > has no broken link',
            'AssertionError: expected [ Array(2) ] to deeply equal []',
            '- Expected',
            '+ Received',
            '- []',
            '+ [',
            '\u001b[32m+   "contributing/a.html: the link \\"no-such-page.html\\" does not lead to a page",\u001b[39m',
            '+   "contributing/b.html: broken link other.html"',
            '+ ]',
        ].join('\n');
        expect(docsProblems(`${log}\n${log}`)).toEqual(['contributing/a.html: the link "no-such-page.html" does not lead to a page', 'contributing/b.html: broken link other.html']);
        expect(docsProblems('nothing to list')).toEqual([]);
    });

    it('names the folder the docs checks are in, so the suite leaves out only those', () => {
        const specs = readdirSync(DOCS_SPECS).filter((file: string) => file.endsWith('.spec.ts'));
        expect(specs).toContain('docs.spec.ts');
    });

    it('tells the reader to read the pages, since a check cannot tell whether their words are still true', async () => {
        const lines: string[] = [];
        const ok = async () => ({ ok: true, summary: 'fine' });
        await runGate({
            steps: { keys: () => ({ tree: 't', suite: 's', rules: 'r' }), docs: ok, typecheck: ok, suite: ok, rules: ok, changedSpecs: ok, affectedDocs: async () => ['page one'] },
            stamps: { read: () => ({ suite: {}, rules: {} }), record: () => {} },
            print: (line: string) => lines.push(line),
        });
        expect(lines.join('\n')).toContain('read these docs pages and fix what is now wrong: page one');
    });
});

describe('reading results', () => {
    const report = {
        numTotalTests: 3,
        testResults: [
            { name: '/repo/a.spec.ts', status: 'failed', assertionResults: [
                { status: 'passed', fullName: 'a works' },
                { status: 'failed', fullName: 'a breaks', failureMessages: ['Error: expected 1 to be 2\n  at line'] },
                { status: 'failed', fullName: 'a hangs', failureMessages: ['Error: STACK_TRACE_ERROR\n    at task (file:///runner.js:1:1)'] },
            ] },
            { name: '/repo/b.spec.ts', status: 'failed', message: 'Cannot find module', assertionResults: [] },
        ],
    };

    it('lists failed tests with paths from the repo root, and a file that did not load', () => {
        const summary = summarizeSuite(report, '/repo');
        expect(summary.failures.map((failure: { file: string; name: string }) => `${failure.file}: ${failure.name}`)).toEqual([
            'a.spec.ts: a breaks', 'a.spec.ts: a hangs', 'b.spec.ts: (the file did not run)',
        ]);
        // The placeholder is what Vitest's JSON report really gives for a timeout.
        expect(summary.timeouts).toBe(1);
        expect(summary.failures[1].message).toMatch(/^Error: Test timed out/);
        expect(summary.total).toBe(3);
    });

    describe('judgeSuite', () => {
        let dir: string;
        beforeEach(() => { dir = realpathSync(mkdtempSync(join(tmpdir(), 'gate-judge-'))); });
        afterEach(() => rmSync(dir, { recursive: true, force: true }));
        const write = (content: unknown) => {
            writeFileSync(join(dir, 'suite.json'), JSON.stringify(content));
            writeFileSync(join(dir, 'suite.log'), 'the log\nlast line\n');
            return [join(dir, 'suite.json'), join(dir, 'suite.log'), dir, dir] as const;
        };

        it('passes on exit code 0 with no failures', () => {
            const [json, log] = write({ numTotalTests: 2, testResults: [{ name: join(dir, 'a'), status: 'passed', assertionResults: [] }] });
            expect(judgeSuite(0, json, log, dir)).toMatchObject({ ok: true, summary: '2 tests in 1 files' });
        });

        it('fails on a failed test, names it and writes the full message to a file', () => {
            const [json, log] = write({ ...report, testResults: [{ ...report.testResults[0], name: join(dir, 'a.spec.ts') }] });
            const result = judgeSuite(1, json, log, dir);
            expect(result.ok).toBe(false);
            expect(result.summary).toBe('2 failed of 3');
            expect(result.lines).toContain('FAIL a.spec.ts > a breaks');
            expect(result.lines).toContain('     Error: expected 1 to be 2');
            expect(result.lines.join('\n')).toContain('timed out with a machine load');
            expect(result.lines.at(-1)).toBe('Full messages: failures.txt');
        });

        it('fails on a non-zero exit with no failed test, such as an unhandled error', () => {
            const [json, log] = write({ numTotalTests: 2, testResults: [] });
            const result = judgeSuite(1, json, log, dir);
            expect(result.ok).toBe(false);
            expect(result.lines).toContain('last line');
        });

        it('fails when no report was written, such as a config that does not load', () => {
            writeFileSync(join(dir, 'suite.log'), 'config broke\n');
            const result = judgeSuite(1, join(dir, 'missing.json'), join(dir, 'suite.log'), dir);
            expect(result.ok).toBe(false);
            expect(result.lines).toContain('config broke');
        });
    });

    it('reads the rules run: its count on a pass, its failures or the end of the log otherwise', () => {
        expect(judgeRules(0, 'Tests  112 passed (112)', 'r.log')).toEqual({ ok: true, summary: '112 tests' });
        const failed = judgeRules(1, 'x\n FAIL tests/rules/a.spec.ts > denies\ny', 'r.log');
        expect(failed.lines).toEqual([' FAIL tests/rules/a.spec.ts > denies', 'Full log: r.log']);
        expect(judgeRules(1, 'Java is too old', 'r.log').lines).toEqual(['Java is too old', 'Full log: r.log']);
    });
});

describe('the machine', () => {
    it('reports a jump of the clock, as when the lid closes during a run', () => {
        vi.useFakeTimers();
        try {
            let clock = 0;
            const stop = watchForStalls(5000, () => clock);
            clock = 5000;
            vi.advanceTimersByTime(5000);
            clock = 5000 + 5000 + 900_000;
            vi.advanceTimersByTime(5000);
            expect(stop()).toBe(900);
        } finally {
            vi.useRealTimers();
        }
    });

    it('finds Java 21 from Homebrew when the one on the path is older, and leaves a good one alone', () => {
        const env = { PATH: '/usr/bin' };
        expect(javaEnv(env, () => true, () => 21)).toBe(env);
        expect(javaEnv(env, () => false, () => 11)).toBe(env);
        const found = javaEnv(env, (path: string) => path.startsWith('/opt/homebrew/opt/openjdk@21'), () => 11);
        expect(found.JAVA_HOME).toBe('/opt/homebrew/opt/openjdk@21');
        expect(found.PATH).toBe('/opt/homebrew/opt/openjdk@21/bin:/usr/bin');
    });
});
