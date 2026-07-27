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

### 2. Signup email verification — moved to the email spec
All signup-verification work (real email-OTP delivery, the "require email verification
on signup" toggle, degrade-when-email-not-configured rules) is owned by
`docs/email-system-spec.md` (Phase 2; kill-switch rules in Phases 1 & 8).

**Current behavior (status, not a task):** signup skips the OTP step when email is
disabled and creates the account with `emailVerified: false`. The hardcoded `123456`
bypass was removed and the OTP sender is still a client-side stub — so **enabling email
in settings before spec Phase 2 ships will block new signups at the OTP step.** Email is
currently disabled, so signups work.

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
