# CI Deploys: the Region Check and the CI Docs: Build Spec (F4)

**Status:** built 2026-10-06 on `feat/ci-deploys`; suite green, docs updated (new page
docs/app/ci.html). Not yet merged to `dev`.
**Branch:** `feat/ci-deploys`, cut from the tip of `feat/project-build-mode` (e08636e), because
both change `arc-configure.mjs`, the deploy scripts and docs/app/environments.html. Merge
`feat/project-build-mode` first.
**Scope:** a CI run from a clean checkout, with the ignored files recreated by
`arc:configure` flags, deploys a non-production project in one pass with no prompt; the
region message tells the truth about what git keeps; a production-marked project cannot be
deployed from the command line by mistake; and the CI setup is documented.

**Out of scope:** keeping the functions region across CI runs automatically (CI passes
`--functions-region`; the deploy cannot write back to the job's config), moving live
functions between regions, and a CI workflow file in the repo itself.

---

## 1. What was true

- `checkFunctionsRegion()` (`scripts/arc-deploy.mjs`), on a first deploy with the database
  outside the functions region, wrote the region with `arc:configure` and, when the deploy
  also published the website, stopped: "Build it, then deploy again. Nothing was deployed."
  That stop dated from before A2, when the website was built before the deploy. Since A2,
  `runDeploy()` runs the region check first and builds the website after it (checked in the
  code: the check, then `builds.includes('website')`), so the build already uses the new
  region. The guided deploy never stopped: it runs the check without the website flag.
- The message said "commit it (arccms.config.json) with src/environments/arc-install.ts".
  `arccms.config.json` is in `.gitignore`; `arc-install.ts` is committed (it is not ignored,
  `git ls-files` lists it). So the advice could not be followed.
- In CI the written `arccms.config.json` is thrown away, so the stop came back on every run.
- The production marker (`--production=yes`) guarded only the guided deploy.
- `--web-config=<file>` read JSON or the console snippet, but not an environment file, so
  CI could not recreate `firebaseConfig` from what git has.

## 2. Decision log

| # | Decision | Choice |
|---|----------|--------|
| CI-D1 | The stop | Removed. `checkFunctionsRegion()` loses its `includesWebsite` option; an adopt always proceeds. A test pins the order in `runDeploy()` (region check before the website build). |
| CI-D2 | The message | `adoptMessage()`: saved in `arccms.config.json` (git ignores it) and `src/environments/arc-install.ts` (commit that one, the website reads it); where `arccms.config.json` is recreated, as in CI, add `--functions-region=<region>`, or a later deploy puts the functions back in `us-central1`. |
| CI-D3 | Which files CI recreates | `.firebaserc` (one `echo`, optional since every script takes an id), `arccms.config.json`, `firebase.<id>.json` and `functions/.env.<id>` (all from one `arc:configure` with flags). `firebase-web.<id>.ts` and `arc-install.ts` are committed; `arc:configure` rewrites them, and removes a `firebase-web.<id>.ts` whose project has no web settings in the config, so CI passes them back with `--web-config`. |
| CI-D4 | `--web-config` from an environment file | `parseWebConfigText()` reads the `firebaseConfig: { ... }` (or `firebaseConfig = { ... }`) block when there is one, so `--web-config=src/environments/firebase-web.<id>.ts` and `environment.ts` work. Comments are stripped only at a line start or after `,`/`{`, so the `//` in `databaseURL` survives. JSON and the console snippet read as before. |
| CI-D5 | The guard's flag | `--confirm-production=<project id>`, read by the flag path (`runDeploy`), never passed on to the Firebase CLI. The guided deploy keeps its own typed confirmation and tells `runDeploy` it has asked (`productionConfirmed`). |
| CI-D6 | Marked project, no flag | **On a terminal: ask for the id typed back. Off a terminal: refuse, before anything runs.** "Off by default" is read as: a project not marked is untouched, so `deploy:dev`, CI for staging and every install without a marker behave exactly as before. Refusing (not warning) for a marked project is the safer choice: `deploy:prod` passes `--force`, which already answers the delete question, so a warning would scroll past in a script while the live project is replaced. `--force` and `--non-interactive` do not count as a confirmation: they answer other questions. |
| CI-D7 | `deploy:prod` on a marked project | Run in a terminal, it asks for the id once (the only new prompt). From a script it stops; the docs give the flag form (`npm run deploy -- --project production --confirm-production=<id> --non-interactive --force`, then `npm run seed:prod`), since npm appends extra arguments after the `&& npm run seed:prod` part of the script. `package.json` is unchanged. |
| CI-D8 | A flag naming another project | Refused for any project, marked or not: a copied command must never deploy somewhere else. An empty value counts as another project. |
| CI-D9 | The production alias heuristics | The guided deploy also confirms the `production` alias and ids with prod or live. The command-line guard uses only the marker: applying the name rules would have refused `deploy:prod` off a terminal on every install. |

## 3. Build

- `scripts/arc-deploy.mjs`: CI-D1, CI-D2 (`adoptMessage`), CI-D5 to CI-D8
  (`confirmProductionArg`, `productionGuard`, the check at the top of `runDeploy`,
  `deployArgs` drops the flag).
- `scripts/arc-deploy-menu.mjs`: passes `productionConfirmed: true`; the off-terminal help
  names the flag.
- `scripts/arc-configure.mjs`: CI-D4.
- Docs: new `docs/app/ci.html` (in the navigation after Dev, staging and production).

## 4. Tests

- **`arc-deploy-ci.spec.ts` (the "one pass, no prompts" test).** Copies the real scripts and
  `firebase.json` into a temp folder that looks like a clean checkout (committed
  `firebase-web.<id>.ts` and `arc-install.ts`, no ignored files), puts stand-ins for
  `firebase` and `npm` first on the PATH and stubs `fetch` (the Hosting release and Google's
  token endpoint), then runs `arc-configure.mjs` with the CI flags and `arc-deploy.mjs
  --project staging --non-interactive --force` with no terminal and empty input. A first
  deploy with the database in `asia-south1` and no functions deployed: exit 0, no question
  printed, the website built with `ARC_PROJECT=acme-staging` and an `arc-install.ts` that
  already has `functionsRegion: "asia-south1"`, one `firebase deploy` with the generated
  config, the channel deploy and the release. With the region recreated: no region change.
  The guard: a marked project without the flag exits 1 before any CLI call; a wrong id
  exits 1; the right id deploys and the flag never reaches the CLI. Run against the old
  `arc-deploy.mjs`, the first-deploy and guard cases fail.
- `arc-region.spec.ts`: an adopt with a website proceeds; the order in `runDeploy`; the
  message names what is ignored, what to commit, and the CI flag.
- `arc-configure.spec.ts`: `productionGuard` cases (not marked, given, terminal, refused,
  mismatch, empty), `deployArgs` drops the flag, `parseWebConfigText` on a hand-written
  environment file (comments, `databaseURL`) and on a generated file.

## 5. Docs

- New `docs/app/ci.html`: what CI recreates and how, the service account (Firebase Admin and
  Service Account User; `datastore.databases.get` for the region check, or Cloud Datastore
  Viewer with narrow roles), Java 21 for `npm run test:rules`, a GitHub Actions workflow
  (setup-node 22 with both lockfiles, setup-java temurin 21, `npm ci` in root and
  functions, the Firebase CLI from `functions/node_modules/.bin`, google-github-actions/auth
  with a key or workload identity, `arc:configure` flags, tests, deploy, seed), and the
  production guard.
- `docs/operations/deploy.html`: the options table (`--confirm-production`), what a deploy
  with options can ask, the regions bullet (no stop, what to commit, CI), `deploy:prod` on a
  marked project.
- `docs/app/environments.html`, `docs/getting-started/first-deploy.html`,
  `docs/reference/npm-scripts.html`, `docs/reference/config-keys.html`,
  `docs/operations/troubleshooting.html`: the guard and the region text. Other pages listed by
  `npm run docs:affected` were read and are still right.

## 6. Checks before it is done

- Suite, `check:docs`, `check:core` green. No deploy of any kind was run; every CLI call in
  the tests goes to a stand-in.

**End-of-work checks (by Gunjan, need a CI runner and a staging project):** the workflow in
docs/app/ci.html on a fork, against a staging project with a service account holding the
two roles: it tests, deploys and seeds in one run with no prompt, and the site talks to
staging. On a terminal, `npm run deploy -- --only firestore --project <marked project>` asks
for the id and stops on a wrong one; with `--confirm-production=<id>` it deploys without
asking.

**Finding for the coordinator:** a project that is marked production and deployed with
`npm run deploy:prod` from a script (not a terminal) now stops. No install marks a project
yet as far as this checkout shows (the marker arrived with A2 on 2026-10-06), but anyone who
marked one and runs `deploy:prod` unattended must switch to the flag form.
