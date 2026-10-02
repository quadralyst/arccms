# Build memory

Why `npm run build` is set up the way it is in `vite.config.ts`, and the numbers behind it.
Measured 2026-10-02 on core Arc CMS (dev at 2815915), Node 22.23, Apple silicon, 24 GB RAM.
Node's default heap limit on that machine is 4,144 MB.

## The problem

A Sanskrit app built on Arc CMS failed at "Building Server" with "JavaScript heap out of
memory". Core itself peaked at about 5.5 GB of process memory and only just passed.

## Where the memory went (before)

| Phase | Process memory |
|---|---|
| Analog builds the browser and server bundles at once (two Angular compilations) | climbs to 3.7 GB, held |
| "Building Server": Nitro builds a Cloud Functions server bundle (`dist/analog/server`, 31 MB) | +1.9 GB, peak 5.58 GB |
| About 60 s idle after "successfully built" | 3.6 to 5 GB held |

The server bundle is never deployed: `firebase.json` serves `dist/analog/public` and rewrites
only to the `arccms-` functions. Only the prerendered `/` and `/hi` are needed.

## The changes

1. `static: true` in the Analog options: prerender without building the server bundle.
2. `oneBuildAtATime` (`scripts/vite-build-order.ts`): Analog's `buildApp` runs the browser
   and server builds one after the other instead of with `Promise.all`.
3. `npm run build` sets `NODE_OPTIONS="--max-old-space-size=8192 $NODE_OPTIONS"`: a safety
   margin for apps with more code than core. The caller's own `NODE_OPTIONS` comes last, so
   its heap size wins. The heap is a ceiling, not memory taken up front; a build that needs
   more than the machine has free swaps instead of stopping early.

## Smallest heap that passes (`--max-old-space-size`)

| Setup | Fails | Passes |
|---|---|---|
| Before | 3,072 MB (in "Building Server") | 3,584 MB |
| `static: true` only | 2,560 MB | 3,072 MB |
| `static: true` + one build at a time | 2,048 MB | 2,304 MB |

Build time is unchanged: browser 24 s then server 19 s, against 35 s for both at once.
The published files (`dist/analog/public`) are identical to the old build, byte for byte,
except a random id on the search box in the two prerendered pages.

## Tried and dropped

Analog's `experimental.useAngularCompilationAPI` (TypeScript in a worker thread) built
faster (28 s, 3.75 GB peak), but the browser build closes the shared worker while the server
build still uses it, and with that worked around, prerendering failed with "Component
'HomeComponent' is not resolved" (a 14 KB home page). Revisit on a later Analog version.

## Still open

- The 60 s idle tail: the prerendered home page opens a Firebase connection that keeps the
  build process alive. Time, not memory.
- The server build still compiles all 205 chunks, admin pages included, to prerender two
  pages. Most of the remaining ~2.3 GB is one full Angular compilation of the app.
