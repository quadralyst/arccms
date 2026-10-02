import type { BuildEnvironment, Plugin, UserConfig, ViteBuilder } from 'vite';

/**
 * Build the browser bundle, then the server bundle, one at a time.
 *
 * Analog (the `builder.buildApp` its config hook returns) starts both builds at
 * once, so two Angular compilations of the whole app and two module graphs sit in
 * memory together. One after the other, the build needs about 0.5 GB less heap and
 * takes about the same time, which keeps an app that adds code under Node's default
 * heap limit (specs/build-memory.md).
 *
 * Analog's own steps after the builds (prerendering) are unchanged: only
 * `builder.build` is queued. If Analog stops returning a `buildApp`, `vite build`
 * stops with a message instead of quietly building both at once again.
 */
export function oneBuildAtATime(plugins: Plugin[]): Plugin[] {
  let queued = false;
  const wrapped = plugins.map((plugin): Plugin => {
    const hook = plugin.config;
    if (typeof hook !== 'function') return plugin;
    return {
      ...plugin,
      async config(...args) {
        const result = (await hook.apply(this, args)) as UserConfig | null | void;
        const buildApp = result?.builder?.buildApp;
        if (!buildApp) return result;
        queued = true;
        return { ...result, builder: { ...result.builder, buildApp: (builder) => buildApp(queueBuilds(builder)) } };
      },
    };
  });
  const guard: Plugin = {
    name: 'arc-one-build-at-a-time',
    apply: 'build',
    configResolved() {
      if (!queued) {
        throw new Error(
          'vite.config.ts: Analog no longer returns builder.buildApp, so oneBuildAtATime (scripts/vite-build-order.ts) cannot queue its builds. Update it for this Analog version.',
        );
      }
    },
  };
  return [...wrapped, guard];
}

/** The same builder, with each `build` waiting for the one before it. */
export function queueBuilds(builder: ViteBuilder): ViteBuilder {
  let last: Promise<unknown> = Promise.resolve();
  const build = (environment: BuildEnvironment) => {
    const next = last.then(() => builder.build(environment));
    last = next.catch(() => undefined);
    return next;
  };
  return new Proxy(builder, { get: (target, key) => (key === 'build' ? build : Reflect.get(target, key)) });
}
