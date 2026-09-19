# ArcCMS Search: Build Spec

**Status:** Approved for phased build (discussion completed 2026-09-18). Nothing built yet.
**Branch:** `feat/search` (cut from `dev`)
**Scope:** database-backed token search over short fields (titles, summaries and any
other short field a source declares), served by a Cloud Function, with type-ahead in the
public site header and in the admin header. The engine is generic: any Firestore
collection can be registered as a search source with its own fields and its own result
display. Content types are the first source, not a special case.

**Out of scope, permanently:** client-side search (downloading documents and filtering
in the browser) and third-party search services (Algolia, Typesense, Meilisearch and the
like). Both were rejected before this spec was written.

---

## 0. Decision log

| # | Decision | Choice |
|---|----------|--------|
| S-D1 | Where the index lives | One Firestore collection, **`SearchIndex`**, holding one small document per (source, document, language). Not fields on the content documents: a per-type `arc_*` layout cannot be searched across types in one query, token churn would rewrite large documents on every body edit, and a separate collection isolates exposure. Client reads and writes are denied by rules; only Cloud Functions touch it. |
| S-D2 | Query path | A single callable Cloud Function, **`search`**, for every caller. It tokenizes the query with the same code the indexer uses, runs the Firestore queries, ranks the candidates and returns display data only. Firestore alone can return unranked OR matches or strict AND matches; the ranking step is what makes results feel like search. Direct client queries against the index are not offered. |
| S-D3 | Token semantics | OR at the database, ranked in the function. `array-contains-any` on the token array fetches candidates matching any query token; the function scores them so documents matching more tokens, in heavier fields, rank first. Rejected: a token map with per-key equality filters (AND). It cannot combine with ordering, and "one wrong word, zero results" is worse than ranked OR for type-ahead. |
| S-D4 | Prefixes, not substrings | Fields flagged `prefix: true` also index every prefix of each token from 2 characters up to 12. Typing `kar` finds "Gunjan Karun"; typing `arun` does not. Mid-word matching would roughly triple the index for little gain. |
| S-D5 | No stemming, no synonyms | Content is multilingual and stemmers are wrong outside English. Prefix tokens give most of what stemming would. A typo fallback (S-D9) covers the rest. Synonyms are a later phase if ever wanted. |
| S-D6 | Accent folding is Latin-only | Lowercase everything. Strip combining marks only after Latin base letters. A naive Unicode fold would strip Devanagari vowel signs and corrupt every Hindi token. |
| S-D7 | Sources are config, the engine is generic | A **`SearchSource`** object declares the collection (name or pattern), the fields to index with weights and prefix flags, the display mapping (title, snippet, badge, link, meta), the scope, the language resolver and an include predicate. Sources register in one array. The tokenizer, index shape, callable, Angular service and search box never change when a source is added. |
| S-D8 | Scope is enforced in the function | Each source is `public`, `authenticated` or `admin`. The callable checks the caller against every requested source and refuses the request if any fails. Firestore rules never see a client query on the index, so one collection with a `scope` field is safe. |
| S-D9 | Typo fallback is query-side | When a query returns nothing and its last token is at least 4 characters, the function shortens that token by one character and retries, at most twice, never below 3 characters. Firestore has no fuzzy matching; this is the cheap substitute. |
| S-D10 | Language handling | An index entry carries one `lang`. Multilingual sources write one entry per language, merging each translation over the base document so an untranslated summary indexes the fallback text. Language-neutral sources write `lang: '*'`. The callable runs the requested language and `*` as two parallel queries and merges them, because Firestore will not combine that filter with the token filter in one query. |
| S-D11 | Per-source queries, not `in` filters | When a caller narrows to some sources, the function runs one query per source in parallel (at most 5 sources per call) rather than an `in` filter. Keeps every query at one disjunctive clause, so the 30-value limit applies to tokens alone, and needs only two composite indexes. |
| S-D12 | How index entries get written | Three paths. (1) A generic `onDocumentWritten('{collection}/{docId}')` trigger that looks the collection up in the registry and returns at once on no match. (2) An explicit `upsertSearchEntries` / `removeSearchEntries` API for code that writes data itself; the publish pipeline uses it so publishing and indexing land together. (3) An admin `reindexSearch` callable that rebuilds one source or all of them. |
| S-D13 | The generic trigger is accepted overhead | It fires on every top-level write in the database, including email logs and users, and returns in under a millisecond for unregistered collections. At this product's scale that stays inside the free tier. It is the only way to cover collections that do not exist at deploy time, such as `arc_{slug}_drafts` for a content type created tomorrow. |
| S-D14 | Content is two sources | `content` (published, `arc_{slug}`, scope public, excluded when the content type has `hasPublicUrl: false`) and `content-drafts` (`arc_{slug}_drafts`, scope admin, links to the editor). Same fields, different audience and link. The two never collide because the index document ID includes the source ID. |
| S-D15 | Admins choose custom fields to index | `ContentType.searchFields?: string[]` lists custom field keys to index alongside title and summary. Read at index time. Lets a People type make `city` searchable from the content type editor with no code change. Only `text` custom fields qualify; rich text is excluded. |
| S-D16 | Public widget is server-injected, like the language switcher | The header partial carries `<arc-search>`. The static renderer replaces it with markup, a small stylesheet and one deferred script tag, mirroring `<arc-language-switcher>` in `html-document.ts`. The SPA fallback has an Angular `arc-search` component for the same tag. Both call the same callable. |
| S-D17 | Admin search lives in the page header | `arc-page-header` gains a search box docked beside the notification bell, shown to admins only. Every admin page already renders that header, so nothing else needs wiring. `Cmd+K` / `Ctrl+K` focuses it. |
| S-D18 | Results page is an SPA route | Enter in either search box goes to `/search?q=` (public, with the `/{lang}` prefix where applicable) or `/admin/search?q=`. No static file exists at those paths, so Hosting falls through to the Angular shell. |
| S-D19 | Cold start is accepted, not pre-paid | `minInstances` stays 0 at launch. The first search after idle costs about a second. Raise it from function config only if measured latency on the public site justifies the monthly cost. |

### Explicit non-goals (deferred or permanently out)
Client-side search (permanent) · third-party search services (permanent) · indexing
body text or rich text · substring or infix matching · stemming · synonyms · vector or
semantic search (would need an embedding model call; revisit as a separate phase) ·
search analytics ("what did visitors search for") · App Check or rate limiting on the
public callable beyond the query and result caps (listed under risk) · replacing the
draft table's column filter (it stays as it is).

---

## 1. Current architecture (what this builds on)

```
CONTENT                                   PUBLIC PAGES
arc_{slug}_drafts/{id}                    static HTML per URL, deployed to Hosting by
  └ translations/{lang}   (title,         processPublishQueue.ts → deployContentPage.ts
    summary, … overrides)                 header/footer from public/_partials/*.html,
arc_{slug}/{id}         (published copy   injected by html-document.ts, which also swaps
  └ translations/{lang}   made by the     <arc-language-switcher> for generated markup.
    publish queue)                        SPA fallback: no static file → __shell.html →
                                          Angular page.parts components, which read
                                          Firestore directly and render the same partials.

ADMIN                                     FUNCTIONS
arc-page-header on every admin page       onCall callables (waitlist, email, analytics…)
(bell docked right, non-sticky).          admin check = customClaims.role === 'admin'
Draft table filters title by a            (see purgeEmailLogs.ts).
>= / <=  prefix range query.        No wildcard collection triggers exist today.
                                          Draft saves fire nothing server-side.
```

Key facts the plan exploits:
- Per-type collections mean a cross-type search needs its own collection (S-D1).
- The publish queue is the one place published documents are written, so it can write
  the published index in the same operation (S-D12).
- Drafts are only written by the browser, so the drafts index needs a trigger (S-D13).
- `<arc-language-switcher>` already proves the "placeholder in partial, injected at
  render, mirrored by an SPA component" pattern (S-D16).
- Static strings for public chrome live in `public/i18n/{lang}/strings.json` (M-D18);
  the widget's placeholder and empty-state text go there.
- Callables are reachable from plain `fetch` with the `{ data }` envelope, so the static
  widget needs no Firebase SDK.

---

## 2. Working protocol (applies to every phase)

- **No emulators.** `npm run dev` (localhost:5173) talks to the **real dev Firebase
  project**. Functions / rules / indexes changes are invisible until deployed:
  - functions only: `cd functions && npm run build && firebase deploy --project default --only functions[:name] --non-interactive --force`
  - rules: `firebase deploy --project default --only firestore:rules`
  - indexes: `firebase deploy --project default --only firestore:indexes`
  - full: `npm run deploy:dev` (build + functions + hosting + seed), needed when hosting
    assets (partials, the widget script) changed.
- **Per-phase report.** On completing a phase, report: (1) what was done, (2) exact
  manual test steps for the user, (3) what the next phase will do. Then **test it in the
  browser** before reporting.
- **Admin access for browser testing:** open `localhost:5173/signup` and the user logs in
  as admin. Login persists across dev-server restarts. Do not log out.
- **Tests** run from the repo root: `npm run test` (Vitest; frontend + functions together).
- **New admin pages need an explicit route in `app.routes.ts`**; file-based-only admin
  pages render the public "Content Not Found" page (HTTP 200, so status checks lie).
- Page and component specs that render `arc-page-header` must spread
  `...headerTestProviders()` first in their providers (see `src/test/header-test-providers.ts`).
- No em dashes or en dashes in any user-facing text, docs or commit messages.
- Each phase ends in its own commit(s); a phase is not "done" until browser-verified.

---

## 3. Phases

### Phase S1: Engine core (M)

**Goal:** the tokenizer, the source registry, the index model and the three write paths
exist and are tested, with no source registered yet.

1. **Tokenizer** `functions/src/search/tokenizer.ts` (pure, no Firestore):
   - `normalize(text)`: NFKC, lowercase, Latin-only mark stripping (S-D6), apostrophes
     removed (`karun's` → `karuns`), every other punctuation and symbol replaced by a
     space.
   - `tokenize(text, { prefix, maxWords })`: split on whitespace, drop tokens shorter
     than 2 characters, drop a small English stop list (about 40 words, no other
     language), dedupe, keep the first `maxWords` words (default 80). With `prefix`,
     add every prefix of each token from length 2 up to `min(len - 1, 12)`.
   - `queryTokens(q)`: same normalization, no prefixes, at most 10 tokens (the longest
     ones when more are typed, since long words are more selective), stop words removed
     unless the query is nothing but stop words.
   - Total tokens per entry are capped at 600; title fields are tokenized first so the
     cap only ever trims later fields.
2. **Source model** `functions/src/search/source.ts`:
   ```ts
   interface SearchSource {
       id: string;                           // 'content', 'directory', …
       collection: string | RegExp;          // 'Directory' or /^arc_(.+)_drafts$/
       scope: 'public' | 'authenticated' | 'admin';
       fields: { path: string; weight: number; prefix?: boolean }[];
       display: (doc, ctx) => { title; snippet?; badge?; link; meta? };
       lang?: (doc, ctx) => string | string[];   // default '*'
       variants?: (doc, ctx) => Promise<{ lang; doc }[]>; // multilingual sources
       include?: (doc, ctx) => boolean;      // default true
       boost?: number;                       // default 1
       expandCollections?: () => Promise<string[]>; // for RegExp sources, used by reindex
   }
   ```
   `ctx` carries the collection name, the document ID and cached site settings
   (localization, content types) so a source never has to fetch them itself.
3. **Registry** `functions/src/search/registry.ts`: exports `SEARCH_SOURCES: SearchSource[]`
   and `findSource(collectionId)`. Empty in this phase apart from a test fixture.
4. **Index entry** written to `SearchIndex/{sourceId}:{docId}:{lang}`:
   ```ts
   {
       source, scope, lang, collection, docId,
       tokens: string[],
       fields: Record<string, string>,   // the indexed text per path, first 500 chars, for ranking and highlighting
       title, snippet, badge, link, meta,
       sortAt: Timestamp,                 // publishedOn, modifiedAt or createdAt, source's choice via display.meta.sortAt
       indexedAt: Timestamp,
   }
   ```
5. **Writer** `functions/src/search/writer.ts`: `buildEntries(source, doc, ctx)`,
   `upsertSearchEntries(source, docId, entries)` (batch set, and delete of any language
   entry that is no longer produced), `removeSearchEntries(sourceId, docId)`.
6. **Generic trigger** `functions/src/search/onAnyDocumentWritten.ts`:
   `onDocumentWritten('{collection}/{docId}')`. Looks up every matching source (a
   collection may feed several), builds entries on create/update, removes on delete or
   when `include` returns false. Exported from `index.ts`.
7. **Reindex callable** `functions/src/search/reindexSearch.ts`: admin only
   (`customClaims.role === 'admin'`, same check as `purgeEmailLogs`). Input
   `{ source?: string }`. Iterates the source's collections (expanding patterns via
   `expandCollections`), rebuilds every entry, deletes orphans whose documents are gone,
   and writes `Settings/search_status` with per-source counts and timestamps.
8. **Firestore**: rules deny all client access to `SearchIndex`; `Settings/search_status`
   admin read, function write. Two composite indexes on `SearchIndex`:
   `(scope ASC, lang ASC, tokens CONTAINS, sortAt DESC)` and
   `(scope ASC, source ASC, lang ASC, tokens CONTAINS, sortAt DESC)`.
9. **Tests**: tokenizer spec driven by the examples table in Appendix B; writer spec
   with a mocked `db`; trigger spec proving an unregistered collection performs no reads
   or writes.

**Deploy:** rules, indexes, functions.
**Manual test:** none visible yet; Firestore console shows no `SearchIndex` documents and
the deployed function list includes `onAnyDocumentWritten` and `reindexSearch`.
**Exit criteria:** tests green; deploying the wildcard trigger causes no errors in the
function logs during normal admin use.

### Phase S2: Content sources (M)

**Goal:** every published item and every draft is in the index, per language.

1. **Shared builder** `functions/src/search/sources/content-fields.ts`: given a content
   document, its content type and a language, returns the field texts: `title` (weight 3,
   prefix), `summary` (weight 2, prefix), and each key in `ContentType.searchFields`
   whose field type is `text` (weight 1, prefix). Uses `mergeTranslation` from
   `functions/src/shared/content-translation.ts` so a language without a translated field
   indexes the default-language text.
2. **`content` source** (published): `collection: /^arc_(?!.*_drafts$).+$/`, scope
   `public`, `include` false when the content type has `hasPublicUrl === false`,
   `variants` yields the default language plus one entry per translation document under
   `translations/`, `display.link` is `/{ctSlug}/{urlSlug}` with the `/{lang}` prefix for
   non-default languages, `badge` is the content type name in that language
   (`nameTranslations`), `sortAt` is `publishedOn`.
3. **`content-drafts` source**: `collection: /^arc_(.+)_drafts$/`, scope `admin`,
   `display.link` is `/admin/contents/{ctSlug}/edit/{id}`, `badge` is the content type
   name plus a "Draft" or "Published" state derived from `publishedStatus` and
   `lastPublishedAt`, `sortAt` is `modifiedAt`. Indexed by the generic trigger.
   Saving a draft always rewrites the base document (M-D14), so reading the
   `translations` subcollection on the base write is enough; no subcollection trigger.
4. **Publish pipeline**: `processPublishQueue.ts` calls `upsertSearchEntries` for the
   `content` source after copying a draft on `publish` and `update`, and
   `removeSearchEntries` on `unpublish` and `delete`. `redeploy-all` also reindexes the
   `content` source. The generic trigger would catch these writes too; the explicit call
   is there so a failed index write surfaces in the publish log.
5. **Content type editor**: a "Searchable custom fields" multi-select listing the type's
   `text` fields, saved to `searchFields`. Changing it queues a reindex of both content
   sources for that type (small callable input: `{ source, collection }`).
6. **Admin Settings → Search** page `src/app/pages/admin/(settings)/search/` with an
   explicit route: lists registered sources with entry counts and last reindex time from
   `Settings/search_status`, one "Reindex" button per source and one for all. Add the
   card to the settings hub.
7. **Backfill**: run "Reindex all" once on the dev project after deploy.

**Deploy:** functions, rules (settings doc), hosting (admin page).
**Manual test:** publish an article; Firestore shows `SearchIndex/content:{id}:en` with
the expected tokens. Add a Hindi translation and republish; an `:hi` entry appears with
Hindi title tokens and, if the summary is untranslated, the English summary tokens. Edit a
draft; `content-drafts:{id}:en` updates within a few seconds. Delete the draft; both
entries disappear. Settings → Search shows counts and reindex works.
**Exit criteria:** counts in `search_status` equal the number of documents times
languages for each source.

### Phase S3: The `search` callable (M, the core)

**Goal:** a ranked, scoped, language-aware query endpoint.

1. **Contract** `functions/src/search/search.ts`, `onCall` named `search`:
   ```ts
   // request
   { q: string; lang: string; scope: 'public' | 'admin'; sources?: string[]; limit?: number }
   // response
   { results: SearchResult[]; tookMs: number; fallbackUsed?: string }
   interface SearchResult {
       source: string; docId: string; lang: string;
       title: string; snippet?: string; badge?: string; link: string; meta?: Record<string, unknown>;
       score: number;
       highlights: { title: [number, number][]; snippet: [number, number][] }; // character ranges
   }
   ```
   `q` is trimmed and capped at 120 characters; `limit` defaults to 8 and caps at 20;
   at most 5 `sources`; an empty or stop-word-only query returns no results without a
   database read.
2. **Scope check**: `public` scope may only touch `public` sources. `admin` scope
   requires an authenticated admin and may touch any source. `authenticated` sources are
   reachable by any signed-in caller through `scope: 'admin'` requests that name them
   explicitly (kept simple until a product needs finer control).
3. **Candidate fetch**: for each (source or "all sources in scope") and each of
   `[lang, '*']`, one query: equality filters, `array-contains-any` on the query tokens,
   `orderBy sortAt desc`, `limit 50`. All queries run in parallel; results are merged by
   entry ID.
4. **Ranking**, in order of importance, implemented as one numeric score:
   1. Number of distinct query tokens matched. A candidate matching every token gets a
      bonus equal to the sum of all field weights.
   2. Field weight of each match, using the source's `fields` weights against the stored
      `fields` text, re-tokenized at query time.
   3. Whole-word match scores 1.0, prefix match 0.6.
   4. Phrase bonus of twice the heaviest weight when the normalized query appears
      verbatim in the normalized title.
   5. Coverage: matched tokens divided by title token count, as a small additive term.
   6. Multiply by the source `boost`. Ties break on `sortAt` desc.
5. **Typo fallback** per S-D9. The response reports which shortened token was used so
   the UI can say "Showing results for gunja".
6. **Highlights**: character ranges of matches inside `title` and `snippet`, computed
   against the original strings by mapping normalized token positions back. The UI never
   re-implements matching.
7. **Tests**: ranking spec over a fixed candidate set covering every row in Appendix B;
   scope spec proving a public caller cannot read an admin source even by naming it;
   fallback spec.

**Deploy:** functions.
**Manual test:** call the function from the browser console with `httpsCallable` for
each Appendix B row and confirm the ordering.
**Exit criteria:** every Appendix B expectation holds against the dev project data.

### Phase S4: Admin header search (S)

**Goal:** from any admin page, type to find any draft and open its editor.

1. **`SearchService`** `src/app/core/services/search.service.ts`: wraps the callable,
   debounces 250 ms, ignores queries under 2 characters, drops out-of-order responses,
   caches results per (query, lang, scope, sources) for the session.
2. **`arc-search-box`** `src/shared/components/search-box/`: input with a dropdown of
   up to 8 results, keyboard navigation, highlighted matches from `highlights`, badge per
   result, "Showing results for …" line when the fallback fired, empty state text, Enter
   goes to the results page. Inputs: `scope`, `sources`, `lang`, `placeholder`. Output:
   `picked`. Self-contained styles, works inside `.arc-admin` and the user shell.
3. **`arc-page-header`**: renders `arc-search-box` beside the bell when the signed-in
   user is an admin and `showSearch` (default true) is on. `scope: 'admin'`,
   `sources: ['content-drafts']` by default. `Cmd+K` / `Ctrl+K` focuses it. Spec updates
   for the header and `headerTestProviders()` gain a `SearchService` mock.
4. **Results page** `/admin/search` (explicit route): full list of 20 with the same
   rendering, driven by the `q` query parameter.
5. Transloco keys for placeholder, empty state, fallback line and the results page title.

**Deploy:** hosting only (S3 function already deployed).
**Manual test:** from the dashboard press `Cmd+K`, type `kar`, see "Gunjan Karun" under
People, arrow down, Enter, land in the editor. Type gibberish, see the empty state.
**Exit criteria:** works on every admin page including settings sub-pages; no console
errors; specs green.

### Phase S5: Public site search (M)

**Goal:** visitors get type-ahead in the site header, on static pages and on the SPA
fallback, in the language they are viewing.

1. **Widget script** `public/assets/js/arc-search.js` (plain JS, no framework, about
   150 lines): reads `data-lang`, `data-endpoint`, `data-results-url` and the string
   attributes from its root element, debounces, calls the callable through `fetch` with
   the `{ data }` envelope, renders the dropdown, handles keyboard navigation, submits to
   the results page on Enter. Styles in `public/assets/css/arc-search.css`.
2. **Server injection**: `buildSearchWidget(lang, strings, endpoint)` in
   `functions/src/shared/html-document.ts`, wired exactly like `buildLanguageSwitcher`:
   `<arc-search>` in a partial is replaced with the root element and one deferred
   `<script>` plus one stylesheet link per page. The endpoint is derived from the project
   ID and function region at render time. Placeholder and empty-state strings come from
   `public/i18n/{lang}/strings.json` (`search_placeholder`, `search_empty`,
   `search_showing_for`), English defaults inline.
3. **Header partial**: add `<arc-search>` to `public/_partials/_header.html` inside
   `.site-header__actions`. Sites that do not want search delete the tag.
4. **SPA fallback**: Angular `arc-search` component in `src/app/pages/page.parts/`,
   registered the way `arc-language-switcher` is, rendering `arc-search-box` with
   `scope: 'public'` and the page language from `LocalizationService`.
5. **Results page** `/search` and `/{lang}/search` (SPA routes): 20 results, same
   rendering as the admin results page but with public links and the site header/footer.
6. **Redeploy**: the widget only appears on pages rendered after this ships, so run
   `redeploy-all` from the publish queue on the dev project.

**Deploy:** `npm run deploy:dev` (hosting assets and partials changed), then redeploy-all.
**Manual test:** on a static article page type `kar`, see results with the content type
badge, click one, land on the article. Switch to `/hi/`, search a Hindi title, see the
Hindi entry. Load a draft preview (SPA fallback), confirm the same widget works. Press
Enter, land on `/search?q=kar`.
**Exit criteria:** works with the Angular bundle absent (static page) and present (SPA);
Lighthouse shows no layout shift from the widget.

### Phase S6: Developer guide and a second source (S)

**Goal:** a developer can add a source in under an hour without reading the engine.

1. `docs/search-developer-guide.md`: what a source is, the `SearchSource` interface with
   every field explained, the worked example of a `Directory` collection with `name`,
   `tagline` and `city`, how to pick weights, how scope works, how to reindex, how to
   put `<arc-search-box [sources]="['directory']">` on a page, the one review rule
   ("`display` output is what the client sees, so never put private fields there"), and
   the limits (600 tokens per entry, 30 query tokens, 5 sources per call).
2. `functions/src/search/sources/_template.ts`: a commented copy-and-rename source file.
3. Prove the guide by following it: register a throwaway `Products` source on the dev
   project (the `Products` collection exists and is public-read), search it from the
   admin header with `sources: ['products']`, then decide whether to keep it or remove it
   before merge.

**Deploy:** functions if the sample source stays.
**Exit criteria:** the guide was followed verbatim to add the sample source and needed
no correction.

---

## 4. Sequencing & dependencies

```
S1 ──▶ S2 ──▶ S3 ──▶ S4 ──▶ S5 ──▶ S6
              └──────────────▶ S6 (the guide only needs S1 and S3)
```

Strictly linear for the content track. S4 before S5 because the admin header is the
cheaper place to shake out the search box component, and admins are the more forgiving
audience for the first cold starts.

## 5. Reversibility & risk notes

- Every phase is additive. No content document changes shape. `SearchIndex` can be
  deleted and rebuilt from the reindex tool at any time, so a bad tokenizer change is a
  reindex away from fixed.
- The wildcard trigger is the one cross-cutting deploy. If invocation counts surprise
  anyone, the fallback is explicit triggers per known collection plus the publish
  pipeline, losing only automatic coverage of newly created content types until the next
  deploy.
- The public callable is unauthenticated. Query length, token count, result count and
  source count are capped, and every query reads at most 100 documents, so the worst case
  per call is bounded. Abuse protection beyond that (App Check, per-IP limits) is a
  non-goal for now and listed here so it is not forgotten.
- Candidate cap: 50 per query, ordered by recency, means a very common word on a site
  with thousands of items could crowd out a better older match. Not a concern at this
  product's scale. The fix, if ever needed, is a token frequency document that lets the
  function query rarer tokens first.
- Cold start on the public site is the most visible risk (S-D19). Measure before paying
  for `minInstances`.
- `no-emulator` reality: every functions phase needs a real deploy before browser
  verification, or the browser test gives false negatives.

---

## Appendix A: Index and query shapes at a glance

```
SearchIndex/content:abc123:en
  source: 'content'   scope: 'public'   lang: 'en'   collection: 'arc_people'   docId: 'abc123'
  tokens: ['gunjan','gu','gun','gunj','gunja','karun','ka','kar','karu', …summary tokens…]
  fields: { title: 'Gunjan Karun', summary: 'Founder of …' }
  title: 'Gunjan Karun'   snippet: 'Founder of …'   badge: 'People'   link: '/people/gunjan-karun'
  sortAt: 2026-09-01T…   indexedAt: …

search({ q: 'kar', lang: 'en', scope: 'public' })
  → queries: (scope=public, lang=en, tokens any ['kar'])  and  (scope=public, lang=*, tokens any ['kar'])
  → rank → { results: [{ title: 'Gunjan Karun', highlights: { title: [[7,10]] }, … }] }
```

## Appendix B: Expected behaviour (drives the tokenizer and ranking specs)

Fixtures: **A** title "Gunjan Karun". **B** title "Firebase Hosting Guide", summary
"Written by Gunjan Karun in 2024". **C** title "Interview: Gunjan on Firebase".

| Query | Expected order | Why |
|---|---|---|
| `kar` | A, B | Title prefix hit outranks summary prefix hit |
| `Karun Gunjan` | A, B, C | Order-free; A and B match both tokens, C one |
| `gunjan fire` | C, B, A | C and B match both; C has both in the title |
| `GUNJÁN` | A, B, C | Lowercased, Latin accents folded |
| `karun's` | A, B | Apostrophe removed to `karuns`; `karun` is its prefix, so both directions match |
| `arun` | none | Infix matching is unsupported by design |
| `gunjam` | A, B, C with fallback `gunja` | Zero results, last token shortened once |
| `the` | none | Stop words dropped, empty query, no read |
| `2024` | B | Numbers are ordinary tokens |
| `firebase hosting guide` | B, C | B matches all three in the title; C matches one |
| `Gunjan Karun` | A, B | Phrase bonus puts the exact title first |
| `गुंजन` (Hindi, on `/hi/`) | the Hindi entry only | Devanagari marks untouched, language filter honoured |

## Appendix C: Source registration example

```ts
// functions/src/search/sources/directory.ts
export const directorySource: SearchSource = {
    id: 'directory',
    collection: 'Directory',
    scope: 'public',
    fields: [
        { path: 'name', weight: 3, prefix: true },
        { path: 'tagline', weight: 2, prefix: true },
        { path: 'city', weight: 1 },
    ],
    display: doc => ({
        title: doc.name,
        snippet: doc.tagline,
        badge: 'Directory',
        link: `/directory/${doc.slug}`,
        meta: { sortAt: doc.createdAt },
    }),
    include: doc => doc.status === 'active',
};
// then add it to SEARCH_SOURCES in registry.ts and run Reindex from Settings → Search.
```
