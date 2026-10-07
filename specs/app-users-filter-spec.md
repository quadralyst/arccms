# Users List: All, People, App Accounts: Build Spec (F6)

**Status:** built 2026-10-06 on `feat/users-app-account-filter`; suite, functions build and app type-check green, docs updated. Not yet merged to `dev`.
**Branch:** `feat/users-app-account-filter`, cut from `dev` (0e06e38), rebased on bf90c28.
**Scope:** a filter on the admin users list (`/admin/users`): **All** (the default),
**People**, **App accounts**, so an admin can find real people among the accounts an app
made (`by: 'app'`). The App account badge stays.

**Out of scope:** a users search. Arc's search feature indexes content (and an app's own
sources), never `users`, and the users list has no search box (its `filters` signal has no
input on the page), so there is no admin search over users to narrow. If one is added, it
should take `accountKindConditions()` the same way the list does.

---

## 1. What was true

- App accounts have `by: 'app'` (A5). Every account made since server-side sign-up has a
  `by` (`email`, `phone`, `google`, `admin`). Records made before that (browser sign-ups,
  older installs, some imports) have no `by` at all.
- The list is a cursor-paginated Firestore query (`UserStore.getAll`), ordered by
  `createdAt` desc, with an exact count; the Detached toggle adds `status == 'Detached'`.

## 2. Decision log

| # | Decision | Why |
|---|---|---|
| UF-D1 | People is `where('by', '!=', 'app')`; App accounts is `where('by', '==', 'app')`. | Server-side, so pagination and counts stay exact. `!=` keeps any `by` value Arc does not know (an import, a future sign-in method) among people, where `in [list]` would silently drop it. The Firestore emulator orders such a query by `createdAt` as asked. |
| UF-D2 | Records with no `by` get `by: 'unknown'` from a new admin callable, `fillAccountSources`, which the page calls by itself, once per visit, when People is chosen and the counts show records missing (`all > people + app`). | Firestore leaves a record without the field out of any `!=` query, and cannot query for a missing field. A stored value is the only exact fix. Doing it on the server, only when needed, costs three count queries per visit and one scan per install, ever; the admin does nothing. |
| UF-D3 | Indexes in `firestore.indexes.json` (core): `(by, createdAt desc)`, `(createdAt desc, by desc)`, and the same two after `status` for the Detached filter, plus `(status, by)` for the live count of Detached people, which has no order (added after the browser pass of 2026-10-07 found Firestore asking for it). | Equality plus order needs `(by, createdAt)`; an inequality orders by `createdAt` and then implicitly by `by`, like the existing `(createdAt desc, name desc)` index for the name filter. |
| UF-D4 | A `mat-button-toggle-group` under the page header, like Feedback's filter. Labels "All", "People", "App accounts". | Matches the existing filter UI; short copy. |
| UF-D5 | Default All, no condition added. | Existing installs see exactly today's list. |

## 3. Build

- `src/app/pages/admin/users/user.model.ts`: `AccountKind`, `ACCOUNT_KINDS`,
  `APP_ACCOUNT_SOURCE`, `accountKindConditions()`.
- `user.service.ts`: `countByKind()`, `fillAccountSources()`.
- `index.page.ts` and `users.html`: the toggle, `accountKind`, `setAccountKind()`,
  `checkOlderAccounts()`; `hasActiveFilters()` counts the kind.
- `functions/src/users/fillAccountSources.ts` (exported from `all.ts`): admin by the claim,
  reads `users` with `select('by')`, writes `by: 'unknown'` in batches of 400, idempotent.
- Translation keys `admin.users.kind_filter`, `kind_all`, `kind_people`, `kind_app` in
  en.json and hi.json.
- Docs: `docs/features/users-and-roles.html` (the filter, the callable, two troubleshooting
  rows), `docs/reference/cloud-functions.html`, `docs/app/app-accounts.html`.

## 4. Tests

- `index.page.spec.ts`: default All with no condition; People and App accounts conditions
  from page one; combined with Detached; the three toggles in order; the older-records check
  calls the callable once and lists again, and never runs for All or App accounts or when
  the counts add up.
- `user.model.spec.ts`: the conditions, and that the five indexes are in
  `firestore.indexes.json`.
- `functions/src/__tests__/fillAccountSources.spec.ts`: fills only missing or blank `by`,
  leaves every other value, idempotent, batches under 500, admin only (a host app's plain
  `role: 'admin'` is refused).

## 5. End-of-work checks

- Deploy order: indexes (`firebase deploy --only firestore:indexes`, wait for them to build),
  then the one function (`functions:arccms:arccms.fillAccountSources`), then the frontend.
- Browser, `/admin/users`: the list looks as before with All selected; People hides app
  accounts and App accounts shows only them, with right counts; each works with Detached
  accounts and on `/admin/users/admin`. The browser console shows no index error (if
  Firestore asks for a different index shape for People, use its link and update
  `firestore.indexes.json`). On a project with older records (no `by`), choosing People
  once fills them and they appear.
- Screenshot: the docs have no users list screenshot today; if one is added in the
  end-of-work pass, take it with the new toggle.
