# ArcCMS Multi-lingual Content & Admin UI — Build Spec

**Status:** Approved for phased build (discussion completed 2026-07-26)
**Branch:** `feat/multilingual` (cut from `feat/audience-unification` — that branch stack
already touched the content editor and content services vs `main`, so building on it
avoids guaranteed merge conflicts)
**Scope:** public content i18n + admin UI i18n. **Emails are explicitly out of scope —
they stay in one language (English).** `docs/email-system-spec.md` is untouched by this work.

---

## 0. Decision log

| # | Decision | Choice |
|---|----------|--------|
| M-D1 | Where translations live | **Additive sibling subcollection** `arc_{slug}_drafts/{id}/translations/{lang}`, holding *only* the translated fields. The main doc stays byte-identical and *is* the default language. Render data for a language = `{...baseDoc, ...translationDoc}` — any untranslated field falls back to the default language automatically. Rejected: embedded per-field maps (`title: {en,hi}`) — would migrate every doc and break every reader; field suffixes (`title_hi`) — collide with user-defined `customFields` keys. |
| M-D2 | URL scheme | Default language keeps **all current URLs unchanged** (`/{ctSlug}/{urlSlug}`). Other languages get a path prefix: `/{lang}/{ctSlug}/{urlSlug}` and `/{lang}/{ctSlug}` for lists. `urlSlug` is **identical across languages** (translated slugs deferred — they drag in per-language uniqueness + cross-language redirects). |
| M-D3 | Language registry | New Firestore doc **`Settings/localization`**: `{ defaultLanguage: 'en', enabledLanguages: [{code, label, nativeLabel, rtl?}] }`. Follows the established one-doc-per-concern `Settings` pattern (like `Settings/misc`). Read server-side through the cached helpers in `functions/src/shared/site-settings.ts`. |
| M-D4 | Templates | **Zero template changes.** Templates are language-agnostic; translated data flows through the same `{{ }}` / `data-arc-bind` hydration. Static template strings (e.g. "Back to") can later be overridden via per-language keys injected into the template data object — deferred until a template actually needs it. |
| M-D5 | Which fields are translatable | Built-ins: `title`, `content`, `summary`, `seoTitle`, `metaDescription`. Custom fields: types `text` and `richtext` only (numbers, dates, booleans, images, dropdown/checkbox/radio *values*, and collection refs stay shared with the base doc). |
| M-D6 | Published side | On publish, the Cloud Function **copies the `translations` subcollection** from the draft to the published doc (`arc_{slug}/{id}/translations/{lang}`) in the same sync that copies the doc — so the SPA fallback and future consumers can read published translations. Static HTML gets the merged data baked in. |
| M-D7 | List pages | Untranslated items **fall back to default-language cards** on `/{lang}/{ctSlug}` (an item missing a translation still appears). Empty lists look broken; partial translation is the normal state of a real site. |
| M-D8 | Language switcher | Dropdown in the header partial (`Settings/partials` / `public/_partials/_header.html`) that swaps the `/{lang}/` prefix on the current path + a few lines of JS persisting the choice in `localStorage`. No automatic geo/`navigator.language` redirect in v1 (deferred; it fights with CDN caching). |
| M-D9 | SEO | `<html lang>` from page language (today hardcoded `"en"` in `functions/src/shared/html-document.ts`), correct `og:locale`, **`hreflang` alternate links across all variants + `x-default`**, sitemap `xhtml:link` alternates, dates formatted per page language (today hardcoded `'en-US'`). Canonical stays self-referential per language variant. |
| M-D10 | Admin UI i18n library | **Transloco** (runtime JSON translations). `@angular/localize` is ruled out: it needs the Angular CLI builder's per-locale build outputs, and this project builds through AnalogJS + Vite (`vite build`), which has no such wiring. Transloco needs no build changes, works with signals, and switches live. |
| M-D11 | Admin language preference | **Per admin user** (field on the user profile doc), falling back to `Settings/localization.defaultLanguage`. A Hindi-content site can still have an English-preferring admin. Public visitor preference is separate (M-D8, localStorage). |
| M-D12 | AI translate | Optional phase: "Translate with AI" in the editor pre-fills the `translations/{lang}` doc via the existing Google Vertex AI integration, for admin review before publish. Never auto-publishes. |
| M-D13 | Tags / categories | Tag names & colors stay shared (untranslated) in v1 — they're cross-cutting labels stored per content type (`Tags_{slug}`). Deferred, listed in non-goals. |

### Explicit non-goals (deferred or permanently out)
**Emails/notifications in any language other than English (permanent, per product decision
2026-07-26)** · translated `urlSlug`s · per-language template folders · tag/category name
translation · automatic locale redirect by geo/browser · RTL layout audit of the public
templates (do a one-time `dir="rtl"` pass only when the first RTL language is enabled) ·
translating the email admin *content* (the email pages' UI chrome IS translated as part of
the admin UI track — only the emails themselves stay English) · per-language RSS feeds
(revisit on demand).

---

## 1. Current architecture (what this builds on)

```
AUTHORING                         PUBLISHING (static, production path)
Admin editor                      _publish_queue (Firestore)
create-content.component.ts  ──▶  processPublishQueue.ts (onDocumentCreated)
  ├ publishForm + seoForm            ├ copy draft → arc_{slug} (+PublishedHistory)
  ├ TipTap `content` HTML            ├ skip HTML if !ContentType.hasPublicUrl
  └ customFields bag                 ▼
writes arc_{slug}_drafts          deployContentPage.ts / deployContentListPage.ts
                                     ├ loadTemplate (Firestore templates/{folder} → hosted → fallback)
                                     ├ buildTemplateData (spread content + customFields + share + readTime)
                                     ├ hydrate ({{ }}, data-arc-bind/loop/if) — template-hydration.ts
                                     ├ inject header/footer partials (Settings/partials → /_partials/*)
                                     ├ buildHtmlDocument (<html lang="en"> ← HARDCODED, SEO/OG meta)
                                     ▼
                                  deployToHosting.ts (Hosting REST API, new release per publish)
                                     → /{ctSlug}/{urlSlug}.html   (cleanUrls: true)
                                     → sitemap.xml + /{ctSlug}/feed.xml regenerated

FALLBACK (preview/drafts): no static file → rewrite "**" → /__shell.html → Angular
[contentTypeSlug]/[urlSlug].page.ts → ContentDetailComponent reads Firestore + runs the
SAME hydration client-side (src/app/core/services/template-hydration.service.ts).
```

Key facts the plan exploits:
- Pages are pre-rendered per URL ⇒ adding a language = rendering the same template with
  merged data at a prefixed URL. No runtime translation engine on the public site.
- Draft and published docs share the same document ID.
- The `Settings` collection already has the one-doc-per-concern pattern + 5-min server cache.
- There is **no existing i18n anywhere**: no library, no `LOCALE_ID`, `og:locale` hardcoded
  `en_US` in `content-detail.component.ts` / `content-list.component.ts`, dates `'en-US'`.

---

## 2. Working protocol (applies to every phase)

- **No emulators.** `npm run dev` (localhost:5173) talks to the **real dev Firebase
  project**. Functions / rules / indexes changes are invisible until deployed:
  - functions only: `cd functions && npm run build && firebase deploy --project default --only functions[:name] --non-interactive --force`
  - rules: `firebase deploy --project default --only firestore:rules`
  - full: `npm run deploy:dev` (build + functions + hosting + seed) — use when hosting
    assets (partials, templates) changed.
- **Per-phase report.** On completing a phase, report: (1) what was done, (2) exact manual
  test steps for the user, (3) what the next phase will do. Then **test it in the browser**
  before reporting.
- **Admin access for browser testing:** open `localhost:5173/signup` and the user logs in
  as admin. Login persists across dev-server restarts — do not log out.
- **Tests** run from the repo root: `npm run test` (Vitest; frontend + functions together).
- **New admin pages need an explicit route in `app.routes.ts`** — file-based-only admin
  pages render the public "Content Not Found" page (which returns HTTP 200, so status-code
  checks lie).
- Each phase ends in its own commit(s); the phase is not "done" until browser-verified.

---

## 3. Phases

### Phase M1 — Localization settings foundation (S)

**Goal:** the site knows its languages; everything later reads from one place.

1. Model + service: `Settings/localization` doc —
   `{ defaultLanguage: string, enabledLanguages: [{code, label, nativeLabel, rtl?}] }`.
   Default seed: `{ defaultLanguage: 'en', enabledLanguages: [{code:'en', label:'English', nativeLabel:'English'}] }`.
   Language codes are BCP-47 primary subtags (`en`, `hi`, `fr`, …).
2. Admin page `src/app/pages/admin/(settings)/localization/` (model + page, following
   `misc/` as the pattern): pick default language, add/remove/reorder enabled languages
   from a curated language list constant. Guard: default language cannot be removed.
   Add the card to `settings.page.ts` hub + **explicit route in `app.routes.ts`**.
3. Server helper: `getLocalizationSettings()` in `functions/src/shared/site-settings.ts`
   (same 5-min cache as `getSiteConfig`), with safe defaults when the doc is absent.
4. Frontend `LocalizationService` (core/services): loads the doc once, exposes signals
   (`defaultLanguage`, `enabledLanguages`, `extraLanguages` = enabled minus default).
5. Firestore rules: `Settings/localization` — public read (public pages need the language
   list), admin write, mirroring the existing `Settings` rules pattern.

**Deploy:** firestore rules; functions only if the helper ships now (it can ship in M3).
**Manual test:** admin → Settings → Localization: add `hi` (Hindi), set default `en`,
save, reload — persists. Firestore console shows `Settings/localization`.
**Exit criteria:** settings page round-trips; non-admin cannot write the doc.

### Phase M2 — Translation authoring in the editor (M)

**Goal:** admins can author per-language variants of any content item.

1. Draft model: new interface `IContentTranslation` —
   `{ lang, title?, content?, summary?, seoTitle?, metaDescription?, customFields?: Record<string, unknown>, translatedAt, translatedBy, aiGenerated?: boolean }`.
   Subcollection path helper in `DraftContentsService`:
   `arc_{slug}_drafts/{id}/translations/{lang}` (doc ID = lang code).
2. Editor (`create-content.component.ts` + `.html`): a language selector (tabs or
   dropdown) shown only when `extraLanguages.length > 0`.
   - Default language selected → editor behaves **exactly as today** (same forms, same
     save paths — zero regression surface).
   - Other language selected → the translatable built-ins (M-D5) + translatable custom
     fields swap to the translation doc's values; untranslated fields show the
     default-language value as placeholder/ghost text. Non-translatable fields
     (slug, cover image, tags, dates, refs, publish controls) render read-only with a
     "shared across languages" hint.
   - Save writes only the translation subdoc (only fields actually filled). A
     "clear translation" action deletes the subdoc.
   - Unsaved-changes guard when switching language tabs.
3. Firestore rules: `match /arc_{anything}_drafts/{id}/translations/{lang}` admin-only
   read/write — align with however draft collections are matched today; extend the
   existing wildcard if drafts use one.
4. Unit tests: subdoc path building, merge helper `mergeTranslation(base, translation)`
   (shared util — the same function will be used server-side in M3; put it where both
   can import it or mirror it with a source-scan test like the audience-spec pattern).

**Deploy:** firestore rules.
**Manual test:** enable `hi` in M1's page → open an article in the editor → switch to
Hindi → translate title + body → save → Firestore console shows
`arc_articles_drafts/{id}/translations/hi` → switch back to English — base doc unchanged;
reload editor — Hindi values reload.
**Exit criteria:** default-language editing path provably untouched (existing editor
specs still green); translation subdocs round-trip.

### Phase M3 — Per-language publishing + SEO (M — the core)

**Goal:** publish deploys one static page per language; search engines see a correct
multilingual site.

1. `processPublishQueue.ts`:
   - `publish`/`update`: after the existing draft→published copy, copy the draft's
     `translations` subcollection to the published doc (delete published-side langs that
     no longer exist on the draft). Then deploy the default page (unchanged) **plus one
     detail page per enabled language that has a translation subdoc** at
     `/{lang}/{ctSlug}/{urlSlug}.html`, and per-language list pages `/{lang}/{ctSlug}`
     (list data: translated card fields when available, fallback otherwise — M-D7).
   - `unpublish`/`delete`: remove all language variants from Hosting (loop
     `removeFileFromHosting` over enabled languages) + the published translations subdocs.
2. `deployContentPage.ts` / `deployContentListPage.ts`: accept `lang`;
   `buildTemplateData` merges `{...content, ...translation}`; date formatting uses the
   page language (`toLocaleDateString(lang)`), not `'en-US'`.
3. `html-document.ts`: `buildHtmlDocument` takes `{lang, rtl, alternates}` —
   `<html lang="{lang}"{dir}>`, `og:locale`, and `<link rel="alternate" hreflang>` for
   every variant + `x-default` (default language). Emit these on the default page too.
4. `generateSitemap.ts`: `xhtml:link` alternates per URL.
5. Batching note: each deployed file is a Hosting release; deploy language variants in
   one version where the existing `deployToHosting` flow allows batching multiple files —
   if it doesn't, accept N releases per publish in v1 and log it (`log()` cost visible,
   no silent behavior change).
6. Tests: merge + alternates + lang-attr unit tests in `functions/src/__tests__/`.

**Deploy:** functions (`processPublishQueue` + pages group).
**Manual test:** publish the article translated in M2 → verify
`https://{site}.web.app/articles/{slug}` (English, now with hreflang links, still
byte-equivalent content otherwise) and `/hi/articles/{slug}` (Hindi title/body, `<html
lang="hi">`, `og:locale`); `/hi/articles` list shows the Hindi card + fallback cards;
view-source shows hreflang pairs both directions; sitemap.xml has alternates; unpublish
removes both variants.
**Exit criteria:** default-language output unchanged except additive SEO tags;
translated variant fully served; unpublish leaves no orphan files.

### Phase M4 — Language switcher + SPA fallback (S)

**Goal:** the visitor-facing button; previews work for translated pages.

1. Header partial (`public/_partials/_header.html` + the `Settings/partials` override
   note in docs): language dropdown built from `Settings/localization` **baked in at
   publish time** (partials are injected server-side; regenerating pages refreshes it).
   Links swap the `/{lang}/` prefix on the current path; ~10 lines of inline JS store
   the choice in `localStorage` and highlight the active language. Degrades to plain
   links without JS.
2. SPA fallback route: `src/app/pages/[lang]/[contentTypeSlug]/[urlSlug].page.ts` (+
   list variant) → reuse `ContentDetailComponent`/`ContentListComponent` with a `lang`
   input; components read the published translation subdoc and apply the same
   `mergeTranslation`; client-side Meta tags get the right `og:locale`/hreflang. Guard:
   `[lang]` param must match an enabled language, else 404 → not-found page (avoid the
   `[lang]` route shadowing real top-level routes — AnalogJS route precedence check).
3. `public-page-renderer` static pages (`/pages/*`): out of scope for variants, but the
   switcher on them must not 404 — link to `/{lang}/` home or hide on unprefixed pages.

**Deploy:** `npm run deploy:dev` (hosting assets changed) or republish-all to refresh
baked partials on existing pages.
**Manual test:** visit the published English article → switcher shows English/हिन्दी →
click Hindi → lands on `/hi/articles/{slug}` → choice persists across pages; a
draft-preview of the Hindi variant renders via the SPA fallback.
**Exit criteria:** button works end-to-end on static pages; SPA preview renders
translations; no route shadowing regressions (`/admin`, `/pricing`, etc. still resolve).

### Phase M5 — AI auto-translate (S–M, optional but high-leverage)

**Goal:** one click fills a translation for review.

1. Callable function `aiTranslateContent({contentTypeSlug, docId, targetLang})` (admin;
   reuse the existing Vertex AI integration + callable-access pattern): sends the
   translatable fields, writes the result to the draft's `translations/{lang}` subdoc
   with `aiGenerated: true`; TipTap HTML translated tag-preservingly (translate text
   nodes, keep markup).
2. Editor: "Translate with AI" button on a language tab (empty or stale); result loads
   into the form for review — publish still requires the normal M3 flow.
3. Rate/size guard + clear error surfacing (Vertex quota).

**Deploy:** functions.
**Manual test:** new article → Hindi tab → Translate with AI → review/edit → save →
publish → `/hi/...` serves it.
**Exit criteria:** round-trip without manual Firestore edits; `aiGenerated` flag visible
in the editor ("AI draft — review before publishing" badge).

### Phase M6 — Admin UI i18n foundation (M)

**Goal:** the mechanism, proven on a slice — not the full extraction.

1. Add Transloco: `@jsverse/transloco` + config (default `en`, fallback `en`,
   `availableLangs` from a constant for the admin UI — admin UI languages are
   independent of content languages), JSON files under `src/assets/i18n/{lang}.json`.
   SSR note: AnalogJS server render must have translations available (Transloco SSR
   guidance / transfer state) — verify no hydration flicker.
2. Per-admin-user preference (M-D11): `preferredLanguage` on the user profile doc +
   picker in the admin header/profile menu; `LocalizationService` applies it via
   `translocoService.setActiveLang` at startup.
3. `LOCALE_ID`/`registerLocaleData` wiring for date/number pipes keyed to the active
   admin language (~22 formatting-pipe usages repo-wide — small).
4. Prove the slice: extract the **admin shell** (side navbar, page headers, settings hub)
   + the M1 localization settings page to `en.json` + one second language (`hi.json`)
   as the living example. Establish key conventions (`admin.nav.*`, `admin.settings.*`,
   `common.actions.*`) and document them at the top of `en.json`.
5. Angular Material internals: provide translated `MatPaginatorIntl` (+ sort/datepicker
   labels) — Material strings don't go through Transloco by default.
6. Test-provider helper (`translocoTestProviders()` alongside the existing
   `headerTestProviders()` pattern) so component specs don't all break.

**Deploy:** none (frontend only, dev server enough).
**Manual test:** admin header language picker → switch to Hindi → shell nav + settings
hub + localization page flip live, rest of the admin stays English (expected); date pipes
follow; preference persists across reload/restart.
**Exit criteria:** mechanism + conventions + test helper in place; existing specs green.

### Phase M7 — Admin UI string extraction (L, incremental — many commits)

**Goal:** sweep the remaining admin surface. Order by traffic:
1. Contents area (editor, tables, content-types) — the daily-use surface.
2. Settings pages, users, audience/forms/lists pages, media, dashboard/analytics.
3. Snackbar/notification call sites (~458) — mechanical; consider a thin
   `notify(key, params)` wrapper so retrofits are one-line.
4. Shared components (`src/shared/components`, 54 files) + validation messages +
   confirm dialogs.

Rules of the sweep: extraction only — no behavioral edits ride along; every batch keeps
`en.json` complete and specs green; missing keys fall back to English silently
(Transloco fallback), so partial coverage is always shippable. AI-assisted extraction
per directory, human-reviewed. Track per-directory progress with checkboxes below as
batches land:

- [ ] contents/ · [ ] (settings)/ · [ ] users/ · [ ] audience pages · [ ] (media)/ ·
  [ ] dashboards · [ ] snackbars wrapper + sweep · [ ] shared components · [ ] dialogs

**Manual test per batch:** flip to the second admin language, walk the swept pages, no
`missing key` console warnings, no English leakage on swept pages.

---

## 4. Sequencing & dependencies

```
M1 ──▶ M2 ──▶ M3 ──▶ M4          (content track: each phase depends on the previous)
 │                    └─▶ M5     (needs M2 subdocs + M3 publish to be useful end-to-end)
 └────────────────────────▶ M6 ──▶ M7   (admin track: independent of M2–M5; M6 wants
                                          M1's LocalizationService only for defaults)
```

The two tracks are independent after M1 and can interleave; the content track (M1–M4)
delivers the user-visible "button" and should go first.

## 5. Reversibility & risk notes

- Every phase is additive: no existing doc is migrated, no existing URL changes, no
  template changes. Disabling a language stops deploying its pages; a cleanup pass
  removes hosted `/{lang}/**` files (M3's unpublish loop is the tool).
- Biggest regression surface: the editor (M2) — mitigated by keeping the
  default-language path literally unchanged, and by the existing editor specs.
- Route shadowing by `[lang]` (M4) — must verify AnalogJS precedence against real
  top-level routes before merge.
- Hosting release count per publish (M3.5) — watch deploy duration on multi-language
  publishes; batch if the API flow allows.
- `no-emulator` reality: every functions phase needs a real deploy before browser
  verification — false negatives otherwise.
