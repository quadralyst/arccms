// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BuildEnvironment, Plugin, UserConfig, ViteBuilder } from 'vite';
import analog from '@analogjs/platform';
import { oneBuildAtATime, queueBuilds } from '../vite-build-order';

const ROOT = join(__dirname, '..', '..');

/** A builder whose builds take a moment, recording when each starts and ends. */
function fakeBuilder(fail?: string) {
    const events: string[] = [];
    const environments = { client: { name: 'client' }, ssr: { name: 'ssr' } } as unknown as Record<string, BuildEnvironment>;
    const builder = {
        environments,
        buildApp: async () => undefined,
        async build(environment: BuildEnvironment) {
            events.push(`start ${environment.name}`);
            await new Promise((resolve) => setTimeout(resolve, 20));
            events.push(`end ${environment.name}`);
            if (environment.name === fail) throw new Error(`stop after ${fail}`);
            return [];
        },
    } as unknown as ViteBuilder;
    return { builder, events };
}

/** The `builder.buildApp` the plugins' config hooks hand to Vite. */
async function buildAppOf(plugins: Plugin[]) {
    for (const plugin of plugins) {
        if (typeof plugin.config !== 'function') continue;
        const config = (await plugin.config.call({} as never, { root: ROOT }, { command: 'build', mode: 'production' })) as UserConfig | null;
        if (config?.builder?.buildApp) return config.builder.buildApp;
    }
    return undefined;
}

describe('queueBuilds', () => {
    it('starts each build only when the one before it has finished', async () => {
        const { builder, events } = fakeBuilder();
        const queued = queueBuilds(builder);
        await Promise.all([queued.build(builder.environments['client']), queued.build(builder.environments['ssr'])]);
        expect(events).toEqual(['start client', 'end client', 'start ssr', 'end ssr']);
    });

    it('still runs the next build after one fails, and passes the failure on', async () => {
        const { builder, events } = fakeBuilder('client');
        const queued = queueBuilds(builder);
        const results = await Promise.allSettled([queued.build(builder.environments['client']), queued.build(builder.environments['ssr'])]);
        expect(results.map((r) => r.status)).toEqual(['rejected', 'fulfilled']);
        expect(events).toEqual(['start client', 'end client', 'start ssr', 'end ssr']);
    });

    it('leaves the rest of the builder as it is', () => {
        const { builder } = fakeBuilder();
        expect(queueBuilds(builder).environments).toBe(builder.environments);
    });
});

describe('oneBuildAtATime with the real Analog plugins', () => {
    const options = { ssr: true, static: true, prerender: { routes: ['/'] } };

    it('Analog on its own starts the browser and server builds at once (why the wrapper exists)', async () => {
        const buildApp = await buildAppOf(analog(options));
        expect(buildApp).toBeTypeOf('function');
        // The server build fails on purpose, so Analog stops before prerendering.
        const { builder, events } = fakeBuilder('ssr');
        await expect(buildApp!(builder)).rejects.toThrow('stop after ssr');
        expect(events.slice(0, 2)).toEqual(['start client', 'start ssr']);
    });

    it('builds the browser bundle, then the server bundle', async () => {
        const buildApp = await buildAppOf(oneBuildAtATime(analog(options)));
        const { builder, events } = fakeBuilder('ssr');
        await expect(buildApp!(builder)).rejects.toThrow('stop after ssr');
        expect(events).toEqual(['start client', 'end client', 'start ssr', 'end ssr']);
    });

    it('stops vite build with a message when no plugin returns a buildApp to queue', () => {
        const plugins = oneBuildAtATime([{ name: 'plain', config: () => ({}) }]);
        const guard = plugins.find((p) => p.name === 'arc-one-build-at-a-time')!;
        expect(guard.apply).toBe('build');
        expect(() => (guard.configResolved as () => void)()).toThrow(/Analog no longer returns builder\.buildApp/);
    });
});

describe('vite.config.ts build memory settings', () => {
    const vite = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8');

    it('prerenders without building the server bundle firebase.json never deploys', () => {
        expect(vite).toContain('static: true,');
        const firebase = readFileSync(join(ROOT, 'firebase.json'), 'utf8');
        expect(firebase).toContain('"public": "dist/analog/public"');
        expect(firebase).not.toContain('analog/server');
    });

    it('wraps the Analog plugins so their builds run one at a time', () => {
        expect(vite).toContain('...oneBuildAtATime(analog({');
    });

    it('gives npm run build an 8 GB heap, and a NODE_OPTIONS the caller sets still wins', () => {
        const build: string = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts.build;
        expect(build).toMatch(/^NODE_OPTIONS="--max-old-space-size=8192 \$NODE_OPTIONS" vite build && /);
    });
});
