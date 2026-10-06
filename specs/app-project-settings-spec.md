# Firebase Settings Per Project: Build Spec (A2)

**Status:** spec written 2026-10-06, not built.
**Branch:** `feat/app-project-settings`, cut from `dev` (10c8734).
**Scope:** an app built on Arc CMS can have any number of Firebase projects (dev, staging,
production, more), each with its own web settings. A build and a deploy pick the project
by `.firebaserc` alias or id, the same way everywhere, and **a deploy always builds first**.
An install with the two projects it has today keeps working unchanged.

**Out of scope:** creating Firebase projects, per-project functions code, per-project
feature choices (features stay one set per app), and guarding raw `firebase deploy` run
outside `npm run deploy`.

---

## 1. What is true today

- The Firebase web settings live in `src/environments/environment.ts` (dev) and
  `environment.prod.ts` (production). `vite.config.ts` swaps one for the other in a
  production build unless `USE_DEV_ENV=true`. There is no third choice.
- Everything else per project is already keyed by project id: `arccms.config.json`
  (`projects.<id>`), the generated `src/environments/arc-install.ts` (all projects),
  `functions/.env.<id>` and `firebase.<id>.json`. `arc:configure` writes them, and
  `scripts/arc-install-config.mjs` resolves an alias or id (`resolveProjectId`).
- `npm run deploy -- --project=x` runs `firebase deploy` and **does not build the website**.
  The build is a separate step, done by the guided menu (`WEBSITE_BUILDS`, only for the
  `default` and `production` aliases) or by `deploy:dev` / `deploy:prod`, which are fixed to
  those two aliases.
- `functions/scripts/call-seed.cjs` accepts only `dev` or `prod`. `arc-admin-script.mjs`
  already takes `--project=<alias|id>`, but decides "production" only by the `production` alias.
- The typed-id confirmation in the guided deploy fires for the `production` alias or an id
  that says prod, production or live.

## 2. Decision log

| # | Decision | Choice |
|---|----------|--------|
| E-D1 | Where a project's web settings live | `arccms.config.json`, under `projects.<id>.firebaseConfig`, and written by `arc:configure` into `arc-install.ts` beside the other per-project values. One place per project, no more environment files. |
| E-D2 | Getting them in | `arc:configure --project=<alias\|id>` fetches them with the Firebase CLI (`firebase apps:sdkconfig web --project <id>`) when the project has none yet, so nobody copies a snippet by hand. A `--web-config=<file>` flag is the manual route. The CLI's output format is checked first thing in the build. |
| E-D3 | Choosing at build time | `ARC_PROJECT=<alias\|id>` (an environment variable, set by `scripts/arc-build.mjs --project=<alias\|id>`). `vite.config.ts` resolves it with the shared `resolveProjectId` and replaces `environment.ts` with the settings of that project. |
| E-D4 | No `ARC_PROJECT` | **Exactly today's behaviour**: `npm run build` uses `environment.prod.ts`, `USE_DEV_ENV=true` uses `environment.ts`, `npm run dev` uses `environment.ts`. |
| E-D5 | `ARC_PROJECT` set, project has no `firebaseConfig` | Fall back to the old files (`environment.prod.ts` for the `production` alias, else `environment.ts`), **then check that file's `projectId` is the target**. If not, the build stops: "No web settings for staging. Run npm run arc:configure -- --project=staging". A site that would talk to another project is never built. |
| E-D6 | Deploy always builds | `runDeploy()` builds what it is about to deploy, every time, with no flag to skip it. A deploy that includes the website builds it with `ARC_PROJECT` set to the target. A deploy that includes functions builds them (as today). Rules, indexes and storage rules need no build. The guided menu stops building the website itself and calls the same path, so there is one build. |
| E-D7 | `deploy:dev` and `deploy:prod` | Reduced to `node scripts/arc-deploy.mjs --project default\|production --non-interactive --force && seed`. Their own build steps go, since the deploy builds. |
| E-D8 | Same selector everywhere | `npm run deploy -- --project=<x>`, the guided menu (it already lists every alias), `npm run seed -- <x>` (new script; `seed:dev` and `seed:prod` stay) and `arc-admin-script.mjs --project=<x>` all take an alias or id through `resolveProjectId`. |
| E-D9 | Production marker | `production: true` per project in `arccms.config.json` (shared or under `projects.<id>`). The typed-id confirmation fires for a project marked production, **as well as** under today's rules (the `production` alias, an id saying prod or live), so no install loses a guard. `arc-admin-script.mjs` prints `(production)` for a marked project too. |
| E-D10 | Other project-specific file reads | `arc-admin-script.mjs` `storageBucketFor()` reads the project's install settings first, then the environment files as today. |
| E-D11 | What a staging build contains | The selected project's `firebaseConfig` only. `arc-install.ts` still lists every project's install settings (as now); the web config is not part of that map, so a staging site carries no other project's web settings. |

## 3. Build

**A2.1 Config.** `arccms.config.json` and `arc-configure.mjs`: the `firebaseConfig` object
and `production` flag per project, validated (the web keys the Firebase SDK needs),
`--web-config`, the CLI fetch (E-D2), written into a per-project generated place the build
can read. `arccms.config.example.json` shows a three-project file.

**A2.2 Build.** `scripts/arc-build.mjs` and a pure resolver (testable without Vite) that
returns the environment module for a project: its `firebaseConfig`, or the E-D5 fallback.
`vite.config.ts` uses it when `ARC_PROJECT` is set. `npm run build` keeps working with no
variable.

**A2.3 Deploy.** `runDeploy()` per E-D6 and E-D7. The menu's `WEBSITE_BUILDS` table goes;
its "First: build the website" line stays, and the build is the shared one.

**A2.4 Seed and scripts.** `call-seed.cjs` accepts `dev`, `prod`, or an alias or id.
`arc-admin-script.mjs` per E-D9 and E-D10. `needsTypedConfirmation()` per E-D9.

## 4. Tests

- `arc-configure.spec.ts`: three projects, the flag and the web config round trip,
  validation errors, `--web-config`, the CLI fetch (CLI run mocked).
- A new resolver spec: a configured project; no config falls back to the old files; a
  fallback file naming another project stops with the message; no variable is today's choice.
- `arc-deploy.spec` (new or extended): a website deploy builds with `ARC_PROJECT` set to the
  resolved project; it cannot be skipped; a rules-only deploy builds nothing; `deploy:dev`
  and `deploy:prod` expand to what E-D7 says.
- `arc-deploy-menu.spec.ts`: the typed confirmation for a marked project and for the old rules.
- `arc-admin-script.spec.ts`: `(production)` for a marked project; bucket lookup.
- `check-core.spec.ts`: new generated files are classed as install-owned.
- A two-environment install config (today's) passes every old test unchanged.

## 5. Docs

- New `docs/app/environments.html`: dev, staging and production for an app: adding a
  project, `arc:configure --project`, the production marker, `npm run deploy -- --project`,
  seeding any project.
- Update `docs/getting-started/configure.html` (the environment files table),
  `docs/operations/deploy.html` (deploy builds first), `docs/reference/config-keys.html`,
  `docs/reference/npm-scripts.html`, `docs/concepts/shared-firebase-project.html` and
  `docs/app/custom-space.html`. Run `npm run docs:affected`; retake the deploy screenshots if the
  menu text changed.

## 6. Checks before it is done

- Tests green, `npm run build` ok, `npm run check:core` clean.
- With the dev project only: a build with `ARC_PROJECT=default` contains that project's
  settings and no others; an `ARC_PROJECT` naming a project with no settings fails with the
  E-D5 message. A fake third alias in `.firebaserc` and the config is enough for the build
  and seed-resolution checks.
- **No `firebase deploy --dry-run` with a named-database config** (it really creates the
  database). A real deploy to a second project is done by Gunjan, with targeted commands.
- This checkout's own `production` alias: its `environment.prod.ts` currently names the
  dev project, so under E-D5 a production build refuses until the production web settings
  are added. That is the intended safety, and the docs say so.
