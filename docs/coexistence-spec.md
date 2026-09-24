# ArcCMS Coexistence: Build Spec

**Status:** CO1 built (on `fix/role-escalation-rules`). CO2 (094007a), CO3 (5de5d92), CO3.1, CO3.2 and CO4 built on `feat/coexistence` (2026-09-23). CO3.1 is deployed to the dev project `xlm-project-864ff` (named database `arccms`); CO4 is deployed on `xlm-project-864ff` next to the old install (see CO4 below). CO5 done (hosting off, upload folder). CO6a built; CO6b (arccms_role) next. CO7, CO8 not started.
**Branch:** `feat/coexistence`, cut from `fix/role-escalation-rules` (CO1) because `dev` lacks the search, discoverability and multilingual work this builds on.
**Scope:** let ArcCMS share a Firebase project with other applications (their own
functions, triggers, rules, storage, Firestore data and hosting) without either side
breaking the other, while a fresh standalone install keeps working with no extra setup
and every install already deployed keeps working after the upgrade.

**Out of scope:** prefixing every Firestore collection name (rejected, see CO-D1),
running several ArcCMS instances inside one Firebase project (deferred to CO8), and
the extension points that make ArcCMS a framework for new apps (a separate topic;
this spec only makes sure the infrastructure allows it).

---

## 0. Deployment profiles

ArcCMS has to work in four shapes. The spec is judged against all four.

| # | Profile | Who signs in to ArcCMS | Firebase project | Firestore database | Setup beyond today |
|---|---------|------------------------|------------------|--------------------|--------------------|
| P1 | **Website CMS** (like WordPress) | Admins, editors, site members with roles | Own project | `(default)` | None |
| P2 | **App framework**: a new app built on top of ArcCMS | Everyone, with roles | Own project | `(default)` | None |
| P3 | **Backend and admin for another app** that has its own database. ArcCMS manages that app's users, payments, drip emails, notifications | ArcCMS admins only. The host app's users never open the ArcCMS UI, but ArcCMS knows them by their Auth uid | **Shared** with the host app | Named, `arccms` | One configure command plus three resources (database, bucket, hosting site) |
| P4 | **Several ArcCMS instances** side by side (lower priority) | Per instance | One project per instance (supported now); one shared project (deferred, CO8) | `(default)` per project | None per project |

The rule that falls out of this table: **ArcCMS uses the `(default)` database
unless it shares a project with something else.** Sharing a project means a named
database, its own storage bucket and its own hosting site. P1, P2 and P4 (separate
projects) are the default install with nothing to configure.

---

## 1. Decision log

| # | Decision | Choice |
|---|----------|--------|
| CO-D1 | How ArcCMS data is isolated | **A named Firestore database, not prefixed collection names.** A prefix would touch about 490 collection references in about 157 files, dynamic names (`arc_{slug}`, `Tags_{slug}`, `WaitlistUserTags_{id}`), every rules `match`, every index and every trigger path, then force a copy of every document on existing installs because Firestore cannot rename collections. It would still leave ArcCMS and the host app sharing one rules file and one index file, which is the actual conflict. A named database has its own rules, its own indexes and its own triggers, and needs about a dozen code changes. Pricing of the extra database was accepted on 2026-09-23. |
| CO-D2 | Default database | The database id is install config. **Absent config means `(default)`**, which is exactly today's behaviour. Existing installs change nothing. |
| CO-D3 | Where install config lives | One optional file, **`arccms.config.json`**, at the repo root (untracked, like `environment.ts`). No file means every default below. `npm run arc:configure` reads it and writes the three places that need the values: `src/environments/arc-install.ts` (committed empty), `functions/.env`, and a generated, gitignored `firebase.arccms.json`. The committed `firebase.json` stays the P1 default so upstream updates never conflict with an install's choices. |
| CO-D4 | Functions deploy group | Every install moves to **`"codebase": "arccms"`**. Functions deployed without a codebase are labelled `default`, so a host app and ArcCMS both on `default` would each offer to delete the other's functions on deploy. A named codebase makes `firebase deploy --only functions:arccms` touch only ArcCMS. |
| CO-D5 | Function names | **Fixed prefix `arccms-`** for every function, produced by one grouped export (`export * as arccms from './all.js'`), so `sendTestEmail` deploys as `arccms-sendTestEmail`. Firebase joins groups with a hyphen; `arccms_` would mean renaming about 150 exports by hand for no gain. Fixed, not per install: a per-install prefix only matters for CO8. Secret and param names get the same prefix (`ARC_...`) so they never collide in Secret Manager. |
| CO-D6 | URLs already out in the world | **No legacy proxies** (decided 2026-09-23, reversing the first choice). An upgraded install loses the old URLs: open-tracking pixels and links in emails already sent, webhook URLs registered with Dodo and the email provider, and the `search` endpoint in static pages published before the upgrade. The upgrade runbook re-registers webhooks and republishes pages. A proxy codebase was built in CO4 and removed the same day as untested weight with no install that needs it. |
| CO-D7 | Roles and claims | ArcCMS reads its role from a **namespaced claim, `arccms_role`**, and writes it **merged** with existing claims. Today `setCustomUserClaims(uid, { role })` wipes every claim a host app set, and a host app's own `role: 'admin'` would grant ArcCMS admin. Transition: rules and functions accept `arccms_role` or the legacy `role` for one release on `(default)`; a backfill copies `role` to `arccms_role` for every user; the next release drops `role`. Named-database installs never accept the legacy claim. |
| CO-D8 | Security baseline first | CO1 closes the holes that a shared Auth pool makes worse, and ships to every install before anything else: role self-promotion, all-users read of `users`, and "any signed-in user may write" on content, tags and storage. In P3 every host-app user is a signed-in user of the same project. See section 2. |
| CO-D9 | Storage | Two settings: `storageBucket` (default: the project's default bucket) and `storagePrefix` (default: empty, today's paths). P3 uses **its own bucket**, because storage rules are one file per bucket and sharing the default bucket would mean merging rules with the host app. Existing files are never moved: media documents store full download URLs, which keep working. |
| CO-D10 | Hosting | `hostingSite` setting, default the project id (today). Replaces the five places that assume `GCLOUD_PROJECT` is the site id and the three that build `https://{projectId}.web.app`. P3 uses a second hosting site in the same project. |
| CO-D11 | The wildcard search trigger stays | `onDocumentWritten('{collection}/{docId}')` fires on every write in its database. Bound to the ArcCMS database it only sees ArcCMS writes, so it is safe in P3. ArcCMS on `(default)` next to a foreign app that also writes to `(default)` is **not a supported shape**; the configure script refuses it. |
| CO-D12 | P3 identity model | **Host users are an external audience, not ArcCMS users** (decided 2026-09-24, replacing the first design). They keep their data in the host app's own collection, which stays the only copy; ArcCMS reads it where it lives and never copies profiles. They get no ArcCMS `users` record and never sign in to the ArcCMS backend. ArcCMS stores only what is its own: consent, suppression, drip progress and the email log. Changes to fields marked "watch for changes" arrive as events, with no stored copy of their values. ArcCMS admins are ordinary accounts of the same sign-in pool. See section 5b. |
| CO-D13 | P3 app-user provisioning | **Superseded 2026-09-24.** The first design (an `ensureAppUser` callable and an "Import app users" action that created `users` records for host users) duplicated the host's data and made host users into ArcCMS users. It was built as CO6a and is removed in CO6.1. Replaced by the App audience (section 5b). **Never a blocking function** still holds: a project gets one `beforeUserCreated`, and the host app may already own it. |
| CO-D16 | Who owns an Auth account | **ArcCMS never creates or deletes a host app's login.** A `users` record carries `authOwner`: `arccms` (default when absent) or `host`/`shared`, and `onUserDeleted` deletes the Auth account only for `arccms`. With the App audience, host users have no `users` record at all; the guard stays for shared logins (someone who is an ArcCMS user and also uses the host app with the same account). |
| CO-D14 | Deploy commands | `npm run deploy:*` scripts wrap the Firebase CLI and pass `--config firebase.arccms.json` when that file exists, plus `--only functions:arccms`. Installs that deploy by hand with plain `firebase deploy` keep working in P1 and P2. |
| CO-D15 | Multiple instances | P4 is supported now as **one Firebase project per instance**, which needs zero work. One project with several instances (CO8) needs per-instance function names, claim keys and databases, and is deferred. |

### Explicit non-goals
Collection-name prefixes (permanent, CO-D1) · merging ArcCMS rules into a host app's
rules file · sharing the `(default)` database with a foreign app (CO-D11) · Auth
blocking functions (CO-D13) · multiple instances in one project (deferred, CO8) ·
framework extension points (separate spec).

---

## 2. Current state (what this builds on)

Findings from reading the code on `feat/field-keys-media-size`, 2026-09-23.

| Area | Today | Why it matters |
|------|-------|----------------|
| Firestore handle | `getFirestore()` with no database id in `app.config.ts`, `app.config.server.ts`, `functions/src/init.ts` | Three places to make configurable. Almost all other code goes through these handles. |
| Triggers | About 15 `onDocument*` triggers with string paths, including `onDocumentWritten('{collection}/{docId}')` in `search/onAnyDocumentWritten.ts` | Each needs `{ document, database }` options. A shared helper keeps it to one line each. |
| Rules | One `firestore.rules`, catch-all `match /{collection}/{docId}` at line 47 | Fine inside its own database. Deploying to a shared `(default)` would replace the host app's rules. |
| Storage rules | `match /{allPaths=**}`: public read, any signed-in user writes | Claims the whole bucket. In P3 any host-app user could upload or overwrite files. |
| Functions | About 83 export lines in `index.ts`, codebase `default`, flat names | CO-D4, CO-D5. |
| Hosting site | `siteId = process.env.GCLOUD_PROJECT` in `deployContentPage.ts`, `deployContentListPage.ts`, `deploySeoFile.ts`, `deployStaticPage.ts`, `deployToHosting.ts`; `https://${projectId}.web.app` in `shared/site-settings.ts` | CO-D10. |
| Claims | `onUserRoleChange` sets `{ role }` (replacing all claims) whenever `users/{docId}.role` changes | CO-D7, and see the next row. |
| **`users` rules** | `create: if isAuthenticated()`; `update` on your own doc blocks the premium fields but **not `role`**; `read: if isAuthenticated()` | **Security hole on every install today.** Any signed-in user (email/password sign-up is open) can create or edit a `users` doc with `role: 'admin'` and their own uid; `onUserRoleChange` then grants them the admin claim. Any signed-in user can also read every user's document. Found by reading the rules and the trigger; not reproduced against a live project. Fix in CO1, ideally as a hotfix before this spec is built. |
| Content writes | `ContentTypes`, `arc_*`, `Tags_*` writable by any signed-in user | Same class of problem, worse in P3. CO1. |
| Entitlement contract | `docs/dodo-payments-entitlement-contract.md` tells client apps to read `users/{docId}` in the same database | This is P3 already running on `(default)`. Existing client apps keep working because existing installs stay on `(default)` (CO-D2). New P3 installs point the client at the `arccms` database (section 6). |
| Media | Documents store `downloadURL`; uploads go to paths like `mediaImages/...` | A new `storagePrefix` only affects new uploads; old URLs keep working. |
| Open-tracking URL | `constant.TRACKING_PIXEL_URL`, set by hand to the function URL | Stays an opt-in setting; an upgraded install that set it must point it at `arccms-trackEmailOpen`. |

---

## 3. Configuration model

### 3.1 The file

```jsonc
// arccms.config.json: optional. Every key is optional. Shown with P3 values.
{
  "profile": "backend",              // "standalone" (P1, P2) | "backend" (P3). Default "standalone".
  "databaseId": "arccms",            // Default "(default)".
  "hostingSite": "acme-admin",       // Default: the project id.
  "storageBucket": "acme-arccms",    // Default: the project's default bucket.
  "storagePrefix": "",               // Default "". Only useful when sharing a bucket.
  "region": "us-central1"            // Default: the CLI default.
}
```

### 3.2 Who reads what

| Consumer | Source | Read when |
|----------|--------|-----------|
| Browser app and SSR | `src/environments/arc-install.ts`, a map keyed by project id, written by `arc:configure` (CO3.2) | Build time |
| Cloud Functions | `functions/.env` (committed default) and `functions/.env.<projectId>` keys `ARC_DATABASE_ID`, `ARC_HOSTING_SITE`. No storage keys: the functions never touch Storage. | Deploy time (trigger bindings, through the `ARC_DATABASE_ID` param) and run time |
| Firebase CLI | `firebase.<projectId>.json` (generated) or the committed `firebase.json` | Deploy time |
| Admin scripts in `scripts/` | `arccms.config.json` directly | Run time |

A single `arcConfig` module on each side (frontend, functions) is the only code that
reads these values. Everything else imports from it. Unit tests pin the defaults so a
missing file provably means today's behaviour.

### 3.3 What a fresh install does

**P1 and P2 (standalone):** exactly today's `INSTALL.md`. No config file. The
functions deploy uses the `arccms` codebase and `arccms-` names, which the installer
never notices.

**P3 (backend for an existing app in the same project):**

```
firebase firestore:databases:create arccms --location=<same as the host app>
firebase hosting:sites:create <project>-arccms
gcloud storage buckets create gs://<project>-arccms --location=<same>
npm run arc:configure -- --profile=backend
npm run deploy
```

`arc:configure` can run the three create commands itself when asked, validates that
the database, site and bucket exist, refuses a `backend` profile on `(default)`
(CO-D11), and prints the snippet the host app needs (section 6).

### 3.4 Generated Firebase config for P3

```json
{
  "firestore": [{ "database": "arccms", "rules": "firestore.rules", "indexes": "firestore.indexes.json" }],
  "storage":   [{ "bucket": "acme-arccms", "rules": "storage.rules" }],
  "hosting":   { "site": "acme-admin", "...": "same as firebase.json" },
  "functions": [{ "source": "functions", "codebase": "arccms", "...": "same as firebase.json" }]
}
```

---

## 4. Backward compatibility

**Principle:** an install that pulls this release and changes nothing keeps the same
database, bucket, paths, hosting site and data. The only change it cannot avoid is
the function rename (CO-D4, CO-D5), handled by a one-time upgrade with a runbook.

| Area | Existing install after upgrade | Action needed |
|------|--------------------------------|---------------|
| Firestore data, rules, indexes | Unchanged, still `(default)` | None |
| Storage files and URLs | Unchanged | None |
| Hosting site and published pages | Unchanged | Republish pages so their search box calls `arccms-search` |
| Client apps reading `users` (entitlement contract) | Unchanged, still `(default)` | None |
| Admin claims | `role` still accepted for one release; backfill adds `arccms_role` | Run the backfill callable once (runbook) |
| Function names and codebase | Renamed to `arccms-*` in codebase `arccms` | **Upgrade runbook** |
| Webhook URLs (Dodo, email provider) | Old URLs stop working | Re-register `arccms-dodoWebhook` and `arccms-handleEmailWebhook` in the provider dashboards during the upgrade |
| Emails already sent (pixel, unsubscribe) | Unsubscribe and preference links go to the hosting site and keep working; a configured tracking pixel stops counting opens for old emails | None |

### 4.1 Upgrade runbook (outline; full text in `docs/coexistence-upgrade-runbook.md`, CO7)

The rename cannot be done in place. Deploying the new codebase first would leave old
and new triggers both running (duplicate welcome emails, duplicate drip steps).
Deleting first leaves a gap. The gap is the lesser harm, so:

1. Pick a quiet time. `npm run arc:upgrade -- --dry-run` lists the old functions it will delete and the new ones it will deploy.
2. `npm run arc:upgrade` deletes the old ArcCMS functions and deploys `arccms`. Hosting is deployed straight after, by hand, so the SPA calls the new callable names. Expected gap: a few minutes, during which Firestore trigger events are lost and scheduled jobs skip a tick.
3. The script prints a checklist: re-register webhooks (optional), republish pages (optional), verify one test email and one test checkout.

Existing installs stay on `(default)`, including those that already share it with a
client app (decided 2026-09-23). No migration is planned. If one ever has to move, the
path is a managed export and
import (`gcloud firestore export`, then `import --database=arccms`), plus updating
any client apps to the new database id. Not automated.

---

## 5. Phases

| Phase | Deliverable | Ships to | Notes |
|-------|-------------|----------|-------|
| **CO1** Security baseline | `users`: create only your own doc with no `role` field, update cannot touch `role`, read only your own doc or as admin. Role-gated writes on `ContentTypes`, `arc_*`, `Tags_*` and storage (admin or editor, from the claim). `onUserRoleChange` merges claims and writes `arccms_role` alongside `role`. Backfill callable. Rules and functions accept either claim. Rules unit tests for each case. | Every install | Independent of the rest; can ship as a hotfix first. |
| **CO2** Config plumbing | `arccms.config.json` schema, `arcConfig` modules, `environment.arc`, `functions/.env` keys, the three Firestore handles, hosting site and storage bucket/prefix read from config everywhere listed in section 2. | Every install | No behaviour change at defaults; tests prove it. |
| **CO3** Named database | Trigger helper (`arcDocument('Waitlists/{id}')` returns `{ document, database }`), all triggers migrated, `arc:configure`, generated `firebase.arccms.json`, deploy scripts. | Every install | Test: default config generates a Firebase config equal to the committed `firebase.json`. |
| **CO4** Function codebase and names | `codebase: arccms`, grouped `arccms-` export, one frontend `callArc(name)` helper for about 37 callable sites, `search` widget URL and tracking-pixel URL derived from config, `ARC_` secret names, `arc:upgrade` script. | Every install | The one breaking change; see section 4.1. |
| **CO5** Storage and hosting isolation | Bucket target support, rules scoped to `storagePrefix` when set, second-site hosting verified end to end (publish a page in P3 and fetch it). | P3 | |
| **CO6** App audience | Host users as a live, read-only external audience (section 5b), phases CO6.1 to CO6.7. Every admin module stays available in every profile. | P3 | |
| **CO7** Docs | `INSTALL.md` per profile, `docs/coexistence-guide.md`, `docs/coexistence-upgrade-runbook.md`. | Everyone | |
| **CO8** (deferred) Many instances in one project | Per-instance function group name (generated entry file), per-instance claim key, per-instance database, bucket and site. | P4 in one project | Only if separate projects prove insufficient. |

**CO2 as built (2026-09-23).** Frontend: `src/app/core/config/arc-config.ts` (reads
`src/environments/arc-install.ts` since CO3; CO2 first read an `environment.arc` block, `withStoragePrefix()`) and `arc-firebase.ts` (the Firestore and Storage
factories used by `app.config.ts` and `app.config.server.ts`; with defaults they are exactly
`getFirestore()` and `getStorage()`). New upload paths go through `withStoragePrefix()` in
`file-upload.service.ts` and `import-files.service.ts`. Functions: `functions/src/arc-config.ts`
(`arcDatabaseId`, `arcHostingSite`, `arcHostingOrigin`, all read at call time); `init.ts` opens the
configured database; the five analytics callables use `db` from `init.ts` instead of their own
`getFirestore()`; every hosting-site and `.web.app` reference goes through `arcHostingSite` /
`arcHostingOrigin`. The `search` widget keeps `GCLOUD_PROJECT`, because it builds a Cloud Functions
URL, not a hosting one. Scripts: `scripts/arc-install-config.mjs` reads `arccms.config.json`;
`purge-email-testing-doc.mjs` uses it and takes `--database=`. `arccms.config.example.json` added,
`arccms.config.json` gitignored. Guard tests fail if code outside the config modules calls
`getFirestore()` / `getStorage()` or derives the hosting site from the project id. (Before CO3,
setting a non-default database would have split reads from triggers; CO3 closes that.)

**CO3 as built (2026-09-23).** `arcDocument(path)` in `functions/src/arc-config.ts` returns
`{ document, database: arcDatabaseParam }`, where `arcDatabaseParam` is
`defineString('ARC_DATABASE_ID', { default: '(default)' })`; all 29 `onDocument*` triggers use it
(a guard test fails on any raw path). It must be a param: the first version read `process.env`,
which is empty when the Firebase CLI loads the code to deploy it (`functions/.env` is only
applied to params at that point and to `process.env` at run time), so every trigger deployed on
`(default)` while callables, reading `process.env` at run time, wrote to `arccms`. Found on the
dev project the same day by onboarding into an empty `arccms` database: the admin was created
but no contact, list or `email_lookup` entry appeared. Verified after the fix with
`firebase functions:list --json`: 29 ArcCMS Firestore triggers on `arccms`. With no config the database is `(default)`, Firebase's own default, so default installs
deploy identical triggers. `scripts/arc-configure.mjs` (`npm run arc:configure`) takes
`--profile --database --site --bucket --prefix --region --dry-run`, validates (a backend
profile needs a named database, its own site and its own bucket), writes the three outputs,
removes `firebase.arccms.json` when the config returns to defaults, keeps unrelated
`functions/.env` lines, and prints the create commands without running them.
`scripts/arc-deploy.mjs` (`npm run deploy`) is `firebase deploy` plus `--config
firebase.arccms.json` when that file exists; `deploy:dev`, `deploy:prod` and the functions
`deploy` script go through it, and `export-indexes` reads the configured database.

Findings during CO3:
- **The Firebase CLI creates a named database listed in the config on deploy, even with
  `--dry-run`** (CLI 15.24). A validation dry run on 2026-09-23 created an empty `arccms`
  database (nam5) on the dev project `xlm-project-864ff`. Creating it with
  `firestore:databases:create` first is how an install picks the location.
- `deploy:dev` and `deploy:prod` pass `--force`, which deletes functions missing from the
  source without asking. Harmless on a project ArcCMS owns; on a shared project it would
  delete the host app's functions. CO4's `arccms` codebase is what makes it safe; until then
  a backend install must not use those two scripts.
- **A param needs a value in a dotenv file for non-interactive deploys, default or not.**
  `firebase deploy --non-interactive` stopped with "no value for ARC_DATABASE_ID" on a
  checkout without `functions/.env`, though the param defaults to `(default)`. That would
  have broken every standalone install deploying from CI or `deploy:dev`/`deploy:prod`. So
  `functions/.env` is now committed with `ARC_DATABASE_ID=(default)` (it holds no secrets),
  and `arc:configure` always writes the key. The CLI's "error retrieving the Firestore
  database ... {{ params.ARC_DATABASE_ID }}" lines during a deploy are noise: it looks the
  database up before resolving the param.
- **Recreating a database orphans its triggers.** After the `arccms` database was deleted and
  created again under the same id, the triggers bound to it (by name, per `functions:list`)
  stopped receiving events, and a plain redeploy (an in-place update with the same filters) did
  not bring them back. Deleting the trigger function and deploying it again did, verified with
  `onWaitlistsCreate` on 2026-09-23. Runbook rule: whenever an install's database is recreated,
  or its triggers move to another database, delete and redeploy the Firestore triggers rather
  than updating them. `arc:upgrade` (CO4) should do this for the trigger subset.
- Triggers for a named database fire from the database's region (asia-south1 on the dev
  project) even when the function runs in us-central1; the CLI warns about the cross-region hop.
  Pinning trigger regions to the database location is a later cleanup.
- The dev project `xlm-project-864ff` already hosts another app's functions in a separate
  codebase (`functions`: 32 Firestore triggers on `(default)`, including `onUserCreate` /
  `onUserDelete` on `users/{userId}`). ArcCMS deploys left them untouched, which is the P3 shape
  this spec targets, and the shared `users` name shows why ArcCMS needs its own database.
- Fresh-install findings from the same test, fixed on this branch: the admin nav and the
  paginator showed raw translation keys after onboarding, because they translate in code and
  only refreshed on a language change, not when the translation file finished loading (the
  wizard loads no admin strings, so the admin rendered first). Both now also refresh on
  Transloco's `translationLoadSuccess`, with regression tests.

**CO3.1: new-install fixes (2026-09-23).** Found by onboarding into an empty `arccms`
database on the dev project; they are not coexistence-specific and apply to every new install.

| # | Problem | Fix |
|---|---------|-----|
| 1 | An unfinished wizard locked the site: every visitor, and `/signup` where the admin signs in, was sent to the wizard, which has no sign-in form. A signed-out admin saw "permissions have not finished propagating" forever. | `onboarding_status` records `startedBy`. `shouldShowOnboarding()` sends everyone to the wizard only on a first run; while it is in progress only its owner goes back (a flag without `startedBy` falls back to any signed-in user). The wizard shows signed-out visitors "Finish setting up" with a sign-in link, sends other users to `/`, and `ensureAdminClaim()` reports a missing session as such. |
| 2 | "Skip & Go to Dashboard" (offered after step 5 fails) created no content type and no waitlist. | It now tries each default independently before marking setup complete. |
| 3 | Unsubscribe and preference links were empty on every new install: nothing generated `unsubscribeSecret`. | `getUnsubscribeSecret()` creates one on first use in `_system/unsubscribe_secret` (closed to clients), once, in a transaction. Not in `Settings/email`, which the admin UI and the wizard save whole. A secret configured by hand in `Settings/email` still wins, so links already sent keep working. |
| 4 | No welcome email for a new site's first users: no template existed until the Announcements page seeded them. | `onUserCreateWelcomeEmail` runs the idempotent `ensureDefaultTemplates()` when the template is missing. |
| 5 | The admin page header squeezed its title to one word per line and pushed actions out of view when a page had several actions (Contacts at about 1000px). | The header wraps; the title keeps 280px and the actions take their own row when both cannot fit. |
| 6 | A fresh install had two default signup forms: onboarding created `Waitlists/default`, while the bundled landing pages posted to `get-early-access-to-arc-cms`, which `ensureWaitlistExists` created on first view. Signups went to the second; the first sat unused. | One shared default form id, `waitlist-form` (`src/shared/constants/waitlist-form.ts`, mirrored in `functions/src/waitlists/defaultForm.ts`), used by onboarding, both landing templates and the form service. For installs that predate it, a page asking for `waitlist-form` where none exists is pointed at the first existing legacy default (`get-early-access-to-arc-cms`, then `default`), so live sites keep collecting into the form that already holds their signups. |

Open from the same test: every new contact defaults to `consent: subscribed`, including users
who never opted in (the backfilled admin showed as subscribed). Changing the default is a
product and legal decision, left to the owner.

**CO4 as built (2026-09-23), not yet deployed.** `functions/src/index.ts` is now one line,
`export * as arccms from './all.js'`; the old export list lives in `all.ts`, and all 104
functions deploy as `arccms-<name>`. `firebase.json` uses codebase `arccms`.
`functions/src/function-names.ts` and `src/app/core/config/arc-functions.ts` hold the group
name; every frontend callable goes through `arcCallable(functions, name)` (24 files; a guard
test fails on any direct `httpsCallable`). The static-page search widget calls
`arccms-search`. The payments settings hint names `arccms-dodoWebhook`.
`functions/scripts/check-callable-access.sh` probes the prefixed names.

`npm run arc:upgrade -- --project=<alias> [--dry-run]` builds the functions, reads the
ArcCMS function names from the build, and deletes only deployed functions with those names
that are not already in the `arccms` codebase (another app's functions are never
candidates), then deploys `arccms`. It does not deploy hosting: the previous frontend calls
the old callable names, which stop existing, so hosting must be deployed straight after.
Dry run against the dev project listed exactly the 104 ArcCMS functions and none of the
other app's 32. The legacy proxy codebase first built here was removed (CO-D6).

**CO4 deployed next to the old install (2026-09-23).** The dev project `xlm-project-864ff`
now runs two ArcCMS installs side by side, which is the P3 shape with the old install as the
"host app": codebase `default` (104 functions, old names, triggers on `(default)`, restored
from `020227f`) and codebase `arccms` (104 `arccms-*` functions, triggers on the `arccms`
database), plus another app's `functions` (44) and `ssr` (1) codebases. No upgrade was run.
The `arccms` setting comes from `functions/.env.xlm-project-864ff`, which the CLI loads after
`.env`. Verified: a public waitlist signup through `arccms-joinForm` and
`arccms-finalizeFormSignup`, search through `arccms-search`, all 36 probed callables reachable.

Findings:
- **A callable whose creation times out is left without public access.** Six creations
  ended in "Deadline Exceeded" while the CLI polled Cloud Run; redeploying them succeeded
  but, as updates, did not grant `allUsers` the invoker role, so browsers got a 403
  (`finalizeFormSignup` among them, which breaks every public signup). Deleting and
  deploying them again fixed it. `functions/scripts/check-callable-access.sh` now covers the
  public callables and prints `arccms-` service names; run it after any functions deploy.
- `--only` for a grouped function in a named codebase is
  `functions:<codebase>:<group>.<name>`, for example `functions:arccms:arccms.joinForm`.
  `functions:arccms-joinForm` and `functions:arccms.joinForm` match nothing.
- The first public signup on a freshly deployed install takes about 40 seconds (cold
  `joinForm`, `requestFormOtp`, `finalizeFormSignup` in sequence).

Not in CO4 as built: the namespaced `arccms_role` claim (CO-D7) was not part of CO1 as built
either and is still open; the tracking pixel URL stays an opt-in setting.

**CO3.2: install config per Firebase project (2026-09-23).** One checkout deploys to several
projects (dev, production, a test project), and the CO3 config could describe only one, so
switching meant editing files by hand. Now:

| Piece | Where each project's settings live |
|-------|-------------------------------------|
| `arccms.config.json` | Top-level keys are shared; `projects.<projectId>` overrides them. A pre-CO3.2 file (top-level keys only) still applies to every project. |
| Frontend | `src/environments/arc-install.ts` is a committed map keyed by project id (`{}` means all defaults); `arcConfig` uses the entry for `environment.firebaseConfig.projectId` (`installConfigFor`, which still reads a pre-CO3.2 single-entry file). |
| Functions | `functions/.env` is committed with `ARC_DATABASE_ID=(default)`; `arc:configure` writes `functions/.env.<projectId>`, which the Firebase CLI loads after it. |
| Firebase CLI | `firebase.<projectId>.json` (gitignored, `firebase.*.json`), generated only for a project that needs one. |

`arc:configure -- --project=<alias or id>` resolves `.firebaserc` aliases (no flag means the
`default` alias, as with the CLI) and changes only that project. `npm run deploy` finds the
project in `--project`/`-P`, adds that project's generated config, and after any deploy that
includes functions runs `functions/scripts/check-callable-access.sh` against it, failing the
deploy if a callable is blocked (`--no-probe` skips it). `export-indexes` and the purge script
read the database per project. This checkout's own dev project, `xlm-project-864ff`, is
configured through it: `projects.xlm-project-864ff.databaseId = arccms`.

**CO5 as built, first part (2026-09-23): hosting off, and an upload folder.**
- `ARC_HOSTING_SITE=none` (`arc:configure --site=none`) turns publishing to Firebase Hosting
  off. `arcHostingSite()` returns '' and every Hosting path treats that as "do not touch
  Hosting": `deployBatchToHosting` records `deployStatus: 'skipped'` (code `HOSTING_OFF`) on
  the content and releases nothing; removals, static-page generation, SEO files and the
  template fetch from the site are skipped; the site-settings readers already skipped an
  empty site. The editor treats `skipped` as final and shows "Website publishing off" with an
  info toast. The generated Firebase config gets no `hosting.site`.
- Why it was needed: an install without its own site defaults to the project's main site.
  On `xlm-project-864ff` that is the old install's site, so the new install's publishes
  would have released pages into it.
- Found on the way: `deployBatchToHosting` records failures instead of throwing, so the
  publish queue pinged IndexNow even when a release failed. It now returns whether it
  released, and the queue pings only then.
- `xlm-project-864ff` is configured with `hostingSite: none` and `storagePrefix: arccms/`,
  so the new install's media land under `arccms/` in the shared default bucket. Content is
  tested on localhost, where the app renders pages itself when no static file exists.
- Known exception: member avatars stay at `avatars/{uid}/` in the bucket root, where the
  Storage rule lets each user write their own; prefixing them would need a rules change.
  File names are per user and timestamped, so the two installs cannot overwrite each other.

**CO6a as built (2026-09-23), superseded 2026-09-24 and removed in CO6.1: app users.** `functions/src/users/appUsers.ts`:
- `arccms-ensureAppUser` (callable, as the signed-in user): identity from the verified
  token only; creates the `users` doc in a transaction (no duplicates on concurrent first
  sign-in) with `role: 'user'`, `authOwner: 'host'`, `source: 'app'`; on later calls
  refreshes email, verification, language and `lastSeenAt`, never role or `authOwner`, and
  keeps an existing name. Optional `name`, `language`, `attributes` (written as contact
  fields, only for keys defined in Audience, Fields). Returns the entitlement: `isPro`,
  `premiumType`, `premiumStatus`, `premiumExpiresAt`, `creditBalance`.
- `arccms-importAppUsers` (callable, admin): pages through Firebase Auth; each account with an
  email and no `users` doc gets one (`authOwner: 'host'`, `source: 'import'`, `importedAt`,
  `sendWelcome`); `dryRun` counts only; one summary admin notice per run.
- Triggers: `onUserDeleted` deletes the Auth account only when `authOwner` is not `host`;
  `onUserCreated` emits `user.imported` (not `user.signed_up`) and no per-person admin notice
  for imported users; `onUserCreateWelcomeEmail` skips `sendWelcome: false`;
  `onUserRoleChange` writes no claim for a host-owned user with an ordinary role (it would
  replace the host app's own `role` claim; CO6b namespaces the claim).
- Rules: clients can neither create nor change `authOwner`, `importedAt`, `sendWelcome`.
- Admin UI: Users, "Import app users" opens a dialog that dry-runs first, shows the counts,
  and offers "Send the welcome email to N imported users", off by default.

Order: CO1 → CO2 → CO3 → CO4 → CO5 → CO6 → CO7. CO1 to CO3 change nothing for an
existing install. CO4 is the release that needs the runbook.

---

## 5b. CO6 design: the App audience (decided 2026-09-24, not built)

**The idea.** In the backend profile (P3), the host app's users are an audience ArcCMS
can email, segment and run drips for, while their data stays in the host's collection.
ArcCMS reads that collection live and reacts to changes in it instantly.

### Configuration

Two layers, because a trigger's path is fixed when functions are deployed:

| Set with | What | Why there |
|----------|------|-----------|
| `arc:configure --app-users-database=<db> --app-users-path=<collection>/{id}` (written to `functions/.env.<projectId>` as `ARC_APP_USERS_DATABASE`, `ARC_APP_USERS_PATH`) | Which database and collection hold the host's users | The trigger that watches them is bound at deploy time (like `ARC_DATABASE_ID`). Changing it means configure plus a functions deploy. Unset: the trigger points at a path nothing writes to, so installs without a host app pay nothing. |
| Admin, **Settings, App audience** (stored in `Settings/app_audience`, admin only) | How to read a document: the unique key, contact channels, name, fields to watch | Read at run time, so it can change without a deploy. |

The Settings page shows the database and collection (read only, from the deploy) and asks:

1. **Unique key**, always asked, never assumed: the document id, or a field path
   (a login uid, a phone number, an email, a customer id). ArcCMS keys everything it
   stores about a person by this value (hashed).
2. **Email field** (optional): needed to email someone. People without one are listed
   but cannot be emailed.
3. **Phone field** (optional): shown and available as a merge tag; no SMS in CO6.
4. **Name field** (optional).
5. **Fields to watch for changes** (optional): for example `subscription.tier`. Only
   these fields' last values are stored, so a change can start an email or drip
   ("upgraded to paid").
6. **Field preview**: ArcCMS samples about 20 documents and lists every field path with
   example values, so the admin picks from a list. A **Test** button reads one real
   document and shows how it was understood.

Every field of a host document is available to emails as `##APP.<path>##` (for example
`##APP.subscription.tier##`) and to segment conditions, without mapping.

### What ArcCMS stores (its own state only)

`AppAudience/{keyHash}` in the ArcCMS database, created only once ArcCMS has something of
its own to remember:
- marketing consent (`subscribed` by default, per the 2026-09-23 decision; unsubscribes
  recorded here and in `Suppression`),
- drip enrollment and progress,
- a `deleted` marker kept for suppression after the host deletes them.

(Decided 2026-09-24: no copy of the watched fields' values and no `lastSeenAt`. The trigger
has the document before and after each write, so neither is needed.)

Nothing else: no name, email, phone or other profile field. Email addresses are read from
the host document at send time; suppression is by email hash, as today.

### Reacting to changes

`onAppUserWritten`: a Firestore trigger on `ARC_APP_USERS_PATH` in `ARC_APP_USERS_DATABASE`.
- **Created** → `app_user.created`, so event mappings can start a welcome email. Documents
  that existed before the trigger was deployed produce nothing.
- **Updated** → one event per watched field that changed, named for the field:
  `app_user.changed.<field>` with `field`, `from` and `to` (for example
  `app_user.changed.isPro`, `false → true`). The unique key field counts as watched; when
  it changes, the person's `AppAudience` record moves to the new key (unless the new key
  has one already). Other writes (usage counters ticking) return at once.
- **Deleted** → `app_user.deleted`; the `AppAudience` record is marked `deleted` and keeps
  its consent, so a returning address is not mailed against a past unsubscribe.

Event ids come from the Firestore event (`<eventId>.<suffix>`), so a delivery Firestore
repeats stores one event and sends one email.

**Rules in event mappings** (decided 2026-09-24). A mapping in `Settings/event_mappings`
can hold `rules`: several sets of actions for one event, each with an optional `when` on
the old and new value (`equals`, `anyOf`, `noneOf`; values compare as text, and empty,
null and missing are all `''`). Upgrade and downgrade emails on one field:

```json
"app_user.changed.isPro": { "enabled": true, "rules": [
  { "name": "Upgraded",   "when": { "to": { "equals": true } },
    "sendEmail": { "templateType": "app_user_upgraded", "category": "transactional" } },
  { "name": "Downgraded", "when": { "to": { "equals": false } },
    "sendEmail": { "templateType": "app_user_downgraded", "category": "transactional" } }
] }
```

For app-user events the bus reads marketing consent from `AppAudience`, and skips list
actions (`lists: not_applicable`): adding an app user to a list would copy them into
Contacts. Templates can use `##NAME##`, `##EMAIL##`, `##FIELD##`, `##FROM##`, `##TO##`
until CO6.5 adds `##APP.<path>##`.

### Where app users appear

- **Audience, App users**: a read-only table served live from the host collection by a
  callable (search by the unique key, email or name; a few hundred rows, so no special
  indexes). Each row shows the host fields and ArcCMS's own state (consent, drips).
- **Audience, Lists**: a new list type, **App users (live)**, defined by conditions on host
  fields ("subscription.tier is paid", "projects > 10"). Resolved at send time by reading
  the host collection, with ArcCMS consent and suppression applied. Broadcasts and drips
  target it like any list.
- **Users** stays ArcCMS logins only.

### Admin-only sign-in

Chosen with the profile (`arc:configure --profile=backend` asks for it). It sets
`Settings/users.adminOnlySignIn`: the sign-in page hides sign-up, the rules refuse
self-created `users` records (checked with `get()` on that setting), and signing in
requires an existing ArcCMS user record added by an admin. Needed because the sign-in pool
is shared: a host user's password is valid on the ArcCMS sign-in page too.

### Built so far

- **CO6.1** (360954d): CO6a removed; the `authOwner` guard kept in `functions/src/users/authOwner.ts`
  (`arccms`, `host`, `shared`; only `arccms` logins are ever deleted; clients cannot set it).
- **CO6.2**: params `ARC_APP_USERS_DATABASE`, `ARC_APP_USERS_PATH` (`functions/src/app-audience/config.ts`,
  defaults in the committed `functions/.env`); `arc:configure --app-users-database --app-users-path`
  (validated: `<collection>/{id}` only, and never ArcCMS's own `users` in its own database);
  `firestoreFor(databaseId)` in `init.ts` for reading another database; admin callables
  `arccms-appAudienceStatus`, `arccms-sampleAppUsers`, `arccms-testAppUser`
  (`functions/src/app-audience/adminCallables.ts`); Settings, App audience page
  (`/admin/settings/app-audience`) saving `Settings/app_audience`.
- **CO6.3** (8fbe8f2): admin callables `arccms-listAppUsers` (the whole host collection, capped at
  2000 documents and flagged `truncated`; people with an empty key are counted, not listed) and
  `arccms-getAppUser` (one document's flattened fields) in `functions/src/app-audience/listAppUsers.ts`.
  Channel values from credential-like fields are hidden by `maskResolvedAppUser` in `fields.ts`,
  shared with `testAppUser`. ArcCMS's own state is `AppAudience/{sha256(key)}`
  (`functions/src/app-audience/state.ts`); no record means `subscribed`. Page Audience, App users
  (`/admin/app-users`, explicit route) filters in the browser and opens a detail drawer.
- **CO6.4**: `arccms-onAppUserWritten` (`functions/src/app-audience/onAppUserWritten.ts`,
  planning in the pure `planAppUserWrite`); rules and conditions in
  `functions/src/email-core/eventRules.ts`, run by `onAppEventCreate`; `emitAppEvent(type,
  payload, { id })` for stable ids; `appUserId` on app-user events. The App user drawer shows
  the person's last 10 events and what the bus did with each. The arc-config guard exempts
  this one trigger by name and checks it binds through the host params. Tested on xlm
  2026-09-24: `isPro` false → true ran only the Upgraded rule, true → false only Downgraded.
- **CO6.5a**: `##APP.<path>##` and `##APP.<path>|fallback##` resolve at send time from
  `appFields` on the email log (`mail-config/mailConfig.ts`). `queueEmail({ appUser: { id,
  fields } })` stamps `appUserId` on every log (skipped ones too) and `appFields` on pending
  ones; `app-audience/mergeFields.ts` reads the host document and leaves credential-like
  fields out entirely. Unsubscribe and the preference center go through
  `email-core/recipientConsent.ts`: a change reaches each app user the address was mailed as
  (found by `appUserId` on its logs) and the contact only if one exists or no app user is
  involved, so unsubscribing never creates a contact; the preference center shows the
  contact's consent, else the app user's.

### Phases

| Phase | Deliverable |
|-------|-------------|
| CO6.1 | Remove CO6a's `ensureAppUser`, `importAppUsers`, the import dialog, `importedAt`, `sendWelcome` and `user.imported`. Keep the `authOwner` guard. |
| CO6.2 | `arc:configure` app-users flags and params; Settings, App audience (unique key, channels, name, watched fields, preview, test); callables that list databases, collections and sample fields. |
| CO6.3 | Audience, App users: live table and search. |
| CO6.4 | `onAppUserWritten` and the `AppAudience` state; the three events on the event bus. |
| CO6.5 | Emails, in four parts. **a**: `##APP.*##` merge tags; unsubscribe and consent for app users. **b**: the App users (live) list type with conditions on host fields, targeted by broadcasts. **c**: drips for app users. **d**: an editor for event-mapping rules. |
| CO6.6 | Admin-only sign-in with the profile. |
| CO6.7 | `docs/app-audience-integration.md`: step-by-step integration guide written for an AI agent (and people), from a host app's collection to its first email. |

## 6. P3 in practice: what the host app sees

- **Its own stuff is untouched.** Its `(default)` database, rules, indexes, bucket,
  hosting site and `default`-codebase functions are never deployed by ArcCMS. ArcCMS
  *reads* one collection, the host's users, and never writes to it.
- **Its users** stay in its own collection and its own sign-in. ArcCMS reads them live
  (section 5b); nothing about them is copied, and they cannot sign in to the ArcCMS
  backend.
- **Payments** stay in the host app. Its payment fields are ordinary fields to ArcCMS,
  usable in emails and segments.
- **No integration code** is needed in the host app: ArcCMS picks up new, changed and
  deleted users by itself.
- **Admins** sign in to the ArcCMS admin with accounts an ArcCMS admin added; with
  "admin-only sign-in" (section 5b) nobody else can.

---

## 7. Risks

| Risk | Mitigation |
|------|------------|
| The upgrade gap loses trigger events (a sign-up during the gap gets no welcome email) | Quiet-time window, dry run, short gap; the runbook lists which triggers matter. |
| An install upgrades by running plain `firebase deploy` without the runbook | Old `default`-codebase functions stay deployed alongside the new ones and triggers double-fire. `arccms-*` functions check at cold start for old names and log a loud error; the release notes and `INSTALL.md` lead with the runbook. |
| Host app replaces all claims and wipes `arccms_role` | Documented; ArcCMS admins sign in again after a fix. ArcCMS cannot prevent it. |
| Named database pricing | Accepted 2026-09-23. |
| Forgotten `getFirestore()` call without the id (new code) | Lint rule or test that greps for bare `getFirestore(` outside `arcConfig`. |

---

## 8. Questions

### Decided 2026-09-23
1. **Separator:** `arccms-`, from the grouped export (CO-D5).
2. **Legacy proxies:** none (CO-D6, reversed 2026-09-23).
4. **P1 vs P2:** no infrastructure difference. Both are the standalone profile.
5. **Module toggles:** nothing is hidden in any profile. A P3 install is a full ArcCMS and can also run the marketing website.
6. **Existing installs that share `(default)` with a client app:** left as they are. No migration planned.

3. **App-user provisioning in P3:** `arccms-ensureAppUser` callable plus the admin import action (CO-D13). ArcCMS never creates Auth accounts for app users (CO-D16).
