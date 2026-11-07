import { describe, it, expect, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
// @ts-expect-error: plain ESM script without type declarations
import { onlyServerSpecs } from '../vitest-only-server.mjs';

// Loaded for its settings only: the plugins do not need to start.
vi.mock('@analogjs/vite-plugin-angular', () => ({ default: () => ({ name: 'angular-stub' }) }));
vi.mock('../vite-arc-site', () => ({ arcSite: () => ({ name: 'arc-site-stub' }) }));

const argv = (...args: string[]) => ['node', 'vitest.mjs', ...args];

async function projects() {
    const saved = process.argv;
    process.argv = argv('run');
    vi.resetModules();
    try {
        const { default: config } = await import('../../vitest.config');
        return config.test!.projects as { plugins?: unknown[]; test: Record<string, any> }[];
    } finally {
        process.argv = saved;
    }
}

describe('the test settings', () => {
    it('caps the memory of the app project, whose pool the Angular plugin would otherwise pick with no useful limit', async () => {
        const app = (await projects()).find((project) => project.test.name === 'app')!;
        expect(app.test.pool).toBe('vmThreads');
        expect(app.test.vmMemoryLimit).toBeTruthy();
    });

    it('keeps Angular out of the server project, or one functions spec costs 35 seconds again', async () => {
        const server = (await projects()).find((project) => project.test.name === 'server')!;
        expect(server.plugins ?? []).toEqual([]);
        expect(server.test.environment).toBe('node');
        expect(server.test.setupFiles).toEqual(['functions/src/__tests__/setup.ts']);
    });

    it('runs every spec in the repo in exactly one project', async () => {
        const all = await projects();
        const specs = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '*.spec.ts'], { encoding: 'utf8' }).split('\n').filter(Boolean)
            .filter((file) => !file.startsWith('tests/rules/'));
        expect(specs.length).toBeGreaterThan(500);
        const wrong = specs.filter((file) => all.filter((project) => project.test.include.some((glob: string) => file.startsWith(glob.split('**')[0]))).length !== 1);
        expect(wrong).toEqual([]);
    });
});

describe('leaving the Angular compiler out of a run', () => {
    it('happens when a run names only functions or scripts specs', () => {
        expect(onlyServerSpecs(argv('run', 'functions/src/__tests__/x.spec.ts'))).toBe(true);
        expect(onlyServerSpecs(argv('run', './scripts/__tests__/docs'))).toBe(true);
        expect(onlyServerSpecs(argv('run', 'functions', 'scripts'))).toBe(true);
        expect(onlyServerSpecs(argv('run', 'functions/src/a.spec.ts', '--silent=passed-only'))).toBe(true);
        expect(onlyServerSpecs(argv('run', 'functions/src/a.spec.ts', '-t', 'some name'))).toBe(true);
    });

    it('never happens when a spec of the app could be meant', () => {
        expect(onlyServerSpecs(argv())).toBe(false);
        expect(onlyServerSpecs(argv('run'))).toBe(false);
        expect(onlyServerSpecs(argv('run', 'src/app/a.spec.ts'))).toBe(false);
        expect(onlyServerSpecs(argv('run', 'functions/src/a.spec.ts', 'src/app/a.spec.ts'))).toBe(false);
        expect(onlyServerSpecs(argv('run', 'interpolate'))).toBe(false);
        expect(onlyServerSpecs(argv('run', 'custom/tool.spec.ts'))).toBe(false);
        expect(onlyServerSpecs(argv('run', 'functions/src/a.spec.ts', '--maxWorkers', '5'))).toBe(false);
        expect(onlyServerSpecs(argv('run', '--project', 'app', 'functions/src/a.spec.ts'))).toBe(false);
        expect(onlyServerSpecs(argv('run', '--project=app', 'functions/src/a.spec.ts'))).toBe(false);
    });
});
