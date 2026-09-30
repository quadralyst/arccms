# Arc CMS developer documentation: strategy

**Status:** D0 approved 2026-09-29. D1 to D4 built 2026-09-30 (foundation and rename, getting started and concepts, 25 feature pages, both paths, operations, reference; the old guides are retired). Tutorials and screenshots (D5 to D7) are not built.
**Branch:** `feat/developer-docs`, cut from `dev` (483963a, which includes `feat/coexistence`, `feat/feature-flags` and `feat/user-home`). Built in the worktree `~/Projects/arccms-docs` so the dev server on the main checkout is never touched.

This document is the plan for the official developer documentation: what it covers, how it is laid out, how it is written, how it is kept true, and in what order it is built. It is a spec, so after D1 it lives in `specs/`.

## 1. Decisions already made

| # | Decision | From |
|---|---|---|
| 1 | Official docs are HTML, in `docs/`. The current `docs/` is renamed `specs/`. | discussion |
| 2 | Two audiences in one set: developers new to Arc CMS, and the people who run a site or app once it exists. Admin and member pages are minimal for now. | discussion |
| 3 | Two use cases, both covered: **building a website** and **building a custom app**. | discussion |
| 4 | The docs live in the repo only. Publishing them on the website is a separate project, so pages must be easy to lift out. | discussion |
| 5 | The markdown guides are removed once their content is in the HTML docs. No page exists in both forms. | discussion |
| 6 | "Docs and tests are part of done" goes into `CLAUDE.md` and project memory. | discussion |
| 7 | Screenshots are wanted and every change reviews them, but they wait until after the pages and sample apps (D7). The fake-data seed for them runs on `xlm-project-864ff`. | discussion |
| 8 | Tutorials build small, real apps. They come after the docs (D5, D6). Capacitor is a pointer page, not a full tutorial. | discussion |
| 9 | `dev` is not pushed. | discussion |

## 2. Two folders, one rule

| | `docs/` (official) | `specs/` (working papers) |
|---|---|---|
| What it holds | How Arc CMS works and how to use it, today | Why and how we build it: decisions, phases, status, test plans, runbooks, briefs, the backlog |
| Tense and content | Present tense only. No phase codes, branch names, dates, status lines, project ids. | Anything, including history |
| Reader | A developer or site owner | Us, and AI agents building Arc CMS |
| Links | Never links into `specs/` | May link into `docs/` |
| Format | HTML | Markdown |
| Core or custom | Core, except `docs/custom/`, which is the app's own (already a custom path in `check:core`) | Core |

**What moves to `specs/` as it is:** every `*-spec.md`, `email-testing-guide.md`, `features-test-checklist.md`, `email-self-evaluation.md`, `audience-migration-runbook.md`, `template-generation-brief.md`, `_todo.md`, and this document.

**What becomes HTML and is then deleted:** `INSTALL.md`, `ARCHITECTURE.md`, `TEMPLATES.md`, `template-tutorial.md`, `deploy.md`, `security-rules.md`, `app-rules.md`, `features.md`, `custom-code.md`, `account-contract.md`, `search-developer-guide.md`, `discoverability-developer-guide.md`, `discoverability-content-guide.md`, `i18n-guide.md`, `email-system.md`, `pwa.md`, `feedback.md`, `sign-in-methods.md`, `app-audience-integration.md`, `dodo-payments-entitlement-contract.md`.

**What stays at the repo root:** `README.md` (shortened, points at the docs), `CONTRIBUTING.md`, `CHANGELOG.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `LICENSE`, `CLAUDE.md`.

The rename is mechanical: about 380 references, all in comments, tests, `.gitignore`, `CLAUDE.md` and the specs themselves; none is code that reads a file. D1 does it with a script and a test that fails on any reference to a file that does not exist.

Moving a guide is one commit: write the page, delete the markdown, repoint every reference to the new page. The stale-reference test (section 8) fails the suite if any is missed.

## 3. The shape of the docs

Plain HTML: one file per page, one shared stylesheet, one small script. No build step, no framework, no dependencies. Open `docs/index.html` and it works, from disk, offline. This keeps the docs out of the core build, so editing a page never slows or breaks the app, and a page is easy to lift into the website later.

```
docs/
  index.html                     the home page: "What are you doing?" and four doors
  assets/
    docs.css                     the one stylesheet (light, dark, phone)
    docs.js                      sidebar, search, on-page contents, copy buttons, theme
    nav.js                       the page list, defined once (title, path, section)
    search-index.js              titles and headings of every page, generated
  getting-started/               shared by both paths
  concepts/                      how Arc CMS is built and why it is shaped this way
  website/                       path: build a website
  app/                           path: build a custom app
  features/                      one page per feature
  admin/                         minimal for now: a map of the admin menu
  members/                       minimal for now: what a signed-in member sees
  operations/                    deploy, security, testing, troubleshooting
  reference/                     lookups: scripts, config, features, functions, tags, glossary
  tutorials/                     D5 and D6
  contributing/                  working on core
  custom/                        the app's own docs (never touched by core)
```

### The four doors

The home page asks what you are doing and offers:

1. **Get started**: install, configure, run, first admin, deploy. Shared.
2. **Build a website**: an ordered path.
3. **Build a custom app**: an ordered path.
4. **Use Arc CMS**: for the people running it (minimal for now).

Reference (features, operations, lookups) sits below the doors and in the sidebar.

**Paths say what to do and in what order. Feature pages say how.** A path step gives two or three sentences on why and when, then links to the feature page. Both paths link to the same feature page, so each fact lives in one place.

### Page inventory

This is the target. A page appears in the navigation only when it exists (the nav test enforces that), so unbuilt pages are never dead links.

**Get started** (`getting-started/`): what-is-arc-cms, website-or-app, requirements, install, configure, run-locally, first-admin, folder-tour, first-deploy, upgrading.

**Concepts** (`concepts/`): architecture, core-and-custom, roles-and-claims, shared-firebase-project (the named database and the `arccms-` functions).

**Build a website** (`website/`): overview, plan-content, content-types, templates, static-pages, media, authors-and-tags, seo, languages, search, forms, choose-features, launch-checklist.

**Build a custom app** (`app/`): overview, custom-space, choose-features, pages-and-routes, admin-menu, member-area, functions, rules-and-indexes, account-contract, sign-in, payments, pwa, app-audience, shared-project, check-core-and-upgrade.

**Features** (`features/`), one page each. The ten switchable features have a page named for their id, which the feature test requires: `content`, `search`, `seo`, `forms`, `audience`, `email-marketing`, `sms`, `payments`, `data`, `pwa`. The always-on features are: `templates`, `media`, `authors-and-tags`, `languages`, `sign-in`, `app-audience`, `email` (the engine: provider, brand kit, composer, logs, unsubscribe), `automations`, `entitlements`, `feedback`, `notifications`, `analytics`, `banners`, `users-and-roles`.

**Use Arc CMS** (`admin/`, `members/`): one page each for now.

**Operations** (`operations/`): deploy, targeted-deploys, security-rules, testing, troubleshooting (including the known traps: a dry run that creates a database, triggers orphaned by a recreated database, admin pages that need an explicit route, dev server memory).

**Reference** (`reference/`): npm-scripts, config-keys, feature-ids, cloud-functions, email-tags, data-model, glossary.

**Tutorials** (`tutorials/`, after D4): lead-website, crm, pwa, backend-for-existing-app, capacitor.

**Contributing** (`contributing/`): keep-core-generic, docs-and-tests-are-part-of-done, frontend-notes (zoneless Angular, OnPush pitfalls, the Analog pathless-group trap).

About 75 pages in all. Until D5, the home page names the five tutorials as coming, without links.

### Where each markdown guide goes

| Source | Destination |
|---|---|
| `INSTALL.md`, `deploy.md` | getting-started/install, configure, first-deploy; operations/deploy |
| `ARCHITECTURE.md` | concepts/architecture |
| `TEMPLATES.md`, `template-tutorial.md` | features/templates, website/templates |
| `features.md` | features overview in app/choose-features and website/choose-features; reference/feature-ids |
| `custom-code.md` | app/custom-space, pages-and-routes, admin-menu, functions, check-core-and-upgrade |
| `account-contract.md` | app/account-contract |
| `app-rules.md`, `security-rules.md` | app/rules-and-indexes, operations/security-rules |
| `search-developer-guide.md` | features/search |
| `discoverability-developer-guide.md`, `discoverability-content-guide.md` | features/seo, website/seo |
| `i18n-guide.md` | features/languages, website/languages |
| `email-system.md` | features/email, email-marketing, automations, reference/email-tags |
| `app-audience-integration.md` | features/app-audience, app/app-audience |
| `dodo-payments-entitlement-contract.md` | features/payments, entitlements, app/payments |
| `sign-in-methods.md` | features/sign-in, app/sign-in |
| `pwa.md` | features/pwa, app/pwa |
| `feedback.md` | features/feedback |

Facts the guides do not carry (config keys, functions list, data model) are taken from the code and checked by the lookup tests.

## 4. Writing rules

- **Task first.** A page starts with what you can do after reading it, then the shortest way to do it. Reasons come second and stay short.
- **One fact, one place.** If a page needs a fact that lives on another page, it links to it.
- **Present tense, plain words.** No "we", no history, no "recently", no "now".
- **Steps are numbered, commands are copyable.** Every command is in its own `<pre><code>` block with a copy button and has been run at least once. Output that matters is shown.
- **Code and paths are checked.** A path in `<code>` must exist in the repo. A path the reader creates is written `<code class="new">` and is not checked.
- **Callouts:** `note` for context, `warn` for something that breaks or loses data, `trap` for the mistakes we have actually made (each is a real bug in our history, stated as what happens and what to do).
- **No em dashes or en dashes** anywhere. Use a comma, colon, full stop, or "such as".
- **No internal terms.** No phase codes (S1, CO6.9, D3), branch names, dates of builds, status lines, Firebase project ids or links into `specs/`.
- **Ease of use first.** Prefer one recommended path over a survey of options. Options go on their own labelled line, after the recommendation.
- **British or American spelling:** American, consistent with the UI copy.

### The page skeleton

Every page is a full HTML document so it opens on its own and can be lifted whole:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Search | Arc CMS docs</title>
  <meta name="description" content="One sentence: what this page lets you do.">
  <meta name="docs:sources" content="functions/src/search, src/app/core/search">
  <link rel="stylesheet" href="../assets/docs.css">
</head>
<body data-root="../">
  <main>
    <h1>Search</h1>
    <p class="lead">What you can do, in one or two sentences.</p>
    ...
  </main>
  <script src="../assets/nav.js"></script>
  <script src="../assets/search-index.js"></script>
  <script src="../assets/docs.js"></script>
</body>
</html>
```

`docs:sources` lists the source files and folders the page describes. It is what makes "review the docs when you change something" practical: `npm run docs:affected` reads the changed files and prints the pages whose sources overlap them. It is also checked, so a page cannot point at a file that was renamed.

The navigation, sidebar, breadcrumbs, prev and next, and "On this page" are all built by `docs.js` from `nav.js` and the page's own headings. Without JavaScript a page is still readable, just without the menu.

### The feature page skeleton

Every feature page has the same `h2` sections, in this order, so a reader always knows where to look. A section that does not apply says so in one line.

1. **What it is**: what you get, in plain words.
2. **Turn it on or off**: the id in `features.ts`, what it needs, what goes when it is off.
3. **Set it up**: the fewest steps from nothing to working.
4. **Use it**: the everyday tasks, by name of the admin screen.
5. **Extend it**: the plug points for an app, with a short example.
6. **What it stores**: collections, Storage paths and Cloud Functions.
7. **Who can do what**: roles and the rules that enforce it.
8. **Troubleshooting**: symptom, cause, fix.

## 5. The two paths

The paths are short pages in a fixed order. Each ends with "Next".

**Build a website** (a content site with lead generation):
overview, plan the content, content types and fields, templates, static pages, media, authors and tags, SEO, languages, search, forms and waitlists, choose your features (the recommended set for a website), launch checklist.

**Build a custom app** (a product on a copy of Arc CMS):
overview (when this is the right choice, and when it is not), the custom space, choose your features, pages and routes, admin menu, the member area, your own functions, rules and indexes, the account contract, sign-in, payments, PWA, connecting your app's users (App audience), sharing a Firebase project, `check:core` and upgrading.

A third use, Arc CMS as the backend of an existing app such as a web app or a Chrome extension, has no path of its own: it is `app/app-audience`, `app/account-contract`, `app/shared-project` and tutorial 4.

## 6. How the pages are written (method)

Speed matters, so the feature pages are drafted in parallel and checked one by one:

1. For each page, an agent gets the page skeleton, the writing rules, the source guide (if any) and the code paths for that feature. It drafts the page and lists its `docs:sources`.
2. I check every claim in the draft against the code, run each command, fix the draft, and only then add it to the nav.
3. The guide it replaces is deleted and its references repointed, in the same commit.

A draft is never trusted: names, options, paths and defaults are read from the code, not from the guide, because guides go stale first.

## 7. Keeping the docs true

Guardrails run in `npm run test` (they live in `scripts/__tests__/docs/`, which the existing config already runs, and `npm run check:docs` runs them alone). A stale doc fails the suite, and a failing suite means the task is not done.

| Check | Fails when |
|---|---|
| Nav coverage | A page is not in `nav.js`, or `nav.js` lists a page that does not exist |
| Links and anchors | An internal link or `#anchor` does not resolve |
| Page shape | A page lacks the title, description, `docs:sources`, the three scripts, or the stylesheet |
| Sources exist | A path in `docs:sources` or in a plain `<code>` does not exist in the repo |
| Feature pages | A feature id in `FEATURE_IDS` has no `features/<id>.html`, or a feature page misses a required section |
| npm scripts | A script in `package.json` is not in `reference/npm-scripts.html`, or the page lists one that does not exist |
| Config keys | A key in `arccms.config.example.json` or a `CUSTOM_*` starter file is undocumented (and the reverse) |
| Cloud functions | A function exported by `functions/src/all.ts` is not in `reference/cloud-functions.html` (and the reverse) |
| Writing rules | An em or en dash, a phase code, a branch name, a project id, or a link into `specs/` appears in `docs/` (outside `docs/custom/`) |
| Stale references | Any file in the repo names a `docs/` or `specs/` path that does not exist |
| Search index | `search-index.js` differs from what `npm run docs:index` would write |
| Screenshots (from D7) | A manifest entry has no image, an image is on no page, or a page shows a screen whose source changed and was not retaken |

**Docs are part of done** (recorded in `CLAUDE.md` and project memory). Every task that changes Arc CMS:

1. Runs `npm run docs:affected` and reads the pages it lists.
2. Updates those pages (and their screenshots, once D7 exists) in the same task, or says in the report why none needed it.
3. Adds or updates the tests that would have caught the drift.
4. Runs the whole suite (`npm run test`, and `npm run test:rules` when rules changed). If anything fails, the task is not done.

## 8. Tooling

| Script | What it does | Built in |
|---|---|---|
| `npm run check:docs` | Runs only the docs tests | D1 |
| `npm run docs:index` | Rewrites `docs/assets/search-index.js` from the pages | D1 |
| `npm run docs:affected` | Lists the pages whose `docs:sources` overlap the files changed against a base (default `dev`) | D1 |
| `npm run docs` | Serves `docs/` on a local port for browsing (optional, the files open directly) | D1 |
| `npm run docs:seed` | Writes fake contacts, content, forms and orders to the demo project; `--clean` removes them | D7 |
| `npm run docs:screenshots` | Signs in once, then captures every screenshot in `docs/screenshots.json` | D7 |

## 9. Sample apps and tutorials

After the docs (D5, D6). Each tutorial ends with a small app that works, and its finished code is in `docs/examples/<name>/` as a custom space (`src/custom/`, `functions/src/custom/`, app rules). A test type-checks every example against core, so a core change that breaks a tutorial fails the suite. Each tutorial is verified by copying its example into a scratch worktree of `dev` and following the page in the browser before it counts as written.

| # | Tutorial | What is built | What it teaches |
|---|---|---|---|
| 1 | A website that generates leads | A small company site: pages, a blog, a waitlist form with referrals, a thank-you email | Content types, templates, SEO, forms, the email engine |
| 2 | A basic CRM | Contacts, lists and tags, a custom Deals admin page with its own collection and rules, a follow-up sequence | Audience, email marketing, extending core in the custom space |
| 3 | A PWA | An installable members app with sign-in and a premium section | Custom space, feature choice, routes, PWA, payments and entitlements |
| 4 | Arc as the backend of an existing app | A small standalone web app and a Chrome extension that use Arc for users, emails and marketing | App audience, the account contract, a shared Firebase project |
| 5 | A mobile app with Capacitor | The PWA from tutorial 3 wrapped in Capacitor | A pointer page: add Capacitor, build, and where plugins come in. It does not teach a plugin stack |

## 10. Phases

Every phase ends the same way: the whole suite passes, I send a short report saying what changed and which docs pages and tests were touched, and you review by opening the docs. Nothing is pushed.

### Morning cut: D1 to D4

| Phase | Scope | Acceptance |
|---|---|---|
| **D0** | This document | You approve it |
| **D1** Foundation | `git mv docs specs` and repoint the references (script); the docs rule in `CLAUDE.md`; `docs/` shell (home page with the four doors, `docs.css`, `docs.js`, `nav.js`, page template, dark mode, phone layout, search, on-page contents); the guardrail tests, `check:docs`, `docs:index`, `docs:affected`, `docs`; `docs/custom/README` for apps | Suite green. The home page opens from disk, on a phone width, in light and dark. Every guardrail has a test that fails when it should (each proven with a deliberately broken page) |
| **D2** Get started and concepts | The `getting-started/` and `concepts/` pages; `INSTALL.md`, `ARCHITECTURE.md` and `deploy.md` moved in and deleted | A developer with a fresh clone can install, configure, run and deploy from the pages alone; every command was run |
| **D3** Features | One page per feature (about 24), from the guides and the code; the matching guides deleted and references repointed | Every feature id has a page with all sections; every claim checked against the code |
| **D4** Paths, operations, lookups | The `website/` and `app/` paths; `operations/`; `reference/` with the two-way lookup tests; minimal `admin/` and `members/`; `CLAUDE.md` and the README point at the docs; `custom-code.md`, `account-contract.md` and the rest of the guides removed | No guide markdown remains; the lookup tests pass in both directions; both paths read start to finish |

If time runs short, D4's lookup pages are the part that can follow. The four doors, getting started, both paths and the feature pages come first.

### After the morning cut

| Phase | Scope |
|---|---|
| **D5** Tutorials 1 to 3 | Lead website, CRM, PWA, each with its example app, its type-check test and a browser check |
| **D6** Tutorials 4 and 5 | Backend for an existing app (web app and Chrome extension), and the Capacitor pointer page |
| **D7** Screenshots | The fake-data seed on `xlm-project-864ff`, the capture script and manifest, screenshots for every page that shows a screen, and the screenshot guardrail |

## 11. Order of work and risks

- **Rename first (D1).** Everything after it uses the final paths. It lands on `dev` as soon as D1 passes, so other branches conflict less.
- **`docs/custom/` stays the app's.** Doc tests skip it, and `check:core` already treats it as custom. Apps put their own pages there; letting them join the navigation is a later plug point.
- **`check-core.mjs` and its test** name the custom-code guide in a message; D4 repoints them at `app/check-core-and-upgrade.html`.
- **No dev server disruption.** All work is in the `arccms-docs` worktree with `node_modules` linked. Docs tests never start a server or touch Firebase.
- **Live checks.** Commands and flows in the pages are run against the dev project `xlm-project-864ff` only, and never written into a page with its project id.
- **Drift during the build.** New work landing on `dev` while the docs are written follows the same rule: it updates the page in the same task.

## 12. Open points

1. `template-generation-brief.md` (designing page mockups with Claude) stays in `specs/` for now. It reads like a how-to, so it may become a page under `website/` later.
2. `README.md` carries a long feature list. D4 shortens it and links to the docs; the wording of what stays is yours to approve.
3. Search in the docs is title and heading only, so it works from disk with no server. Full-text search is possible later if it is wanted.
