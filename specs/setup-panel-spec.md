# Setup panel on the dashboard

Status: BUILT on feat/setup-panel (SU1 to SU4). How it works today: docs/features/setup-panel.html.

## Why

A new admin opens the dashboard and cannot tell which outside services still need a key,
or where each one is set. Today only email has a banner, and it can be dismissed.

## What the admin sees

A panel titled "Finish setting up" in a right-hand column of the dashboard, next to the
analytics card and the content cards.

- It lists only what is still pending. A finished item is not shown, and there is no
  "done" tick or progress bar.
- It lists only items whose feature is on (`isOn()` from `src/app/core/features/features.ts`).
  A switched-off feature never appears.
- Each row: icon, name, an "Optional" tag when the item is optional, one short line saying
  why to set it up (what works once it is set, or what is off until it is), and a
  "Set up" link to the settings tab.
- Required rows come first, then optional ones.
- No dismiss button and no "Not using this" choice: the panel is strictly the pending list.
- Added after SU4: a fold button. Folded, the panel is a small "Finish setting up" button with the
  count at the top right (red while a needed row is left), remembered per browser in local
  storage. The open panel is compact: the button sits on each row's title line.
- When nothing is pending, the panel and its column are gone and the dashboard uses the
  full width as it does today.
- Shown only to someone who can open Settings (the admin role). Editors do not see it.
- Phone and tablet widths (below the `lg` breakpoint): the panel sits above the dashboard
  cards, full width.
- While the statuses load, the panel is not shown (no skeleton flicker for a site that is
  already set up).

Two dashboard banners are removed, so setup has one place:

- the yellow "Email not configured" banner; the `email` row replaces it.
- the red "Debug Provider (Log Only) is active" banner; the `email-test` row replaces it.
  This row is shown first and styled as a warning, since no email leaves the site. The same banner on the waitlists page stays, because there it explains why
that page's controls are off.

Added after SU4: Google Analytics is a row (optional), and while it shows, the dashboard's
"Google Analytics is not connected" card shrinks to one line with no button, so the same
call to action is not on screen twice. Without the row (the panel not loaded, or the check
could not read), the full card with "Set up analytics" stays. While the row is the amber
nobody-tracked warning, the dashboard hides its own tracking line above the numbers, which
says the same, and keeps the full card.

## The items

| Id | Feature | Pending when | Tag |
|---|---|---|---|
| email | core | `Settings/email_status.isEnabled` false; amber when `debugMode` (log only) | Needed |
| analytics | `analytics` | `Settings/analytics_status.isConnected` false; amber, first, when consent is `required` and `Settings/site-usage.isEnabled` is not true (nobody can be tracked), its Check going to `/admin/settings/site-usage` | Optional |
| sms | `sms` | provider not `msg91` or no `msg91AuthKey` | Optional; Needed and amber when `Settings/users.phoneSignIn` |
| payments | `payments` | `Settings/dodo-payments` off, or no key for its mode, or no webhook secret; amber when all set but mode is test | Optional |
| ai | `ai` | no connection with `keyPreview` (preset `vertex` needs none); amber when a key failed after its last success, or mode is test | Optional |
| unsplash | none | `Settings/integrations.unsplash.accessKey` empty | Optional |

Geolocation is not a row (off by default, works without a key). Checks read only whether a key is saved.

## Plug point for apps

`src/app/core/setup/setup-items.ts` holds the core rows; `SetupStatusService` runs them.
An app adds rows in the new starter `src/custom/setup-items.ts`
(`CUSTOM_SETUP_ITEMS: SetupItem[] = []`). An item is `{ id, feature?, icon, route,
pending(read) }`; `pending` returns `null` or `{ required, title, titleKey?, why, whyKey?,
warning?, route? }` (`route`: where this need's button goes, when not the item's route), and `read(id)` gives a `Settings` document, read once for all rows.

## Phases

**SU1: registry and checks.** `setup-items.ts` with the core rows and their `pending()`
checks, the empty custom starter, a `SetupStatusService` that runs every check for the
features that are on and gives a `pending()` signal. A check that fails to read counts as
not pending (no false alarm). Unit tests for each rule, the feature filter, the order, and
the custom rows. Last task: critical review of the phase.

**SU2: the panel.** `arc-setup-panel` component, the right-hand column on the dashboard,
phone layout, admin-only, hidden when empty or loading. Remove the dashboard email banner and the red debug
provider banner, and their now unused translation keys if no other page uses them.
Translation keys in every admin language file. Component tests. Browser check of the
dashboard: all pending, some pending, none pending, phone width, dark theme. Last task:
critical review of the phase.

**SU3: docs.** A docs page for the panel and the plug point (features list and custom
space page), changelog entry, `npm run docs:affected` pages updated. Last task: critical
review of the phase.

**SU4: gate.** `npm run gate` green, `npm run check:core` clean on an app copy. No Cloud
Function and no rules change, so no deploy beyond the site itself.

## Not in scope

- Testing a key from the panel (each settings page already does that).
- A setup wizard or step-by-step onboarding.
- Items for the merchant payments feature: each merchant connects their own account in
  the app, not the site admin in Settings.
