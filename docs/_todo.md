# TODO / Backlog

Running list of things to improve. Nothing here is built yet — these are notes to pick up later.

> **✉️ EMAIL:** all email & notification work is specced and tracked **exclusively** in
> [`docs/email-system-spec.md`](email-system-spec.md) — the single source of truth.
> No email tasks live in this file. (The former "EMAIL — one dedicated task" section,
> items E1–E7, was absorbed into the spec: E1–E4 → Phase 2, E5 → Phases 1 & 8,
> E6 → Phase 1, E2 → Phase 2; E7/SMS remains an explicit non-goal.)

## User onboarding & signup

### 1. Improve the user onboarding flow
The current new-user signup is demo-grade and needs a proper design pass. Make the
first-run / signup / post-signup experience coherent (where a user lands, what they
see first, guidance for new users).

### 2. Test Email functionality

---

_Reference: signup flow `src/app/pages/(auth)/(signup)/signup.page.ts`; auth store
`src/app/pages/(auth)/auth.store.ts`._

---

## Multilingual — open questions (raised 2026-07-27)

> The multilingual build itself is specced in [`docs/multilingual-spec.md`](multilingual-spec.md)
> (phases M1–M7, branch `feat/multilingual`). The items below are **questions/ideas
> raised alongside it that are not part of that spec** — parked here on purpose.
> Nothing here is built or scheduled.

### 3. Confirm per-language static publishing on a real Firebase deploy
On Firebase, publishing a content item deploys a static HTML page to Hosting
(`_publish_queue` → `processPublishQueue` → `deployContentPage` → Hosting REST API).
Question: does this hold for translated pages too — i.e. does each enabled language get
its own deployed static file at `/{lang}/{ctSlug}/{urlSlug}.html`?

Spec Phase M3 is designed to do exactly this (loop enabled languages, deploy one file
per language, remove all variants on unpublish), so this is a **verification task on a
real deployed project**, not a design gap. Worth confirming explicitly after M3 ships:
release count per publish, sitemap/hreflang correctness, and that unpublish leaves no
orphaned `/{lang}/**` files.

### 3b. CONFIRMED: `firebase deploy --only hosting` wipes all published content pages

**Demonstrated on the dev project, 2026-07-27** — this is no longer hypothetical.

A hosting deploy replaces the Hosting version with the contents of `dist/`, which
does not include the pages the publish pipeline injected via the Hosting REST API.
Every `/{ctSlug}/{urlSlug}.html`, every `/{lang}/...` variant, the list pages and the
SEO files are dropped; those URLs then fall through the `"**" → /__shell.html` rewrite
and render client-side instead.

**It is easy to miss**, and was missed once here: the SPA shell answers *any* path with
HTTP 200, so a status-code check reports the pages as healthy. Verify by content
(`curl … | grep`), never by status.

**Operational consequence today:** after any `firebase deploy --only hosting` (or
`npm run deploy:dev`, which includes hosting), **all content must be republished** or
the site silently degrades from static pages to client-rendered ones — losing the SEO
those static pages exist for.

Worth building: a `republishAll` admin callable that walks every published item and
enqueues it, so recovery is one action rather than opening each item. It would also
serve template changes, which have the same problem — a new template only reaches live
pages when each item is republished.

Closely related to item 4 below: the home page is the one page that *cannot* be
pipeline-owned, because `/index.html` is a build artifact that hosting will always
overwrite.

### 3c. BUG: multi-file publishes silently lose pages (race in deployToHosting)

**Observed on the dev project, 2026-07-27.** One publish of a two-language article
deploys four files in sequence; the **second** was missing afterwards:

| file | order | result |
|---|---|---|
| `/articles/test-page` | 1 | present |
| `/hi/articles/test-page` | 2 | **lost** |
| `/articles` (list) | 3 | present |
| `/hi/articles` (list) | 4 | present |

**Cause.** `deployFileToHosting` builds each new Hosting version by fetching
`releases?pageSize=1` and copying that release's file manifest
(`functions/src/pages/deployToHosting.ts`, steps 2–3). Calls seconds apart can read a
release list that has not yet caught up, so a later call inherits a manifest missing an
earlier call's file and drops it. Each call still succeeds, so `deployStatus` reports
`deployed` and nothing surfaces — the page is simply gone, falling through to the SPA
shell.

Pre-existing, but M3 made it far more likely: a publish used to deploy 2 files
(detail + list) and now deploys 2 x languages.

**Fix: batch one publish into one Hosting version.** `deployFileToHosting` should take
multiple files and run read-release → populate → finalize → release once. That removes
the race by construction (one version from one snapshot), and also cuts releases per
publish from N to 1 — the cost already flagged when M3 shipped.

Until then, a publish may need repeating, and success cannot be trusted without
checking the deployed pages by content.

### 4. Updating the pre-rendered home page after deployment
The home page is pre-rendered at deploy time. Investigate whether it can be updated
*after* deployment without a full redeploy — the suspected blocker is that a deploy
overwrites routes/assets, so anything written to Hosting afterwards gets clobbered by
the next build.

Worth scoping: which parts of the home page need to be editable at runtime (content vs
routing/shell), whether the content-publish pipeline could own the home page the way it
owns content pages, and how that interacts with `dist/analog/public` + the `"**" →
/__shell.html` rewrite. Relevant either way for multilingual, since a translated home
page would need the same mechanism.

### 5. In-place / inline editing on the public page
Idea: an incremental editor that edits content **in place on the public-facing page**
rather than in the admin editor — click a heading or paragraph on the live page and edit
it there.

Notably cheap-ish to explore given the existing architecture: the public templates
already mark their bound regions (`data-arc-bind`, `{{ }}`, `data-arc-loop`), and there
is already a client-side hydration path (`src/app/core/services/template-hydration.service.ts`)
that renders the same templates in the browser. An inline editor could reuse those
binding markers to know which field each element maps to. Open questions: auth/edit-mode
gating on public pages, saving back to `arc_{slug}_drafts`, rich-text vs plain fields,
and how it interacts with translations (edit the language you are viewing).
