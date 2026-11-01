# App Version and Build Number: Build Spec (AV)

**Status:** agreed with Gunjan 2026-10-31, building.
**Branch:** `feat/app-version`, cut from `dev` (533b6d02), worktree `../arccms-app-version`.

**Scope:** every app built on Arc CMS gets one way to say which build someone is running,
such as `v1.2.0.25 android`: the app's version, the build number Arc CMS counts, and an
optional build label. It shows under Logout in the admin's side panel, in the feedback
panel, and with every feedback report. Arc POS already does this its own way (its
`custom/package.json`, `src/custom/version.ts` and deploy wrapper); this lifts that design
into core with the same file format, so Arc POS can drop its copy.

**Out of scope:** writing the version into the Android and iOS projects (Capacitor lives in
the app, not core); Arc CMS's own version; moving Arc POS over (its own repo, after this
merges).

**Phases:** AV1 numbering and `APP_VERSION`; AV2 the line under Logout; AV3 the version in
feedback; AV4 docs and screenshots. Each phase ends with the whole suite and a critical
review. Deploy order once merged: rules, then the website (no function changes).

---

## 1. What is true today

- `custom/` at the repo root is the app's own folder: never bundled, never edited by Arc CMS,
  treated as the app's by `npm run check:core`. Arc CMS ships only its README.
- `npm run build` is `NODE_OPTIONS="--max-old-space-size=8192 $NODE_OPTIONS" vite build && cp
  dist/client/index.html dist/analog/public/__shell.html`. `npm run deploy` and
  `npm run build:project` both run `npm run build`.
- Arc POS keeps `"version"` and `"build"` in `custom/package.json`, bumps `build` in its own
  deploy wrapper and hands it to the build as `VITE_ARC_BUILD`.
- A feedback report saves `page` and `device`; the rules accept only listed keys
  (`isValidNewFeedback` in firestore.rules).

## 2. Decisions

- **AV-D1 The file.** The version lives in `custom/package.json`, committed: `"version"`
  (set by hand), `"build"` (counted by the build) and `"buildLabel"` (optional, any text).
  Arc CMS does not ship this file: no file, or no `version` in it, means no version anywhere
  and no counting. Arc CMS itself has none. (`buildLabel` rather than `build-label`: npm's own
  package.json fields are camelCase.)
- **AV-D2 When it counts.** Every successful `npm run build` takes the next number and writes
  it back to `custom/package.json` after the build succeeds. A failed build keeps the file as
  it was. `npm run dev` never counts.
- **AV-D3 The next number** is the last `build` plus one:
  - missing or `0`: the next is 1;
  - `-1`: the next is 0, the lowest a build can be;
  - a whole number below `-1`: treated as `-1` with a warning, so the next is 0;
  - anything else (text, a fraction): the build stops with a message, before anything is built.
- **AV-D4 Skipping.** `npm run build -- --no-bump`, or `ARC_NO_BUMP=1`, builds without a number
  and leaves the file alone. `npm run deploy -- --no-bump` passes it on.
- **AV-D5 The label.** `buildLabel` in the file is the default; `--label=<text>` (or
  `ARC_BUILD_LABEL`) replaces it for one build, and `--label=` with nothing clears it. Any
  text: trimmed, at most 40 characters, no control characters (the build stops otherwise).
  `npm run deploy -- --label=<text>` passes it on. One counter for every label.
- **AV-D6 How it reads.** `v` + version + `.` + build, then a space and the label:
  `v1.2.0.25 android`. With no number: `v1.2.0`, or `v1.2.0 android`. The version must be
  three whole numbers, with an optional pre-release or build suffix as npm allows
  (`1.2.0-beta.1`); anything else stops `npm run dev` and `npm run build`.
- **AV-D7 The commit.** The build records the git commit it was made from (8 characters), with
  `+changes` when files other than `custom/package.json` were changed and not committed.
  Never shown to the person; saved with each feedback report and shown on the admin Feedback
  page. Empty outside a git checkout.
- **AV-D8 In code.** `APP_VERSION` (src/app/core/version/app-version.ts) holds `text`,
  `version`, `build`, `label` and `commit`, fixed at build time. An app shows it anywhere it
  likes (Arc POS on its POS screen).
- **AV-D9 Under Logout.** The admin side panel shows `text` under Logout, small and muted,
  when the panel is open; hidden when it is collapsed. A screen reader reads "Version ...".
  An app turns it off with `showVersion: false` in `src/custom/brand.ts` (a new optional
  field of `CustomBrand`; the shipped starter does not change).
- **AV-D10 In feedback.** The feedback panel shows "Version v1.2.0.25 android" at its foot.
  Each report saves `version: { text, commit }`; the admin Feedback page shows both beside
  the device. The rules accept the new optional map (text up to 100 characters, commit up to
  24), so **the rules deploy before the website**: the new website's reports would be refused
  by the old rules. The admin alert keeps its short text.
- **AV-D11 Capacitor.** Arc CMS knows nothing about Capacitor. The docs give the recipe an
  app puts in `custom/package.json`:
  `"build:android": "cd .. && npm run build -- --label=android && npx cap sync android"`.
  Building for two platforms takes two numbers. The docs warn that the stores need a build
  number that only goes up, so ours, which can be reset, is not fed to them as it is.

## 3. Phases

### AV1 Numbering and APP_VERSION

- `scripts/arc-version.mjs`: reading `custom/package.json`; checking the version and label;
  the next number (AV-D3); rewriting the file with `build` right after `version`, everything
  else as it was; the commit (AV-D7); the version object and its text (AV-D6).
- `scripts/arc-website-build.mjs`: what `npm run build` runs. Reads `--no-bump`, `--label`
  and their environment variables, works out the number, runs `vite build` with the 8 GB heap
  (a caller's `NODE_OPTIONS` still wins), copies `__shell.html`, then writes the number back.
  Hands the build `VITE_ARC_BUILD` (the name Arc POS already reads) and `ARC_BUILD_LABEL`.
- `vite.config.ts` reads the version (stopping on a bad one, like the other custom checks)
  and defines `__ARC_APP_VERSION__` for `APP_VERSION`.
- `npm run deploy`: takes `--no-bump` and `--label` off the arguments it gives Firebase and
  hands them to the website build.
- Tests: every rule of AV-D3 to AV-D7, the file rewrite, the build wrapper's order (nothing
  written on a failed build), the deploy pass-through, the build script's heap.

### AV2 The line under Logout

- The side panel's line (AV-D9), its translation key, `showVersion` on `CustomBrand`.
- Tests: shown with a version, hidden with none, hidden when collapsed, hidden by
  `showVersion: false`.

### AV3 The version in feedback

- The panel's line, the saved `version` map, the admin page's line, the rule and its tests.
- Tests: component and service specs, rules tests (accepted with and without, refused when
  too long or with other keys).

### AV4 Docs and screenshots

- New page `docs/app/version.html`: the file, counting, `--no-bump`, labels, Capacitor,
  `APP_VERSION`, the store warning, committing the file.
- Updates: feedback, build and deploy, admin look (`showVersion`), config keys, troubleshooting.
- Screenshots: the admin side panel and the feedback panel.

## 4. Moving Arc POS over (later, in its repo)

Delete `src/custom/version.ts` and the numbering in `custom/scripts/deploy.mjs` (or it counts
twice), import `APP_VERSION` from core, set `showVersion: false` if the admin line is not
wanted. Its `custom/package.json` stays as it is.
