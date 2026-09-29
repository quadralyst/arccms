# Arc CMS Features: Build Spec

**Status:** spec, not built. Decisions agreed with Gunjan on 2026-09-29.
**Branch:** `feat/feature-flags`, cut from `dev` (4741339, which includes `feat/coexistence`).
**Scope:** an app built on Arc CMS chooses which Arc CMS features it has. A feature
that is off has no menu item, no page, no settings tab, no widget, no Firestore
listener and no Cloud Function. An app that chooses nothing gets every feature,
exactly as today. The same branch reworks what search indexes: content by default,
plus only the collections the developer lists, with fields chosen in Search settings,
and no search function ever started by a write to any other collection.

**Out of scope:** a switch in the admin UI (F-D1), switching parts of a feature (for
example Broadcasts on and Drips off), removing a feature's security rules or indexes
(F-D7), deleting a feature's data, and splitting the translation files per feature.

---

## 1. Decision log

| # | Decision | Choice |
|---|----------|--------|
| F-D1 | Who chooses | **The developer, at build time.** One file in the custom space. A runtime switch could only hide things; it could not keep code and functions out. No admin toggle. |
| F-D2 | What can be switched | **Ten features** (section 2). Everything else is core and always on, including users, the media manager, multilingual, feedback, notifications and Google Analytics. |
| F-D3 | Functions of a feature that is off | **Not exported, so the next full functions deploy deletes them.** This stops scheduled jobs and triggers costing money and closes their endpoints. |
| F-D4 | Content | **Switchable.** A pure product app can have no CMS pages at all. Search can stay on for the app's own sources, with nothing of content to index. |
| F-D5 | Where the choice lives | `src/custom/features.ts`, a new custom starter file that ships empty. **Empty means every feature on except the PWA**, so every existing app pulls this change with nothing to do. The app lists what it does not want, `off: ['payments', 'sms']`, and the off-by-default features it does want, `on: ['pwa']`. No presets. |
| F-D6 | Dependencies | Two only: `forms` and `email-marketing` need `audience`. Turning off `audience` while either is on **stops the build** with a message naming both, rather than guessing which one you meant. |
| F-D7 | Rules, indexes, data | **Untouched.** Rules and indexes for every feature stay deployed (harmless for empty collections). Turning a feature off hides its data; turning it back on shows it again. |
| F-D8 | Shared code | A feature that is off loses its **entry points** (functions, routes, menu, tabs, widgets, listeners), not every file. Where core code calls into a feature (for example the email sender checking a contact's consent), the call checks the feature first (section 5.3). |
| F-D9 | PWA | **Switched in the features file**, like everything else (decided 2026-09-29): it is the one feature that is off by default, turned on with `on: ['pwa']`. `src/custom/pwa.ts` keeps only the name, colours, start page and icon. An app whose `pwa.ts` still has `enabled` gets a build error saying where the switch went, so nobody's PWA changes state silently on update. |
| F-D10 | Functions build | The functions cannot import from `src/`. A small generator writes a **gitignored** `functions/src/features.gen.ts` from the custom file before every functions build, test run and deploy. Gitignored, so no app ever has a merge conflict on it. |
| F-D11 | What search indexes | **Only content, by default.** Core ships two sources, published content and content drafts, both on with `content`. Anything else (products, an app's own data, admin data) is indexed only when the developer lists its collection (F-D12). |
| F-D12 | How a collection becomes searchable | **Split** (option C, decided 2026-09-29). *Which collections* is a build-time choice, because a trigger has to exist per collection: one line each in `functions/src/custom/search-sources.ts`. *Which fields, what a result shows and who may search it* is a runtime choice in Search settings, applied with Rebuild and no deploy, the way content types already choose their searchable fields. |
| F-D13 | Never index high-volume data | Logs, events, queues, notifications and the index itself are refused. A test fails if any source, core or app, watches one of them (section 6.3). |
| F-D14 | Search is a feature | **Switchable, on by default** (decided 2026-09-29). Off removes every search function, so no write in the database starts a search function. It needs nothing and nothing needs it: the content editor's link suggestions and the related items on content pages hide without it. |
| F-D15 | Search triggers | **Only on named paths. The every-write trigger is removed** (decided 2026-09-29). Each listed collection gets its own trigger; content drafts, whose collections are created at runtime, are indexed through a fixed queue collection written in the same batch as the draft (section 6.5); published content is indexed by the publish queue as today. No write to any other collection ever starts a search function. |

---

## 2. The features

| id | What disappears when it is off | Needs |
|----|-------------------------------|-------|
| `content` | Content menu (content types, entries, authors, tags), public content pages, static pages (`/p/...`), the publish queue, the two content search sources | none |
| `search` | Search settings, admin search box and page, public search page and widget, the index and every search function, link suggestions in the content editor, related items on content pages, the draft search queue | none |
| `seo` | Discoverability settings, sitemap, robots, llms.txt, RSS, IndexNow, AI crawler rules | none |
| `forms` | Signup Forms menu, per-form menus, public form pages, leaderboard, referrals, form emails, the home page form | `audience` |
| `audience` | Audience menu (contacts, lists, tags, fields, app users), App audience settings | none |
| `email-marketing` | Broadcasts, drip campaigns, announcements | `audience` |
| `sms` | SMS settings, SMS logs, test SMS, **phone sign-in** (it cannot work without an SMS provider) | none |
| `payments` | Products, Transactions, pricing, checkout, account billing, premium, credits, Payments settings | none |
| `data` | The Data menu (import and export of data and files) | none |
| `pwa` | Install prompt, app install stats. **Off by default**, turned on with `on: ['pwa']` (F-D9) | none |

`seo` does not need `content`: the crawler rules, robots.txt and llms.txt matter for
any public site, and the sitemap lists whatever pages exist.

**Core, always on:** sign-in and sign-up (email, Google), users, profile, the media
manager (library, pickers, Unsplash), multilingual (Localization settings, public language switcher, `/:lang/...` pages),
feedback (it has its own on/off in Settings), notifications (bell, pages, digest,
notification emails), Google Analytics (dashboard, settings, tracking), the settings
shell, About, the email engine (provider, brand kit, composer, transactional
templates, email logs, unsubscribe and preferences), AppEvents and automations,
global message banner, site-usage banner, "powered by" footer, the admin UI language
picker, the admin dashboard, the member dashboard.

---

## 3. The file

```ts
// src/custom/features.ts (ships like this: every feature)
import type { FeatureChoice } from '../app/core/features/feature-registry';

export const CUSTOM_FEATURES: FeatureChoice = {};
```

```ts
// an installable product app with no CMS, no SMS and no payments
export const CUSTOM_FEATURES: FeatureChoice = {
  on: ['pwa'],
  off: ['content', 'sms', 'payments'],
};
```

Unknown ids and a feature in both lists stop the build (a typo must not silently
leave a feature on). The
`import type` line is required so Node can load the file directly (section 5.2).

---

## 4. Frontend

### 4.1 Core pieces

- `src/app/core/features/feature-registry.ts`: plain TypeScript, no Angular, so Vite,
  the generator and the app all import it (like `pwa-config.ts`). Holds the ids,
  labels, default state, `needs`, and `resolveFeatures(choice)`, which returns the
  enabled set or throws with a readable message.
- `src/app/core/features/features.ts`: `export const FEATURES = resolveFeatures(CUSTOM_FEATURES)`,
  plus `isOn(id)` and `featureGuard(id)` (a `canActivate` that shows the not-found page
  and keeps the address, for file-based pages whose URL cannot tell their feature).
- `src/app/core/features/feature-routes.ts`: `FEATURE_URLS`, the URLs each feature owns
  (`a/**` for everything below `a`), and `FEATURE_OFF_ROUTE`, first in the route table,
  which answers every URL of a feature that is off with the not-found page.
- `vite.config.ts` calls `resolveFeatures` once at build start, so a bad choice fails
  `npm run dev` and `npm run build` straight away.

### 4.2 What each surface does

| Surface | Today | Change |
|---------|-------|--------|
| Sidebar | Hard-coded list; always subscribes to `ContentTypes` (two listeners) and `Waitlists` | `MenuItem.feature?`; items of features that are off are dropped. The ContentTypes and Waitlists subscriptions start only when `content` / `forms` is on. The dead `MediaManagerComponent` import is removed. |
| Routes and pages | About 60 explicit routes plus the file-based pages, served whatever the menu shows | One route first in the table (`FEATURE_OFF_ROUTE`) answers every URL in `FEATURE_URLS` of a feature that is off with the not-found page. It also covers the file router's second URL for pages with an explicit route (`/admin/broadcasts` next to `/admin/email/broadcasts`), so no page file changes. Routes whose URL cannot tell their feature are left out with `whenOn(id, [...])`: `:lang/search` (search), `:lang/:contentTypeSlug...` (content), `user/:waitlistId/:userId` (forms). The two file-based content pages (`/:contentTypeSlug...`) carry `featureGuard('content')`. |
| Settings tabs | Hard-coded 15 | `feature?` per tab: payments, sms, discoverability (`seo`), app-audience (`audience`). Integrations hides the geolocation field when `forms` is off. User settings hides the phone sign-in switch when `sms` is off. |
| Admin search box and page | Search only `content-drafts` | With `search`: search every source an admin may read (section 6.4); hidden when there is none. |
| Public search | Header search and `/search` | With `search`: without it the site's `<arc-search>` tag shows nothing and `/search` is not found. Related items on content pages hide too. |
| Search settings tab | Lists the hard-coded sources with a Rebuild button | With `search`. Rebuilt around collections: see section 6.4. |
| Content editor, content pages | Link suggestions and related items call search | Hidden without `search`. |
| Admin dashboard | Every widget | Content cards and recent activity with `content`, per-form cards and signup counts with `forms`, contact counts and recent signups with `audience`, app installs with `pwa`. |
| Member area | `/user/dashboard` is the credits, plans and activity page; the shell shows credits, Pro badge, billing links | `/user/dashboard` is a blank core page (a greeting, the install prompt when the PWA is on), or the app's own page through `src/custom/user-dashboard.ts`. The old page moves to `/user/payments` (payments). The shell's Payments, Account & Billing, Premium and Plans links, Pro badge and credits render only with `payments`, which is also the only time it loads the entitlement. |
| Signup forms on pages | The form service reads, counts and submits any `data-waitlist-form` | The site's markup stays as written; without `forms` the service does nothing, and F4 removes the form functions. |
| Sign-up and profile | Offer phone sign-in when the setting is on | Only when the setting is on **and** `sms` is on (`phoneSignInOn`). |
| Onboarding | Seeds content types and a default form | Seeds only what is on. |
| Automations editor | Offers every event and action | Payment events with `payments`, form events with `forms`, `app_user.*` events and list actions with `audience`. |
| Email composer | Every template type | Form (`waitlist_*`) and payment templates only with their feature. Marketing templates stay without `email-marketing`: automations can send them. |
| Data export | Hard-coded collections of every feature | Only collections of features that are on, plus the core ones. The whole page is `data`. |

### 4.3 Custom apps

`CUSTOM_NAV` items may set `feature` too, so an app menu item that only makes sense
with payments disappears with it; app routes use `whenOn(id, [...])`. An app cannot
define new feature ids; its own pages are simply its own.

`src/custom/user-dashboard.ts` (`CUSTOM_USER_DASHBOARD`, empty by default) points
`/user/dashboard` at the app's own page.

---

## 5. Functions

### 5.1 Grouping

`functions/src/all.ts` is split by feature: the core exports stay in `all.ts`, and
each feature's exports move to `functions/src/features/<id>.ts`, a file that only
re-exports. Every one of today's 131 functions is assigned; this table is the working
list for F4 (from the inventory of 2026-09-29).

| Feature | Functions (scheduled jobs in bold) |
|---------|-----------------------------------|
| core (`all.ts`) | email engine, unsubscribe and preferences, email logs, auth (email, Google, linking), users, AppEvents, notifications, feedback, analytics, Unsplash: 44 functions (**retryPendingEmails**, **scheduledPurgeEmailLogs**, **sendAdminDigest**) |
| search | onAnyDocumentWritten, onTranslationWritten, reindexSearch, search (F5 replaces the two triggers) |
| content | processPublishQueue, onContentTypeDeleted, seedStaticPages |
| seo | regenerateSeoFiles |
| forms | waitlist and referral triggers, form OTP, joinForm, leaderboards, form templates and their migrations, syncOtpEnabledFlag |
| audience | contact sync triggers, contact callables, CSV import (used from Contacts), tags, fields, migrations onto contacts, the App audience |
| email-marketing | broadcasts, drips, announcements, the welcome-to-sequence migration (**processScheduledBroadcasts**, **processDripQueue**) |
| sms | sendTestSms and the phone sign-in callables |
| payments | checkout, webhook, payment events, credits (**scanTrialEndings**, **scanUpdatesEnding**, **scanExpiredEntitlements**) |
| data | none: import and export run in the browser |
| pwa | trackPwaEvent (off by default, so no longer deployed until an app turns the PWA on) |

Built 2026-09-29: with every feature on the build has the same 131 functions as
before less `trackPwaEvent`; with every optional feature off it has the 44 core ones.

### 5.2 The generated file

`scripts/arc-features.mjs` loads `src/custom/features.ts` with Node's built-in TypeScript loading (Node 22.18+), resolves them with the same
`feature-registry.ts`, and writes `functions/src/features.gen.ts`:

```ts
// Generated from src/custom/features.ts by scripts/arc-features.mjs. Do not edit.
export const ENABLED_FEATURES = ['content', 'seo', 'audience'] as const;
export * from './features/content.js';
export * from './features/seo.js';
export * from './features/audience.js';
```

`all.ts` re-exports it. It runs as the functions `prebuild` script (so `arc-deploy`,
`deploy:dev` and a plain `npm run build --prefix functions` all get it) and in the
Vitest global setup. `.gitignore` lists it.

### 5.3 Where core code meets a feature

The inventory found these crossings. Each gets an `isFeatureOn(id)` check from the
generated file:

| Core code | Reaches into | When the feature is off |
|---|---|---|
| `queueEmail` contact gate (consent, admin-disabled) | audience | Skipped: a contact left from before cannot block mail nobody can unblock. Marketing to an address that unsubscribed is still stopped by the Suppression gate |
| `handleUnsubscribe` | audience, email-marketing, forms | Always writes Suppression; contact consent, drip exits and form records only when their feature is on |
| `handleEmailPreferences` | audience | Shows and changes the choice through Suppression alone |
| `appEvents` rule list actions | audience | Skipped, recorded as `feature_off`; the rule stays saved |
| `seedEmailTemplates` | audience | System lists seeded only with audience |
| `linkEmail` contact sync | audience | Skipped |
| `handlePaymentEvent` (payments) | audience | Customer contact upsert skipped |
| `contacts.ts` list joins and leaves (audience) | email-marketing | No drip enrolment or exit |
| `contactSync` day-0 flush, `onAppUserWritten` app drips (audience) | email-marketing | Skipped |
| `processPublishQueue` (content) | search, seo | Indexing and reindex only with search; sitemap, RSS, robots/llms and IndexNow only with seo |
| published pages' search widget, related items (content) | search | The header's `<arc-search>` becomes nothing; no related items |
| `accountCallables.deleteMyAccount` | audience | **Always** erases contacts: erasure must reach old data even after a feature is switched off |

Notifications are core, so the notification crossings of the first draft are gone.

---

## 6. Search

### 6.1 What is indexed

Everything below needs `search` on.

| Source | Collections | Scope | Indexed when | Fields chosen in | Kept current by |
|--------|-------------|-------|--------------|------------------|-----------------|
| `content` (published) | `arc_{slug}`, one per content type with a public URL, with their translations | public | `content` is on | content type editor (title, summary, ticked text fields), as today | the publish queue, directly |
| `content-drafts` | `arc_{slug}_drafts`, one per content type, with their translations | admin | `content` is on | same | the draft search queue (6.5) |
| a listed collection | one line each in `search-sources.ts` | chosen in Search settings | listed **and** set up in Search settings | Search settings | its own trigger |

Nothing else is indexed. `Products` is indexed today; after this change it is not,
unless the app lists the ready-made `productsSource` (6.2). Nothing in the UI searches
products today, so nothing visible changes.

### 6.2 The custom file

`functions/src/custom/search-sources.ts` ships empty:

```ts
export const SEARCH_COLLECTIONS: string[] = ['Lessons'];              // set up in Search settings
export const CUSTOM_SEARCH_SOURCES: SearchSource[] = [productsSource]; // written in code
```

Adding or removing a name needs a functions deploy (it adds or removes a trigger).
Everything else about a named collection is set up in Search settings. A source
written in code covers what the settings cannot express (leaving documents out,
a computed badge, languages, ranking); its collection gets a trigger the same way,
and it shows in Search settings as "Set up in code". **Products is such a source**
(it leaves inactive products out and shows the price), ready-made in
`functions/src/search/sources/products.ts`: an app lists `productsSource` to
make products searchable.

### 6.3 High-volume collections are refused

Never searchable: `EmailLogs`, `SmsLogs`, `AppEvents`, `Notifications`,
`WebhookEvents`, `PwaStats`, `CreditLedger`, `SearchIndex`, and any collection whose
name starts with `_` (queues). The functions build fails if `SEARCH_COLLECTIONS` or a
custom source names one, and Search settings shows them greyed out with the reason.

### 6.4 Search settings

One screen, one row per top-level collection in the database, read live by an admin
callable (`listSearchCollections`, using the Admin SDK's list of collections).

| Row state | Shown when | What the admin can do |
|-----------|-----------|-----------------------|
| **Content** | the content collections | Nothing here; a link to the content type editor, where searchable fields are already chosen |
| **Searchable** | listed in the file and set up | Edit the setup, Rebuild, see the entry count and last rebuild |
| **Needs setup** | listed in the file, not set up yet | Set it up (below); nothing is indexed until then |
| **Not searchable** | in the database, not in the file | Shows the exact line to add to `search-sources.ts` with a copy button, and a note that a functions deploy makes it searchable |
| **Never searchable** | on the list in 6.3 | Greyed out with the reason |

Setting up a collection:

- **Fields.** A callable (`sampleCollectionFields`) reads up to 20 documents and
  lists their text fields (strings and lists of strings, one level into maps, as
  dotted paths like `address.city`). Numbers, dates, booleans and references cannot
  be tokenized and are not offered. Each field gets a tick box and a weight: **high**
  (weight 3, with type-ahead) or **normal** (weight 1).
- **Result.** A title field (required), an optional snippet field, and an optional
  link pattern with `{id}` and `{field}` placeholders, such as `/admin/lessons/{id}`.
  Without a link a result shows but does not open anything.
- **Who may search it:** public, signed-in, or admin. Picking public shows a warning
  that visitors will see the title and snippet of every indexed document.
- **Preview:** one real document shown as a result, updated as the setup changes.
- **Save and rebuild:** saving writes the setup and runs a rebuild of that
  collection. Changes to fields, result or scope apply this way, with no deploy.

The setup lives in `Settings/search_collections`, one entry per collection:
`{ label, fields: [{ path, weight }], title, snippet?, link?, scope }`. The trigger and
the rebuild read it once per run, cached, the way the localization settings are.
The admin search box and page stop naming `content-drafts` and search every source an
admin may read except published content (whose drafts they already find), through a
new `except` option on the search callable; the box hides when there is nothing to
search. The hard-coded `KNOWN_SEARCH_SOURCES` list goes: the status document now
carries each source's label and scope. The public search box and `/search` show with
`search` and `content` both on; an app with other public sources places its own box.

A full rebuild leaves the index holding exactly today's sources: entries of a source
rebuilt before but gone now (a collection taken out of the file, a feature turned
off) are deleted with its status.

### 6.5 Which writes start a search function

Firestore triggers match a path fixed at deploy time. Today one trigger,
`onAnyDocumentWritten` on `{collection}/{docId}`, starts on every create, update and
delete of every top-level document in the database (users, Settings, Contacts,
EmailLogs, SmsLogs, AppEvents and the rest), checks the name and stops. A second one,
`onTranslationWritten`, starts on every `translations` subcollection write. Both are
**removed**. In their place:

| Trigger | Path | Deployed when |
|---------|------|---------------|
| one per listed collection | `<Collection>/{docId}`, as the group `arccms-searchSync-<Collection>` | `search` is on, per name in `SEARCH_COLLECTIONS` |
| draft search queue | `_search_queue/{id}` | `search` and `content` are on |
| publish queue (existing) | `_publish_queue/{id}` | `content` is on; it indexes published content as today |

**The draft search queue.** Every place in the browser that writes a draft or a
draft translation adds a small document to `_search_queue`
(`{ collection, docId, removed }`) **in the same batch**, so a draft cannot be saved
without its queue entry. The trigger indexes the draft (with its translations) and
deletes the queue entry. The shared database service's add, update,
batch add and delete, and the translation save and delete, write the entry through
one helper (`src/shared/services/search-queue.ts`); a test checks each of them. The
other browser writes to drafts (next-content links, collection reference sync) change
no indexed field. Data import does not queue: rebuild after an import. Functions that
write drafts call the index directly: publishing re-indexes the draft after stamping
it, and deleting a content type removes its collections' entries. The rules let staff
write an entry holding only `collection` (a drafts collection), `docId` and `at`, and
nobody read it.

**Result:** a search function starts only for a write to a listed collection, a
draft save, or a publish. A write to logs, users, settings or anything else never
starts one, whatever the app.

## 7. Deploy

| Tool | Problem | Change |
|------|---------|--------|
| `arc-deploy.mjs` | Removed functions trigger the Firebase CLI's delete prompt, which fails without a terminal | Before a full functions deploy, compare the built exports with the deployed `arccms-*` functions, list what will be deleted, ask once (the menu already words this), then pass `--force` |
| `check-callable-access.sh` | Hard-coded 62 callables; a disabled one showed "NOT DEPLOYED" and failed the deploy | **Done in F4:** reads every callable from the built `lib/index.js`, which also picks up the 25 the list had missed |
| `arc-upgrade.mjs` | Deletes old unprefixed names only if still exported | Also delete old names of features that are off |
| targeted deploys | `--only functions:arccms:arccms.<name>` never deletes | Unchanged; the guide says a full functions deploy is what removes a feature's functions |

URLs already out in the world (webhooks registered with Dodo, links in sent emails)
stop working when their feature is turned off. That is the intent; the guide says so
next to each feature.

---

## 8. Keeping it complete

A test fails when a new piece is not claimed by a feature or core:

- every explicit route and every file-based page under `src/app/pages`
- every sidebar item and every settings tab
- every function exported from `lib/index.js` (built in the test's setup)
- every feature's `needs` resolves, with no cycles
- every listed search collection passes the high-volume check (6.3)
- every browser write to a drafts collection goes through the queue helper (6.5)

Without it the next new page would ship outside the system.

Core specs always run with every feature on: `src/test/setup.ts` mocks
`src/custom/features.ts` as empty, so an app that turns features off can still run
the whole suite. A spec about a particular choice mocks the file itself.

---

## 9. Phases

| Phase | What it does | Done when |
|-------|-------------|-----------|
| **F1** Registry and file | `feature-registry.ts`, `features.ts`, `src/custom/features.ts` (empty), `resolveFeatures` with `off` and `needs`, Vite build check, custom-space test and `docs/custom-code.md` rows | Unit tests for resolve, needs, unknown ids; nothing visible changes |
| **F2** Admin surfaces | Sidebar (and its listeners), settings tabs and fields, dashboard widgets, automations editor, composer categories, data export list | With `off: ['content', 'forms', 'audience', 'email-marketing', 'payments']` the admin shows only core; browser check at localhost:5173 |
| **F3** Routes and public side | `FEATURE_URLS` and the feature-off route, `whenOn` for parameter routes, `featureGuard` on the content pages, member dashboard split (`/user/dashboard` blank, `/user/payments`) with the `user-dashboard.ts` plug point, form service, phone sign-in, public search, related items, onboarding seeding | A disabled feature's URLs give not-found (built 2026-09-29, checked in the browser) |
| **F4** Functions | Split `all.ts`, `features/<id>.ts`, generator and prebuild, the crossings in 5.3, callable probe from the build | `lib/index.js` with those features off has none of their functions; all tests pass (built 2026-09-29) |
| **F5** Search | Section 6: `search-sources.ts` and per-collection triggers, the draft search queue and its writers, removal of the every-write and translations triggers, high-volume refusal, the new Search settings screen (collection list, field picker, preview, rebuild), `Settings/search_collections`, admin search from every readable source, search developer guide update | Built 2026-09-29 and unit tested. On the dev project after the F6 deploy: a collection added to the file and set up in Search settings is indexed and found in admin search; a write to EmailLogs starts no function; a draft save updates the index. The rules tests need Java 21 to run |
| **F6** Deploy tooling | Section 7 | A full functions deploy on the dev project with features off deletes exactly the expected functions and the probe passes; turning them back on recreates them |
| **F7** Coverage test and guide | Section 8 test; `docs/features.md` (how to choose, what each feature owns, what turning one off does to URLs and data) | Test fails on an unclaimed route, tab, nav item or function |

F1 changes nothing visible. F2 and F3 are frontend only. F4 to F6 need a functions
deploy on the dev project to check.

---

## 10. Risks

- **Removing a feature deletes its functions on the next full deploy.** Intended
  (F-D3), and the deploy lists them and asks first.
- **Webhooks and links** of a removed feature stop working (section 7).
- **Products drop out of the index** on installs that relied on it, until the app
  lists the ready-made `productsSource` (6.2). Nothing in the UI searches
  products today.
- **The first full deploy deletes `onAnyDocumentWritten` and `onTranslationWritten`
  on every install.** Drafts saved between that deploy and the new frontend going
  live are not indexed; a Rebuild of `content-drafts` after both are out fixes it.
- **A draft writer that skips the queue** leaves its drafts out of admin search until
  the next rebuild. The helper test (section 8) is the guard.
- **A crossing the inventory missed** would call a feature that is off. The
  crossings run on existing data only, so the worst case is a skipped side effect or
  an error in a log; the F4 test with each feature off is the guard.
- **Translation files still hold every feature's words.** Accepted: the cost is size,
  not behaviour.

---

## 11. Questions

None open. Decided 2026-09-29: ten switchable features (search added, on by
default); multilingual, feedback, notifications, Google Analytics, users and the
media manager are core; no presets; search indexes only content by default; other
collections are listed in a file and set up in Search settings (option C); logs are
never indexed; the every-write trigger is removed, with drafts indexed through a
queue.
