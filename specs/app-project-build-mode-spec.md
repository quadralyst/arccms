# A Non-Production Project Can Build Like Production: Build Spec (F3)

**Status:** built 2026-10-06 on `feat/project-build-mode`; suite green, docs updated
(docs/app/environments.html, new section "Build like production"). Not yet merged to `dev`.
**Branch:** `feat/project-build-mode`, cut from `dev` (0e06e38).
**Scope:** a project's builds can run like production (no debug mode, no instance label on
sign-in) without that project being guarded as the live one, and a project build keeps
every key of `environment.ts`, not only `production` and `firebaseConfig`.

**Out of scope:** per-project values for other environment keys (they stay one set per app,
from `environment.ts`), build mode for a project that still builds from a hand-edited
environment file (no web settings of its own), and any change to the production guard.

---

## 1. What was true

- `arc:configure --web-config=fetch` wrote `src/environments/firebase-web.<id>.ts` with
  `production: <project marked --production=yes>` and `firebaseConfig`, nothing else.
- So a staging build always ran in development mode: `GlobalService.debugMode` on, the
  instance label on the sign-in page (`signup.page.ts`), Transloco's missing-key logging
  and `prodMode` off. Staging could not rehearse production.
- Any other key an app adds to `environment.ts` was missing from every project build.

## 2. Decision log

| # | Decision | Choice |
|---|----------|--------|
| BM-D1 | Where the build mode lives | `buildMode` per project in `arccms.config.json`, `"production"` or `"development"`, set with `arc:configure --build-mode=production\|development`. A string like every other key. |
| BM-D2 | Default | Not set: `production` for a project marked `production: "yes"`, else `development` (`buildModeOf()`). This is exactly what the generated file said before, so existing installs build as today. |
| BM-D3 | Separate from the guard | `--production=yes` still means "the live project, type its id to deploy". `--build-mode` never sets or reads the guard beyond the default. A staging project with `buildMode: "production"` deploys with a plain yes. |
| BM-D4 | How the other keys are kept | The generated file **imports `environment.ts` and spreads it**, overriding `production` and `firebaseConfig`. Chosen over copying keys at configure time because it cannot go stale: a later edit to `environment.ts` reaches every project build without configuring again. The base is `environment.ts` (the file the app imports), not `environment.prod.ts`. |
| BM-D5 | The swap and the spread | `environmentSwap()` serves the project file wherever the app imports `environment.ts`. The project file's own import of `./environment` is left alone (the importer is the swap target), or it would import itself. Tested by a fixture build that fails without that guard. |
| BM-D6 | No web settings of its own | The build mode cannot apply (the build uses the hand-edited environment file as is). `arc:configure --build-mode` stores it and prints that it applies once the project has its web settings, with the command. |
| BM-D7 | Guided deploy | **No new question.** The default is right for nearly every project, and the flag is one command. The summary shows a `Build:` line (like production, or development) for a project with its own web settings and a website, so the mode is visible before deploying. |
| BM-D8 | Old generated files | A file generated before this change has no import and still works. The guided deploy runs `arc:configure` before every deploy, so it is rewritten in the new shape on the next one. |

## 3. Build

- `scripts/arc-configure.mjs`: `--build-mode` flag (`buildMode` key), `BUILD_MODES`,
  `buildModeOf()`, validation, `renderWebConfig()` imports and spreads `environment.ts`,
  the BM-D6 note.
- `scripts/arc-environment.mjs`: `environmentSwap()` skips imports made by the target file.
- `scripts/arc-deploy-menu.mjs`: `installSummary()` adds the `Build:` line (BM-D7).
- `arccms.config.example.json`: a staging project with `"buildMode": "production"`.

## 4. Tests

- `arc-environment.spec.ts`, "a staging project built like production": runs the real
  `arc:configure` in a temp folder, then builds a fixture app with `environmentFor()` and
  `environmentSwap()` (as `vite.config.ts` does) and imports the output. With
  `--build-mode=production`: debug mode off, no instance label, staging's project id, and
  the app's own keys kept. Without it: development, as before. A later edit to
  `environment.ts` reaches the build with no new configure.
- `arc-configure.spec.ts`: the default per BM-D2, the separation per BM-D3, the flag, the
  validation, the spread shape, and `main()` storing the key and printing the BM-D6 note.
- `arc-deploy-menu.spec.ts`: the `Build:` line and when it is left out.

## 5. Docs

- `docs/app/environments.html`: new "Build like production" section; the guard section says
  a guarded project builds like production unless told otherwise; troubleshooting row.
- `docs/reference/config-keys.html` and `docs/getting-started/configure.html`: the
  `buildMode` key and `--build-mode` flag.
- `docs/operations/deploy.html`: the summary's build line; the typed confirmation also
  covers a project marked `--production=yes`.
- Other pages listed by `npm run docs:affected` were read and are still right.

## 6. Checks before it is done

- Suite, `tsc -p tsconfig.app.json`, `check:docs`, `check:core` green.
- Done without deploying: a throwaway `firebase-web.acme-staging-test.ts` (fake values,
  build mode production) type-checked with `tsc -p tsconfig.app.json`, and
  `ARC_PROJECT=acme-staging-test npm run build` built with it: the bundle's environment is
  `{production: true, firebaseConfig: {...acme-staging-test...}}` and has no dev API key.
  The file and the build output were removed.

**End-of-work browser pass (needs a second project, by Gunjan):** on a staging alias with
fetched web settings, `npm run arc:configure -- --project=staging --build-mode=production`,
then `npm run deploy -- --project=staging`: the sign-in page shows no project and database
label, and the console shows no Transloco missing-key warnings. The guided deploy's summary
shows `Build:      like production` and asks a plain "Deploy?" (no typed id). Without the
flag, the label shows as before.
