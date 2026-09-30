# ArcCMS Content Pipeline: Build Spec (Claude-generated content, reviewed, scheduled)

**Status:** discussion completed 2026-09-23. Nothing built. Phases are built one at a time; each
ends with a report, a deploy of functions and rules to the dev project, and a browser check at
localhost:5173 before the next starts.
**Branch:** `feat/content-pipeline`, cut from `feat/discoverability` (the gate is the D6
checklist, the output shape is the D4 blocks and D-D11 references, bylines are D2 authors).
**Scope:** turn a list of briefs into citable, source-backed pages with Claude, land them in
ArcCMS as drafts that must pass the Checks gate, have a person approve them, and publish them on
a cadence or at times set by hand. Expected volume: about 30 pieces a month on one site.

**How this squares with the discoverability spec.** That spec rules out "bulk generation of
filler content with an LLM", permanently. This pipeline is not that, and the decisions below
exist to keep it that way: every item starts from a brief, cites sources retrieved while writing,
carries a real person's name, passes the Checks gate, and is approved by an admin before it can
be scheduled. Volume is capped per day. Google's spam policy on scaled content targets pages
made at volume primarily to rank, whatever made them; the pipeline is built to stay on the right
side of that line, not to hide from it.

**Out of scope, permanently:** publishing anything generated without an admin approval; creating
authors from model output; fabricated reviews, ratings, testimonials, quotes or statistics;
automatic `updatedOn` bumps; machine translation (M-D12 stands); keyword-list-to-hundreds-of-pages
"programmatic SEO"; rewriting or "spinning" existing pages. **Out of scope for this spec:**
generated images; a public "AI-assisted" label (decided off, C-D11); the Claude Batch API (not
worth it at 30 a month, C-D19).

---

## 0. Decision log

| # | Decision | Choice |
|---|----------|--------|
| C-D1 | What the pipeline is | Brief in, reviewed draft out, scheduled publish after. Three stages with a hard stop between the second and third: generated content cannot reach the publish queue without an admin approving that item (C-D9). |
| C-D2 | Where generation runs | **Outside ArcCMS first, through a prompt kit.** ArcCMS builds a prompt for the chosen content type; the admin pastes it into Claude (claude.ai with web search on, or Claude Code), adds the brief, and brings the JSON back into the importer. No API key in the product, no cost to the product, works on a fresh site with no settings. In-product generation (C6) comes later and reuses the same prompt builder as its system prompt, so the kit is the foundation, not a throwaway. |
| C-D3 | The prompt is built from the model, not written by hand | One pure function, `buildGenerationPrompt(input)` in `src/shared/utils/content-prompt.ts`, assembles: site identity (`Settings/about`), the content type (singular name, custom fields with types and required flags, the D5 schema mapping so a Products type asks for price and currency), authors and the default author, existing tags for the type, up to 150 most recent published pages (title and URL, for internal links and to avoid repeat topics), the block contracts (C-D7), the gate rules (C-D8), the hard content rules (C-D18), the output schema (C-D6) and the brief. Deterministic output, snapshot-tested, stamped with `promptVersion`. A change to a content type changes its prompt with no one editing text. |
| C-D4 | The input unit is a brief | Minimum: one reader question per line; one line is one item. Optional columns per line: audience, angle, facts that must appear, sources to use, target phrase, author, publish time. The prompt tells Claude to infer anything left blank and to say in `notes` what it inferred. A plain list of questions is enough to get a first result; a fuller brief gets a better one. |
| C-D5 | Facts and sources | Web search at generation time plus whatever the owner pastes in (product data, docs, past posts). Model memory alone is never a source. The prompt requires every `references` URL to be one Claude retrieved in that session; if there is none, the list stays empty and the item says so in `notes` (the `sources` rule then fails the gate). Each numeric, dated or named claim is listed in a private `claims: [{claim, sourceUrl}]` array for the reviewer. At review (C4) every reference URL is fetched and non-2xx results are flagged. The spec does not pretend this verifies truth: a live link proves the source exists, not that it supports the claim. The reviewer is the fact check. |
| C-D6 | JSON is the pipeline's import format | A versioned envelope, `{ "format": "arccms.content.v1", "contentType", "promptVersion", "items": [...] }` (full shape in section 3). The Bulk Import dialog accepts it as a `.json` file or pasted text (the claude.ai flow is copy and paste). When the envelope is recognised the mapping step is skipped. Unknown keys are reported and ignored; a missing required field fails that item only. CSV stays as it is for spreadsheets. |
| C-D7 | Imported HTML passes through the editor's schema | The body is parsed with Tiptap's `generateJSON` and re-serialised with `generateHTML` using the editor's own extension list (extracted from `tiptap-editor.component.ts` into a shared module so editor and importer cannot drift). Whatever the editor cannot represent is dropped before the draft is saved: no scripts, no stray attributes, no markup the editor would silently lose on first open. The block contract given to Claude is the shape the D-D10 extractor reads: `<section data-arc-block="faq">` with h3 questions and the answer after each; `howto` with a heading then one `ol` (a leading `<strong>` names a step); `takeaways` with one list; `definition` with a "What is X?" heading then one paragraph. |
| C-D8 | "Optimised" means passing the Checks gate | The gate is `evaluateDiscoverability` from `src/shared/utils/discoverability-checklist.ts`, run in the importer (a browser, so every rule runs). Pass = score of at least 80 **and** all of `answer_first`, `question_heading`, `blocks`, `meta_description`, `author`, `sources`. Advisory only: `internal_links` (a small site cannot give three links per page), `cover_image`, `length`, `freshness`. Failing items still import, as drafts marked *Needs work*, and cannot be approved until they pass. The rule text inside the prompt is generated from the same rule ids (`CHECKLIST_RULE_BRIEFS`, with a test that every rule has a brief), so the prompt and the gate cannot disagree. Kit mode: the prompt asks Claude to check itself before answering; there is no loop. API mode (C6): at most one repair call given the failing rules, then stop. |
| C-D9 | Review is mandatory | Generated items land as drafts with review state *Pending*. The review queue (C4) shows score, failing rules, link check, possible duplicates, claims and Claude's notes. **Approve** puts the item in the next free slot (C-D12), **Approve at…** sets a time, **Approve all passing** approves every pending item that passes the gate and touches no sensitive topic (C-D18). There is no auto-publish setting. |
| C-D10 | A real person stands behind every piece | Author = the brief's author if it names an existing author, otherwise the default author (the admin, per D-D5a). **The JSON import matches authors, it never creates them**: an unknown name falls back to the default author with a warning. The CSV importer's create-by-name (D2) stays, because a spreadsheet row is typed by a person; model output could invent one. |
| C-D11 | No public disclosure; provenance is private | Nothing on the page says "AI". Provenance (brief line, prompt version, import time, reviewer, approval time), claims and notes live in an admin-only subcollection, `arc_{slug}_drafts/{id}/pipeline/record`. The publish pipeline copies only the draft document, so none of it can reach the public `arc_{slug}` collection. |
| C-D12 | Scheduling: a time per item, a cadence per site | Draft gains `publishAt`, present **only while the item is scheduled** (a pending item's requested time waits in its pipeline record). `Settings/publishing` holds `timezone`, `cadence: { days, times }`, `dailyCap`, `paused`. Defaults, seeded on first use with no setup: every day at 09:00, `dailyCap` 3, timezone taken from the admin's browser (`Intl` resolved zone). Sized for ~30 a month. A pure allocator, `nextFreeSlots(settings, taken, count, now)`, fills slots in order, one item per slot, never above the daily cap, never less than an hour ahead. A time set by hand (in the JSON, the review queue or the editor) wins over the cadence; exceeding the cap that way warns but is allowed. Scheduling also works for hand-written content from the editor. |
| C-D13 | One Hosting release per scheduler run | Releases are built from the previous release's file list, so two finishing close together drop each other's files (`_todo.md` 3c). The scheduler therefore writes **one** queue item per run with a new action, `publish-many`, carrying `items: {contentTypeSlug, docId}[]`. It publishes each document, rebuilds each affected list page once, then sitemap, feeds and discoverability files once, one release, one IndexNow ping. Bulk Import's "Publish now" switches to `publish-many` too, which fixes the same race there today. The single-item `publish` and `publish-many` share one extracted `publishOne()` so they cannot drift. |
| C-D14 | Failure and downtime | The scheduler claims due items (`scheduleState: 'publishing'`, `scheduleAttempts + 1`, `scheduleClaimedAt`). A successful publish clears `publishAt` and the schedule fields with a narrow update that leaves `modifiedAt` alone (the Published/Edited badge depends on it). An item still claimed after 15 minutes is retried; after three attempts it becomes *Failed* and every admin is notified through `notifyAdmins`. Items more than 24 hours overdue (scheduler down, site paused) are moved to fresh slots rather than published in a burst, mirroring `processScheduledBroadcasts`. `paused: true` stops the scheduler without touching slots; on resume, overdue items are moved to fresh slots. |
| C-D15 | Freshness stays honest | The pipeline never sets `updatedOn`. Each generated item gets `reviewBy` = publish date + 12 months (matching the `freshness` rule), or + 6 months when Claude marks it `volatile` (prices, versions, "this year" facts). Items past `reviewBy` appear under *Due for review* in the review queue and as a line in the admin digest. Marking one updated is still the author's explicit act in the SEO tab. |
| C-D16 | Cover images | Claude returns `coverImageQuery` and `coverAlt`. On import, resolution is: media library item whose tags match, then Unsplash through the existing `searchUnsplash` callable when `Settings/integrations.unsplash` is configured, then no cover (`cover_image` is advisory). The Unsplash path must meet Unsplash's API terms (hotlinked URL, attribution, download tracking); confirm the existing integration does before relying on it. No generated images. |
| C-D17 | Default language only | M-D12 (no machine translation) stands. The pipeline writes the base document; translations stay hand-authored in the existing subcollection. |
| C-D18 | Guardrails | **Duplicates:** at review, each item's title and tags run through the admin search callable (the D-D16 path, drafts included) and near matches are shown; slugs are checked against the type and within the batch at import (`checkExistingSlugUrl`, which the importer does not call today), with a numeric suffix offered. **Sensitive topics:** `Settings/publishing.sensitiveTopics` (keywords; empty by default, with medical, legal and financial offered as one-click presets). A matching item is excluded from *Approve all* and needs its own approval with a confirmation. **Content rules in every prompt:** no reviews, ratings or testimonials; no quotes attributed to named people without a source; no statistics without a source; no claims about competitors. **Kill switch:** `paused`. **Volume:** `dailyCap`. |
| C-D19 | Cost and volume | ~30 a month. Kit mode costs the product nothing (it runs on the owner's Claude plan). API mode (C6) makes one interactive call per item with web search enabled; the Batch API is not used at this volume. Per-piece cost is estimated at C6 from current published pricing, not guessed here; web search results can outweigh the article itself in input tokens. |
| C-D20 | API mode sends the kit's prompt | In C6 the browser builds the prompt with the same `buildGenerationPrompt` and an admin-only callable adds the key, the web search tool and output parsing. No mirrored prompt builder in functions, so there is one source of truth. The key is written through a callable and never readable by the client. |

### Explicit non-goals (deferred or permanently out)
Auto-publish without review · creating authors from generated output · public AI disclosure ·
machine translation · generated images · Batch API · automatic `updatedOn` · topic clustering or
keyword research tooling · rewriting existing pages · social posting on publish · per-item cost
dashboards (revisit after C6 if the API mode is used).

---

## 1. Current architecture (what this builds on)

```
IMPORT (browser)
bulk-import-dialog  →  BulkImportService.parseFile (xlsx: CSV/XLSX only)
                    →  autoMapColumns → mapping step → validateRow (title, required
                       custom fields, types) → buildContentItem → resolveAuthors
                       (match OR CREATE by name) → DraftContentsStore.addBatch
                    →  "Publish now": one _publish_queue item PER document (races)
No references, no JSON, no HTML sanitising, no slug-collision check, no Checks gate.
The mapping dropdown lacks SEO title, meta description, canonical URL and author.

PUBLISH (functions)
_publish_queue/{id} onCreate → processPublishQueue: publish | update | unpublish |
  delete | redeploy | redeploy-all. Copies the WHOLE draft doc to public arc_{slug},
  sets publishedOn = now, one HostingBatch → one release → IndexNow.
No scheduling. No multi-document action other than redeploy-all.

QUALITY                               SCHEDULERS (pattern to copy)
evaluateDiscoverability: 13 weighted  processScheduledBroadcasts: every 5 min,
rules, pure, needs DOMParser           claims due docs, parks >24h overdue.
(browser), score 0 to 100.            notifyAdmins (adminAlerts.ts) + admin digest.

BLOCKS                                MEDIA
extractBlocks (content-blocks.ts)     searchUnsplash callable, keys in
reads section[data-arc-block] shapes  Settings/integrations; media library.
```

Key facts the plan exploits:
- The checklist is pure and browser-safe, and the importer runs in the browser, so the gate
  needs no backend.
- The block extractor reads plain HTML shapes, so Claude can write them directly.
- The publish queue is the only road to Hosting; one new action gives scheduling a race-free
  path.
- Publish copies the draft document but no subcollection except `translations`, which it syncs
  explicitly, so a subcollection is a natural private home for provenance.

---

## 2. Phases

Each phase: build with unit tests → `npm run test` → report → deploy functions and rules to the
dev project (never hosting) → verify at localhost:5173 → next phase. New admin pages get explicit
routes in `app.routes.ts`.

### C1. JSON import and the quality gate
**Goal:** a correctly shaped JSON file becomes gated drafts in one step.

- `arccms.content.v1` parser and validator (pure, `src/shared/utils/content-import.ts`):
  envelope check, per-item errors, unknown-key warnings.
- Bulk Import step 1 accepts `.json` and has a **Paste** tab; a recognised envelope skips mapping.
- HTML sanitising through the editor schema (C-D7); editor extensions moved to a shared module.
- Gate column in the preview: score, failing must-pass rules; failing items import as
  *Needs work*.
- `references` imported; authors matched only (C-D10); slug collisions checked against the type
  and the batch, with a suffix offered.
- `pipeline/record` subcollection written per item (brief line, prompt version, claims, notes,
  requested publish time, review state `pending` or `needs_work`); rules admin-only, including the
  collection-group rule; collection-group field override for `reviewState`.
- While here, CSV fixes: SEO title, meta description, canonical URL and author in the mapping
  dropdown; a `references` column (`title | url` pairs, one per line).

**Verify:** paste a hand-written two-item envelope: one passes and lands as *Pending*, one missing
its FAQ lands as *Needs work* with `blocks` named; a `<script>` in the body is gone from the saved
draft; an unknown author name falls back to the default author with a warning; a repeated slug
is offered `-2`; the `pipeline/record` doc exists and a non-admin signed-in user cannot read it;
the published copy of an item, once published by hand, has no `claims` field anywhere.

### C2. The prompt kit
**Goal:** from a fresh site, one button gives a prompt that produces importable, gate-passing JSON.

- `buildGenerationPrompt` (C-D3) with snapshot tests per content-type shape (plain article, a type
  with required custom fields, a Products type with D5 mapping).
- `CHECKLIST_RULE_BRIEFS` beside the checklist, with a completeness test.
- **Generate with Claude** button beside Bulk Import on the content list: brief box (one question
  per line), optional "Add details" columns, **Copy prompt**, **Download as a Claude Code skill**
  (the same text as `SKILL.md`), and three numbered steps ending in **Import the result**, which
  opens Bulk Import on the Paste tab. Guidance in the dialog: 5 to 10 items per claude.ai
  conversation to stay within output length.
- The prompt ends by asking for the JSON only, in one code block, so copying is one action.

**Verify:** copy the prompt for Articles, paste into claude.ai with web search on, give three
questions, paste the answer back: three items import, at least two pass the gate unchanged, each
has live references and at least one internal link to an existing page. Repeat for a type with a
required custom field: the field is filled. Change the content type (add a field) and the prompt
changes with it.

### C3. Scheduled publishing
**Goal:** approved items publish on the cadence or at hand-set times, one release per run.

- `Settings/publishing` (C-D12) with seeded defaults; **Settings → Publishing** page: cadence
  (days, times), timezone, daily cap, pause switch, and an *Upcoming* list across content types.
- `nextFreeSlots` allocator and `zonedTimeToUtc` helper (pure, `Intl`-based; tests across a DST
  change in Europe/London and America/New_York, and Asia/Kolkata).
- `publish-many` action and the extracted `publishOne()` (C-D13); publish, update and publish-many
  strip draft-only fields (`publishAt`, `scheduleState`, `scheduleAttempts`, `scheduleClaimedAt`,
  `reviewBy`) from the public copy; Bulk Import "Publish now" uses `publish-many`.
- `processScheduledPublishing` every 5 minutes: per content type, `publishAt <= now` (single-field
  index, so no per-type composite indexes), claim, retry, fail, re-slot, respect `paused`
  (C-D14); `notifyAdmins` on failure.
- Editor: the Publish button gains **Schedule…**; the content list shows a *Scheduled* badge with
  the time; unscheduling clears `publishAt`.

**Verify:** schedule two hand-written items five minutes apart and one at the same minute as
another: the function logs one release per run containing all due items, every page is live
after both runs (none dropped); `publishedOn` equals the run time; the public docs carry no
schedule fields; pause, let a slot pass, resume: the item moves to a fresh slot instead of
publishing late; point an item at a deleted template to force failures: after three attempts it
shows *Failed* and the bell has an alert.

### C4. Review queue
**Goal:** one screen to judge and approve a batch.

- `/admin/contents/review` (explicit route, sidebar under Content): pending and needs-work items
  across types via the `pipeline` collection group; columns for type, title, score, failing
  must-pass rules, link check, duplicates, claims count.
- Side panel: rendered preview, claims with their source links, Claude's notes, possible
  duplicates with links.
- `checkReferenceLinks` admin callable: fetches each URL (http and https only, 10-second timeout,
  redirects followed, private address ranges refused), returns status per URL; results cached on
  the record.
- Actions: Approve (next slot), Approve at…, Open in editor, Reject (deletes the draft and its
  record, with confirmation), Approve all passing (skips sensitive-topic matches).
- Sensitive topics setting on the Publishing page with presets (C-D18). Editing a pending item in
  the editor re-runs the gate on save and moves it between *Needs work* and *Pending*.

**Verify:** import five items including one with a dead reference, one duplicating a published
page's topic and one mentioning a sensitive keyword: the queue flags each correctly; *Approve all
passing* schedules the clean ones into consecutive slots and leaves the sensitive one; approving
it individually asks for confirmation; reject removes draft and record.

### C5. Covers, freshness reminders, guides
**Goal:** the last manual chores are handled, and the process is written down.

- Cover resolution at import (C-D16): media library by tag, then Unsplash if configured and
  compliant, else none; `coverAlt` applied.
- `reviewBy` stamped at publish for pipeline items (C-D15); *Due for review* tab in the review
  queue; one line in the admin digest ("3 pages due for review").
- The docs page for writing for search gains "Writing with the pipeline" (what makes a good
  brief, how to review claims); a content pipeline page in the developer docs covers the envelope,
  adding a rule brief, the allocator, and `publish-many`.

**Verify:** an item with `coverImageQuery: "solar panels roof"` gets a tagged library image when
one exists and an Unsplash image otherwise; set a published item's `reviewBy` to yesterday: it
appears under *Due for review* and in the next digest.

### C6. In-product generation (API mode)
**Goal:** the same flow with the paste step removed.

- Anthropic key stored through a callable into `Settings/integrations.anthropic`, never readable by
  the client; Settings → Integrations shows a key-present state only.
- `generateContentItems` admin callable (C-D20): takes the built prompt and brief, calls Claude
  with web search, one call per item, one repair call when the gate fails (the gate runs in the
  browser on the returned JSON, so the repair is requested by the client with the failing rules),
  returns the envelope to the importer.
- Model id and per-piece cost settled at build time against the current Claude API reference.
- The Generate dialog shows **Generate** when a key exists and **Copy prompt** always.

**Verify:** with a key set, three briefs produce three drafts in the review queue without leaving
ArcCMS; removing the key falls back to the kit with no error; the key does not appear in any
client-readable document or network response.

---

## 3. Data changes summary

| Where | Field | Phase |
|-------|-------|-------|
| `arc_{slug}_drafts/{id}/pipeline/record` (new) | `briefLine`, `promptVersion`, `importedAt`, `importedBy`, `reviewState: 'pending' \| 'needs_work' \| 'approved' \| 'rejected'`, `gate: {score, failing[]}`, `claims[]`, `notes`, `requestedPublishAt?`, `coverImageQuery?`, `volatile?`, `linkCheck?`, `duplicates?`, `reviewedBy?`, `reviewedAt?`, `sensitiveMatch?` | C1 (C4 adds link check, duplicates) |
| `arc_{slug}_drafts` | `references` via import (field exists since D4) | C1 |
| `arc_{slug}_drafts` (draft-only, stripped on publish) | `publishAt?`, `scheduleState?: 'scheduled' \| 'publishing' \| 'failed'`, `scheduleAttempts?`, `scheduleClaimedAt?` | C3 |
| `arc_{slug}_drafts` (draft-only) | `reviewBy?` | C5 |
| `Settings/publishing` (new) | `timezone`, `cadence: {days, times}`, `dailyCap`, `paused`, `sensitiveTopics[]` | C3 (C4 adds topics) |
| `_publish_queue` | action `publish-many` with `items: {contentTypeSlug, docId}[]` | C3 |
| `Settings/integrations` | `anthropic.apiKey` (server-written, client never reads) | C6 |

**Import envelope, `arccms.content.v1`:**
```json
{
  "format": "arccms.content.v1",
  "contentType": "articles",
  "promptVersion": "1",
  "items": [{
    "briefLine": 3,
    "title": "", "summary": "", "content": "<p>…</p>",
    "urlSlug": "", "tags": [], "seoTitle": "", "metaDescription": "",
    "authorName": "", "references": [{ "title": "", "url": "" }],
    "customFields": {},
    "coverImageQuery": "", "coverAlt": "",
    "publishAt": "2026-10-01T09:00", "volatile": false,
    "claims": [{ "claim": "", "sourceUrl": "" }],
    "notes": ""
  }]
}
```
Required per item: `title`, `content`, `metaDescription`. `publishAt` without an offset is read
in the site timezone.

Rules: `pipeline/{recordId}` (and the `{path=**}/pipeline/{recordId}` collection-group match)
admin read and write only (C1); `Settings/publishing` admin read and write, public read not
needed (C3); `Settings/integrations` unchanged for the client, the key field written by callable
(C6). Indexes: collection-group field override on `pipeline.reviewState` (C1).

---

## 4. Risks and how they are handled

- **Volume without judgment reads as scaled content.** Review is mandatory, the daily cap
  defaults to 3, every item starts from a brief and must cite sources. The pipeline makes careful
  work faster; it does not remove the person doing it.
- **Invented facts and sources.** Retrieved-only references, a private claims list, a link check,
  and a reviewer who sees claims beside their sources. A live link does not prove support; the
  review screen says so.
- **Invented people.** JSON import never creates authors (C-D10); the prompt forbids unsourced
  quotes from named people.
- **Model output drifting from the contract.** Envelope validation per item, HTML through the
  editor schema, the gate catching missing blocks. `promptVersion` lets the importer warn when an
  answer came from an older prompt.
- **Prompt too long for claude.ai.** Published pages capped at 150, titles and URLs only; the
  dialog recommends 5 to 10 items per conversation.
- **Private data reaching the public collection.** Provenance lives in the admin-only
  subcollection; schedule fields are stripped on every publish path; a test asserts the published
  document carries none of them.
- **Hosting release races.** `publish-many` makes each scheduler run one release. A manual
  publish landing in the same minute as a scheduler run can still race; that is the existing
  two-admins-publishing risk, not new, and stays logged in `_todo.md`.
- **Timezone and DST mistakes.** The allocator and converter are pure and tested across DST
  changes; the Publishing page shows the next five slots in the site timezone before anything is
  scheduled.
- **Scheduler downtime.** Overdue items move to fresh slots instead of bursting (C-D14).
- **Unsplash terms.** C5 confirms hotlinking, attribution and download tracking before the
  Unsplash path is enabled; otherwise covers come from the library only.
- **API key exposure and spend (C6).** Server-held key, admin-only callable, one repair call at
  most, cost estimated before the phase is built.

---

## 5. Phase log

Nothing built yet.
