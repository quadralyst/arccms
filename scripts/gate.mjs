#!/usr/bin/env node
/**
 * `npm run gate`: the one check before a merge. It runs, and stops at the first failure:
 *
 *   docs checks  about 8 seconds: broken links, and pages naming what no longer exists
 *   type check   about 15 seconds, so a type error fails before the suite starts
 *   whole suite  every other spec of `npm run test`
 *   rules tests  when the rules or their tests changed since they last passed
 *
 * It prints a few short lines and writes everything else to tmp/gate/. When all of it
 * passes it records the exact code that passed (tracked and new files, by git tree hash),
 * so the same code is not tested twice: a fast-forward merge, or a second call with
 * nothing changed, answers at once. The record is shared by every worktree of the clone.
 * Files git ignores are not part of it.
 *
 *   npm run gate               the check above
 *   npm run gate -- --force    run everything, even for code that already passed
 *   npm run gate -- --changed  while working: docs checks, type check and the specs the
 *                              change touches; not a merge check, and it records nothing
 *
 * Exit code 0 when everything passed, 1 otherwise.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The docs checks: the gate's first step, so the suite it runs next leaves them out. */
export const DOCS_SPECS = 'scripts/__tests__/docs';
/** What the rules tests depend on: they rerun only when one of these changed. */
export const RULES_INPUTS = [
    'firestore.rules', 'storage.rules', 'firestore.app.rules', 'storage.app.rules', 'firebase.json',
    'tests/rules', 'vitest.rules.config.ts', 'scripts/arc-rules-build.mjs',
];
/** Tells scripts/__tests__/typecheck.spec.ts that the gate has just run the same check. */
export const TYPECHECK_PASSED_ENV = 'ARC_GATE_TYPECHECK_PASSED';
const KEEP_STAMPS = 100;
const STALL_NOTE_SECONDS = 30;
const SHOW_FAILURES = 15;
const SHOW_DOCS = 6;

const git = (root, args, env) => execFileSync('git', args, { cwd: root, encoding: 'utf8', env: env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
const sha1 = (text) => createHash('sha1').update(text).digest('hex');
const nodeMajor = () => process.versions.node.split('.')[0];

/** The git tree of the working copy as it is now, new files included, without touching the real index. */
export function workingTreeHash(root) {
    const dir = mkdtempSync(join(tmpdir(), 'arc-gate-'));
    try {
        const index = join(dir, 'index');
        const realIndex = resolve(root, git(root, ['rev-parse', '--git-path', 'index']).trim());
        if (existsSync(realIndex)) copyFileSync(realIndex, index);
        const env = { ...process.env, GIT_INDEX_FILE: index };
        git(root, ['add', '-A'], env);
        return git(root, ['write-tree'], env).trim();
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

/** One key for the suite (all the code and the Node version) and one for the rules tests (their inputs). */
export function gateKeys(root) {
    const tree = workingTreeHash(root);
    const rulesTree = git(root, ['ls-tree', tree, '--', ...RULES_INPUTS]);
    return { tree, suite: sha1(`${tree}\n${nodeMajor()}`), rules: sha1(`${rulesTree}\n${nodeMajor()}`) };
}

/** In the clone's shared git folder, so a worktree's result counts in the main checkout too. */
export function stampFile(root) {
    return join(resolve(root, git(root, ['rev-parse', '--git-common-dir']).trim()), 'arc-gate', 'green.json');
}

export function readStamps(root) {
    try {
        const stamps = JSON.parse(readFileSync(stampFile(root), 'utf8'));
        return { suite: stamps.suite ?? {}, rules: stamps.rules ?? {} };
    } catch {
        return { suite: {}, rules: {} };
    }
}

export function recordGreen(root, kind, key, at = new Date().toISOString()) {
    const file = stampFile(root);
    const stamps = readStamps(root);
    delete stamps[kind][key];
    stamps[kind][key] = at;
    for (const old of Object.keys(stamps[kind]).slice(0, -KEEP_STAMPS)) delete stamps[kind][old];
    mkdirSync(dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}`;
    writeFileSync(temporary, JSON.stringify(stamps, null, 2));
    renameSync(temporary, file);
}

/** Vitest's JSON report gives a timeout as this placeholder, with no words about a timeout. */
const timeoutMessage = (message) => message.replace(/^Error: STACK_TRACE_ERROR/, 'Error: Test timed out');

/** The counts and failures from Vitest's JSON report. A file that failed to load has no tests of its own. */
export function summarizeSuite(report, root = ROOT) {
    const failures = [];
    for (const file of report.testResults ?? []) {
        const path = relative(root, file.name);
        const failed = (file.assertionResults ?? []).filter((test) => test.status === 'failed');
        for (const test of failed) failures.push({ file: path, name: test.fullName, message: timeoutMessage((test.failureMessages ?? []).join('\n')) });
        if (file.status === 'failed' && !failed.length) failures.push({ file: path, name: '(the file did not run)', message: file.message ?? '' });
    }
    return {
        total: report.numTotalTests ?? 0,
        files: (report.testResults ?? []).length,
        failures,
        timeouts: failures.filter((failure) => /timed out/i.test(failure.message)).length,
    };
}

/** Records how long the clock jumped while a step ran: the machine slept, or froze. */
export function watchForStalls(intervalMs = 5000, now = Date.now) {
    let last = now();
    let worst = 0;
    const timer = setInterval(() => {
        const current = now();
        worst = Math.max(worst, current - last - intervalMs);
        last = current;
    }, intervalMs);
    timer.unref();
    return () => {
        clearInterval(timer);
        return Math.round(worst / 1000);
    };
}

/** firebase-tools needs Java 21. Finds a Homebrew copy when the one on PATH is older. */
export function javaEnv(env = process.env, exists = existsSync, version = javaMajor) {
    if (version(env) >= 21) return env;
    const home = ['/opt/homebrew/opt/openjdk@21', '/usr/local/opt/openjdk@21'].find((path) => exists(join(path, 'bin/java')));
    return home ? { ...env, JAVA_HOME: home, PATH: `${join(home, 'bin')}:${env.PATH}` } : env;
}

function javaMajor(env) {
    try {
        const output = execFileSync('java', ['-version'], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
        return Number(/version "(\d+)/.exec(output)?.[1] ?? 0);
    } catch (error) {
        return Number(/version "(\d+)/.exec(String(error.stderr ?? ''))?.[1] ?? 0);
    }
}

const seconds = (start) => `${Math.round((Date.now() - start) / 1000)}s`;
const firstLine = (text) => String(text).split('\n').map((line) => line.trim()).find(Boolean)?.slice(0, 200) ?? '';
const tail = (text, lines) => text.trimEnd().split('\n').slice(-lines);
// eslint-disable-next-line no-control-regex
const plain = (text) => text.replace(/\x1b\[[0-9;]*m/g, '');

/** Runs a command with its output in a log file. Resolves to its exit code. */
function runToLog(command, args, { cwd, env, log }) {
    return new Promise((done) => {
        const out = createWriteStream(log);
        const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
        child.stdout.pipe(out);
        child.stderr.pipe(out);
        child.on('error', () => done(127));
        child.on('close', (code) => done(code ?? 1));
    });
}

/** The real steps. Each resolves to { ok, summary, lines, notes }. */
function realSteps(root, logDir) {
    const vitest = join(root, 'node_modules/vitest/vitest.mjs');

    async function runSpecs(name, extraArgs, env = process.env) {
        const report = join(logDir, `${name}.json`);
        const log = join(logDir, `${name}.log`);
        rmSync(report, { force: true });
        const code = await runToLog(process.execPath, [
            vitest, 'run', '--silent=passed-only', '--reporter=dot', '--reporter=json', `--outputFile.json=${report}`, ...extraArgs,
        ], { cwd: root, env, log });
        return judgeSuite(code, report, log, root, logDir);
    }

    return {
        keys: () => gateKeys(root),
        async typecheck() {
            const { typecheck } = await import('./typecheck.mjs');
            const results = await typecheck();
            const failed = results.filter((result) => !result.ok);
            if (!failed.length) return { ok: true, summary: 'no errors' };
            const log = join(logDir, 'typecheck.log');
            const text = failed.map((result) => `${result.name}\n\n${result.output}`).join('\n\n');
            writeFileSync(log, text);
            return { ok: false, summary: `errors in ${failed.map((result) => result.name).join(' and ')}`, lines: [...text.split('\n').slice(0, 30), `Full list: ${relative(root, log)}`] };
        },
        async docs() {
            const result = await runSpecs('docs', [DOCS_SPECS]);
            if (result.ok) return result;
            // Vitest's report says only "expected [ Array(1) ] to deeply equal []"; its log lists the problems.
            const problems = docsProblems(readFileSync(join(logDir, 'docs.log'), 'utf8'));
            return { ...result, lines: [...problems, ...(result.lines ?? [])] };
        },
        suite: () => runSpecs('suite', [`--exclude=${DOCS_SPECS}/**`], { ...process.env, [TYPECHECK_PASSED_ENV]: '1' }),
        changedSpecs: () => {
            const base = hasRef(root, 'dev') ? 'dev' : 'HEAD';
            return runSpecs('changed', [`--changed=${base}`, '--passWithNoTests', `--exclude=${DOCS_SPECS}/**`], { ...process.env, [TYPECHECK_PASSED_ENV]: '1' });
        },
        async rules() {
            const log = join(logDir, 'rules.log');
            const code = await runToLog('npm', ['run', 'test:rules'], { cwd: root, env: javaEnv(), log });
            return judgeRules(code, plain(readFileSync(log, 'utf8')), relative(root, log));
        },
        affectedDocs: () => affectedDocs(),
    };
}

function hasRef(root, ref) {
    try {
        git(root, ['rev-parse', '--verify', '--quiet', ref]);
        return true;
    } catch {
        return false;
    }
}

export function judgeSuite(code, reportPath, logPath, root = ROOT, logDir = dirname(reportPath)) {
    const logName = relative(root, logPath);
    let summary;
    try {
        summary = summarizeSuite(JSON.parse(readFileSync(reportPath, 'utf8')), root);
    } catch {
        const lines = existsSync(logPath) ? tail(plain(readFileSync(logPath, 'utf8')), 20) : [];
        return { ok: false, summary: `stopped with exit code ${code} and no results`, lines: [...lines, `Full log: ${logName}`] };
    }
    const { total, files, failures, timeouts } = summary;
    if (failures.length) {
        const list = failures.flatMap((failure) => [`FAIL ${failure.file} > ${failure.name}`, `     ${firstLine(failure.message)}`]);
        const detailFile = join(logDir, 'failures.txt');
        writeFileSync(detailFile, failures.map((failure) => `${failure.file}\n${failure.name}\n\n${failure.message}\n`).join('\n'));
        const more = failures.length > SHOW_FAILURES ? [`and ${failures.length - SHOW_FAILURES} more`] : [];
        const load = timeouts ? [`${timeouts} of these timed out with a machine load of ${loadavg()[0].toFixed(1)}. Timeouts in specs you did not touch usually mean a busy machine.`] : [];
        return {
            ok: false,
            summary: `${failures.length} failed of ${total}`,
            lines: [...list.slice(0, SHOW_FAILURES * 2), ...more, ...load, `Full messages: ${relative(root, detailFile)}`],
        };
    }
    if (code !== 0) {
        return { ok: false, summary: `exit code ${code} with no failed test`, lines: [...tail(plain(readFileSync(logPath, 'utf8')), 20), `Full log: ${logName}`] };
    }
    return { ok: true, total, summary: `${total} tests in ${files} files` };
}

/** The docs checks' own words for each problem, from the `+ "..."` lines of Vitest's log. */
export function docsProblems(log) {
    const lines = plain(log).split('\n').map((line) => /^\s*\+\s+"(.*)",?\s*$/.exec(line)?.[1]?.replaceAll('\\"', '"')).filter(Boolean);
    const unique = [...new Set(lines)];
    return [...unique.slice(0, SHOW_FAILURES), ...(unique.length > SHOW_FAILURES ? [`and ${unique.length - SHOW_FAILURES} more`] : [])];
}

export function judgeRules(code, log, logName) {
    const counted = /Tests\s+(?:\d+ failed \| )?(\d+) passed/.exec(log);
    if (code === 0) return { ok: true, summary: counted ? `${counted[1]} tests` : 'passed' };
    const failed = log.split('\n').filter((line) => /^\s*(FAIL|×)\s/.test(line)).slice(0, SHOW_FAILURES);
    return { ok: false, summary: `exit code ${code}`, lines: [...(failed.length ? failed : tail(log, 15)), `Full log: ${logName}`] };
}

async function affectedDocs() {
    const { changedFiles } = await import('./docs-affected.mjs');
    const { affectedPages, loadSite } = await import('./docs-lib.mjs');
    return affectedPages(loadSite(), changedFiles('dev').files).filter((page) => !page.edited).map((page) => `docs/${page.path}`);
}

/**
 * The order of the gate, apart from how each step runs. `steps` holds docs, typecheck, suite,
 * changedSpecs, rules, keys and affectedDocs; `stamps` holds read and record.
 */
export async function runGate({ force = false, changed = false, steps, stamps, print }) {
    const started = Date.now();
    const stallsSince = watchForStalls();

    const step = async (name, run) => {
        const start = Date.now();
        const result = await run();
        print(`gate: ${name} ${result.ok ? 'ok' : 'FAILED'}, ${result.summary} (${seconds(start)})`);
        for (const line of result.lines ?? []) print(`  ${line}`);
        return result;
    };
    const finish = async (green, detail) => {
        const stalled = stallsSince();
        if (stalled >= STALL_NOTE_SECONDS) print(`gate: note: the machine slept or froze for ${stalled}s during this run, which can cause timeouts.`);
        if (green) {
            try {
                const pages = await steps.affectedDocs();
                const more = pages.length > SHOW_DOCS ? `, and ${pages.length - SHOW_DOCS} more (npm run docs:affected)` : '';
                if (pages.length) print(`gate: read these docs pages and fix what is now wrong: ${pages.slice(0, SHOW_DOCS).join(', ')}${more}`);
            } catch { /* The list is a reminder only. */ }
        }
        print(`GATE ${green ? 'GREEN' : 'RED'}: ${detail} (${seconds(started)})`);
        return green ? 0 : 1;
    };

    if (changed) {
        if (!(await step('docs checks', steps.docs)).ok) return finish(false, 'fix the docs');
        if (!(await step('type check', steps.typecheck)).ok) return finish(false, 'fix the type errors');
        const specs = await step('changed specs', steps.changedSpecs);
        return finish(specs.ok, specs.ok ? 'changed specs only, so run the full gate before a merge' : 'fix the failures above');
    }

    const keys = steps.keys();
    const known = force ? { suite: {}, rules: {} } : stamps.read();
    const suiteDone = known.suite[keys.suite];
    const rulesDone = known.rules[keys.rules];

    if (suiteDone) {
        print(`gate: docs checks and suite already passed for this exact code at ${suiteDone}`);
    } else {
        if (!(await step('docs checks', steps.docs)).ok) return finish(false, 'fix the docs');
        if (!(await step('type check', steps.typecheck)).ok) return finish(false, 'fix the type errors');
        const suite = await step('suite', steps.suite);
        if (!suite.ok) return finish(false, 'fix the failures above');
    }

    if (rulesDone) {
        print('gate: rules tests skipped, nothing they depend on changed since they passed');
    } else {
        const rules = await step('rules tests', steps.rules);
        if (!rules.ok) return finish(false, 'fix the rules tests');
    }

    // A file edited during the run means what passed is not what is on disk now.
    const after = steps.keys();
    if (after.tree !== keys.tree) {
        return finish(false, 'files changed while the gate ran, so its result does not cover them. Run it again');
    }
    if (!suiteDone) stamps.record('suite', keys.suite);
    if (!rulesDone) stamps.record('rules', keys.rules);
    return finish(true, `code ${keys.tree.slice(0, 10)} passed`);
}

async function main(argv = process.argv.slice(2)) {
    const known = new Set(['--force', '--changed']);
    const unknown = argv.filter((arg) => !known.has(arg));
    if (unknown.length) {
        console.error(`gate: unknown option ${unknown.join(' ')}. Use --force or --changed.`);
        return 2;
    }
    const logDir = join(ROOT, 'tmp/gate');
    mkdirSync(logDir, { recursive: true });
    // Stops idle sleep for as long as the gate runs. It cannot stop the sleep of a closed lid.
    if (process.platform === 'darwin') {
        const awake = spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' });
        awake.on('error', () => {});
        awake.unref();
    }
    return runGate({
        force: argv.includes('--force'),
        changed: argv.includes('--changed'),
        steps: realSteps(ROOT, logDir),
        stamps: { read: () => readStamps(ROOT), record: (kind, key) => recordGreen(ROOT, kind, key) },
        print: (line) => console.log(line),
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        process.exit(await main());
    } catch (error) {
        // Such as a copy with no git history: there is nothing to record a pass against.
        console.error(`GATE RED: could not run: ${firstLine(error.stderr || error.message)}`);
        process.exit(1);
    }
}
