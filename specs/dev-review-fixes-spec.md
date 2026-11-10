# Dev review fixes: plan

Source: the critical review of `dev` at 701709da (2026-11-10): security, developer
experience, admin experience, member and visitor experience.

Left out on purpose (decided 2026-11-10):

- `main` being behind `dev`: `dev` is the default branch for now, the merge into `main` is planned separately.
- A worked example of an app in the docs.
- Zoom disabled on app pages (`user-scalable=no` in `index.html`).

## How the work runs

- Branch `fix/dev-review` in a worktree (`../arccms-dev-review`), cut from `dev`. The main checkout stays on `dev`.
- Seven phases, RF1 to RF7. Each phase is one merge into `dev`, only with `npm run gate` green and the docs updated.
- Every phase ends with the same last task: a critical review of that phase's work, fixes for every critical, high and medium item found, checks re-run, observations shared.
- Every change comes with a test that would have caught it, and `npm run docs:affected` decides which docs pages to update.
- Deploys are batched: one after RF3 (covers RF1 to RF3), then one after each later phase that touches functions or rules. Deploys run from the main checkout after the merge, never from the worktree. Order: functions, indexes, hosting, rules.
- Browser checks: changed screens only, page text first.

Items marked **(verified)** were re-read in the code during the review. The others are as the reviewers reported them and get a quick re-check before the fix.

---

## RF1. Security rules

Close the open public form paths and tighten Storage. Rules and rules tests only, no screen changes.

| # | Fix | Where |
|---|-----|-------|
| 1.1 | Form member create: admin only. `joinForm` already creates every member on the server. **(verified)** | `firestore.rules:751` |
| 1.2 | Form member update: admin only. Unsubscribe already goes through the token-checked server path. **(verified)** | `firestore.rules:762` |
| 1.3 | Form tag `usageCount` update: admin only. | `firestore.rules:117` |
| 1.4 | `email_lookup`: public `get`, admin-only `list`. | `firestore.rules:159` |
| 1.5 | `Settings/analytics_status`: admin read. | `firestore.rules:211` |
| 1.6 | Products: public read only when `active == true`; move tier discount codes to an admin-only document that `createCheckoutSession` reads on the server. | `firestore.rules:314`, `functions/src/dodo-payments` |
| 1.7 | Storage: public `get` only; `list` for staff. Check the media library and any public page that lists a folder first. | `storage.rules:70` |
| 1.8 | Avatars: jpeg, png, webp only (no SVG), file name pattern, 1 MB. | `storage.rules:54`, `:183` |
| 1.9 | Staff catch-all write: exclude `users/` and `avatars/`, add a type allow-list. | `storage.rules:82` |
| 1.10 | Rules build: refuse an app rule that is recursive at the root or names a core collection; allowed are an app's own subcollections under `users/{uid}` and the documented merchant collections. Check brace balance. The error names the line and the fix. | `scripts/arc-rules-build.mjs:42` |
| 1.11 | Rules tests for all of the above, plus the collections with none today: Products, Transactions, CreditLedger, Notifications, Contacts, Suppression, EmailLogs, Lists. Flip the test that today blesses the anonymous member update. | `tests/rules` |
| 1.12 | Docs: `docs/app/rules-and-indexes.html` (what an app rule may not match), storage read note. | |
| 1.13 | Critical review of RF1. | |

Risk: 1.7 and 1.10 can break an app built on Arc CMS. Both go in the changelog under "Apps must check".

## RF2. Security in Cloud Functions

Guard the under-protected callables and endpoints.

| # | Fix | Where |
|---|-----|-------|
| 2.1 | Admin check on four callables that only check sign-in: SMTP test, provider test, analytics test, Unsplash search. **(verified)** | `mail-config/`, `AnalyticsDashboard/`, `integrations/` |
| 2.2 | Dropped (2026-11-10): email webhook signatures wait until a provider that needs them is in use. |  |
| 2.3 | Admin create user: when the existing sign-in account's email is not verified, set the password the admin typed and revoke its sessions; a verified one is reused as today. **(verified)** | `users/adminCreateUser.ts:64` |
| 2.4 | Dodo payments: grant only when the paid product id in the event equals the Product's provider id; refuse and log otherwise. Same for the `metadata.test` switch. **(verified in code; needs one live check with a Dodo test payment link)** | `dodo-payments/handlePaymentEvent.ts:169` |
| 2.5 | Public form endpoints: shared rate limits (IP and address) on `requestFormOtp` and `joinForm`; size caps on `name`, `formData`, `signupMetadata`; form must exist and be active; verify attempts counted in a transaction with `randomInt` codes. | `waitlists/formOtp.ts`, `joinForm.ts` |
| 2.6 | `ensureWaitlistExists`: anyone may still create the default form on first use (the public form script relies on it); any other id needs an admin. | `waitlists/ensureWaitlistExists.ts:11` |
| 2.7 | `joinForm` returns a signed, short-lived ticket instead of the raw member id, and the form steps after it take the ticket. Legacy unsubscribe links (none generated since 2026-07-26) open a page that asks for the address and emails a signed unsubscribe link. | `joinForm.ts:59`, `email-core/unsubscribeLegacyLink.ts:24` |
| 2.8 | Sign-in codes: 20 wrong codes a day per address, then wait until the next day; 60 verify attempts an hour per IP. The 5 tries per code and 5 codes an hour stay. Wording for the new wait reuses the existing "try again at" strings. | `auth/signupOtp.ts`, `auth/phoneAuth.ts` |
| 2.9 | `createAccountRecord` refuses when the site expects a sign-up code and none was used. | `auth/emailAccount.ts:111` |
| 2.10 | `setPin` on a signed-in session that already has a PIN needs the old PIN; Forgot PIN keeps the emailed code. | `auth/setPin.ts:17` |
| 2.11 | Small ones: cap `requestedName` length; stop writing email addresses to function logs; hide codes in EmailLogs and SmsLogs after use; page `syncAllUserRoles` and respect `isActive`; a daily SMS cap per install (300 by default, changeable in SMS settings, admins emailed when reached). | `auth/`, `email-log/`, `sms/`, `users/syncUserRole.ts:283` |
| 2.12 | Tests per item (function specs), docs via `docs:affected`. | |
| 2.13 | Critical review of RF2. | |

Not in this plan: App Check. It changes how every app and every local dev run reaches the functions, so it deserves its own decision.

## RF3. Hosting, browser-side security, dependencies

| # | Fix | Where |
|---|-----|-------|
| 3.1 | Security headers on every response: frame protection (same origin), `nosniff`, Referrer-Policy, HSTS one year without subdomains or preload, Permissions-Policy. Content-Security-Policy in report-only mode with no reporting endpoint, enforced in a later release. **(verified)** The generated per-project hosting file picks them up from the same source. | `firebase.json` |
| 3.2 | `npm audit fix` at the root and in `functions/`, bump `nodemailer`. | both `package.json` |
| 3.3 | Replace `xlsx` 0.18.5 (two open high advisories, no npm fix) with the official SheetJS 0.20.3 package from the SheetJS download site. | `contents/bulk-import` |
| 3.4 | Pin `@angular/fire` to an exact version (today a caret range resolving to a canary). | `package.json:53` |
| 3.5 | Self-host Bootstrap, the icon sets and Roboto instead of three CDNs. Fixes the missing `integrity`, the render-blocking chain before sign-in, and the offline PWA start in one go. Full icon sets for now, so app pages keep every icon; cutting to the icons used comes later. | `index.html:13`, `scripts/pwa-workbox.ts` |
| 3.6 | Version preview in the editor: render in a sandboxed frame like the email preview. | `create-content.component.ts:3075`, `core/site/site-look-view.ts:65` |
| 3.7 | Feedback and messages: show the page path as a link only when it starts with one `/`. | `(feedback)/feedback.page.ts:78`, `(messages)/messages.page.ts:61` |
| 3.8 | `roleGuard`: deny when a route defines no roles, with a plain message. | `guards/role.guard.ts:43` |
| 3.9 | Search widget script and style get versioned addresses. | `functions/src/search/widget.ts`, `scripts/arc-site.mjs:54` |
| 3.10 | `.gitignore` covers `src/environments/firebase-web.*.ts`. | |
| 3.11 | Tests, docs. Extend `first-script.spec.ts` for 3.5. | |
| 3.12 | Critical review of RF3, then the first deploy (RF1 to RF3). | |

## RF4. Admin: no lost work, no locked-out site

| # | Fix | Where |
|---|-----|-------|
| 4.1 | Editor: create the draft on the first title or body input, so a new entry autosaves like any other. **(verified)** | `create-content.component.ts:2724` |
| 4.2 | Editor: leave guard while there are unsaved changes (route change, Close, browser back, tab close). One question, two buttons. | editor route |
| 4.3 | Publish: wait for the queue write, show "Publishing" until the status says live, show a failure that stays. **(verified)** | `create-content.component.ts:2576`, `:2644` |
| 4.4 | Autosave failure: a "Not saved, retry" state that stays, and an offline line. Save and Publish must not stay disabled after a failed write. | `create-content.component.ts:2768` |
| 4.5 | Two admins on one entry: check "changed since I opened it" before a save, offer reload or overwrite. | editor save |
| 4.6 | Slug: always check on the server, also on an existing entry; when a published address changes, offer a redirect from the old one (the redirects feature exists). | `create-content.component.ts:1931` |
| 4.7 | Users: hide Block and Delete on your own row; refuse to remove or block the last active admin, on the server too (delete and block go through a callable, rule narrowed). **(verified)** | `users/index.page.ts:431`, `firestore.rules:300` |
| 4.8 | Users: a Role choice in Add and Edit user, so a second admin can be made from the UI. Raising the role of a record whose sign-in email is unverified and not Arc CMS's own must be refused, as adminCreateUser does since RF2. | `users/(add-user)`, `(edit-user)` |
| 4.9 | Users: remove the dead "Verify" action. **(verified)** | `users/index.page.ts:500` |
| 4.10 | Confirm dialog: focus starts on Cancel, the cancel button says "Cancel". Replace the native `confirm()` and `alert()` calls (products, feedback, messages, form sign-ups, version restore) with it. | `confirmation-popup`, 5 pages |
| 4.11 | Delete wording says what goes with it: content (the live page too), form (its sign-up count), tag (entries using it), user (what is removed). Failures show a message, not only the console. | content, waitlists, tags, users |
| 4.12 | Form delete removes its sign-ups too (server side), not only the parent document. | `waitlists.page.ts:256` |
| 4.13 | Media delete: warn when the file is used in content. | `media.page.ts:1419` |
| 4.14 | Tests, docs (`docs/admin`, `docs/features/users-and-roles.html`). | |
| 4.15 | Critical review of RF4, browser check of the editor and Users on a phone width. | |

## RF5. Admin: clear screens

| # | Fix | Where |
|---|-----|-------|
| 5.1 | Shared table: an error state with Retry, and a separate "nothing matches" text. All 19 pages using it pass their load error in. | `shared/components/global-table` |
| 5.2 | Plain error sentences in place of raw technical text (about a dozen places); detail stays in the console. | list in the review |
| 5.3 | Translation sweep: the 26 admin templates and 113 toasts that bypass Transloco, the editor status line, onboarding. | admin pages |
| 5.4 | One word per thing, admin-wide. Proposed: Forms (not Waitlists), Sign-ups, Users, Entries, Delete, Cancel, Sign in and Sign out, Publish, Address (not slug), Code (not OTP), Media. | strings |
| 5.5 | Settings hub: grouped, plain names ("Email sending" not "SMTP configuration"), readable on a phone without a sideways row. No settings removed. | `(settings)/settings.page.ts` |
| 5.6 | Dashboard on a new install opens with "Write your first page", not "Google Analytics Not Connected". | `(dashboard)` |
| 5.7 | Tables on a phone: actions column stays in reach. | `global-table.component.scss` |
| 5.8 | Accessibility: names on the 75 icon-only buttons, sortable headers as buttons with `aria-sort`, dashboard cards as links, 44px row actions on touch, the 22 light grey text colours raised to 4.5:1, onboarding labels linked to fields. | admin-wide |
| 5.9 | Title search on the entries list. | `draft-contents-table` |
| 5.10 | Lists that load whole collections: page the form sign-ups, count once per form rather than on every snapshot. | `joined-users.page.ts:181`, `waitlists.page.ts:179` |
| 5.11 | Tests, docs. | |
| 5.12 | Critical review of RF5, browser check of every touched screen. | |

Not in this plan (new features, for the backlog): scheduled publishing, bulk publish and delete, a trash for deleted content.

## RF6. Members and visitors

| # | Fix | Where |
|---|-----|-------|
| 6.1 | Public sign-up form keeps what was typed on a failure: an inline error line, the form stays. Errors mapped by code to the page's language, never the raw browser text. **(verified)** | `public/assets/js/arc-site.js:426` |
| 6.2 | Sign-up form gets the honeypot the contact form has. | `arc-site.js`, `joinForm.ts` |
| 6.3 | Unknown addresses: `noindex` by default in the app shell, switched on only by public content routes; the not-found page sets it explicitly. Sign-in, member and admin pages stay out of search. A real 404 status where the host allows it. **(verified)** | `index.html`, `not-found.page.ts`, `firebase.json` |
| 6.4 | Sign-in: the phone back button goes one step back in the flow, not out of the page. | `signup.page.ts:668` |
| 6.5 | Sign-in accessibility: real buttons for the action links, names on show-password, `role="alert"` on every error, labels on name and repeat-password, one `h1`. | `signup.page.html` |
| 6.6 | `<html lang>` and `dir` follow the member language everywhere; right-to-left flag in the member languages. | `member-language.service.ts:115` |
| 6.7 | No connection during a code or PIN step says "No internet connection". | `sign-in.service.ts:92` |
| 6.8 | Published pages: image width, height, lazy loading and sizes added at publish time; `<main>` in the content templates; `rel` on share links; labels on the menu button and language switcher; "Back to" translated. | `functions/src/pages`, `public/_site/templates` |
| 6.9 | Translation: notifications, pricing, checkout pages, code-input label, "Loading"; public nav uses the site brand, not "ArcCMS"; member copy loses technical words. | `user/`, `payments-ui/` |
| 6.10 | Delete account uses the fresh-code dialog after 10 minutes, not a forced sign-out. Profile fields get `autocomplete` and linked labels; the "User" and "Active" badges go from the member's own profile. | `profile.page.ts:352`, `accountCallables.ts:28` |
| 6.11 | Wording: "Sign in" everywhere (no Login, logging in); sentence case titles; resend countdown computed from the time, so it is right after a visit to the SMS app. | strings, `signup.page.ts:1063` |
| 6.12 | Sign-up form behaviour tracking (scroll, clicks, device) only when analytics consent allows. | `arc-site.js:213` |
| 6.13 | Search widget comment and docs corrected: `/search` needs JavaScript. | `functions/src/search/widget.ts:7` |
| 6.14 | Tests, docs. | |
| 6.15 | Critical review of RF6, browser check of sign-in, the sign-up form and one published page on a phone width. | |

## RF7. Developer experience

| # | Fix | Where |
|---|-----|-------|
| 7.1 | A core version: one file plus a git tag per release, printed by `check:core` and the deploy. `package.json` name becomes `arccms`. Changelog cut into versions, each with an "Apps must" list. A stated place for data migration scripts. | `package.json`, `CHANGELOG.md`, `scripts/arc-version.mjs` |
| 7.2 | Front-end app kit: `src/app-kit/index.ts` re-exports the supported guards, services and components, under the same stability promise and test as the functions kit. Functions kit also re-exports `db`, `owner`, storage, `arcDocument`, `isFeatureOn`. Docs point at the kit, old deep imports keep working. | `src/app-kit`, `functions/src/app-kit`, `docs/app` |
| 7.3 | Script names that say what they do: `arc:upgrade` becomes `arc:migrate-function-names`, `seed` becomes `publish:pages`. Old names stay as aliases that print a notice. | `package.json` |
| 7.4 | Starter files: fix the stale ones (features list of 14, missing files in `src/custom/README.md`, the double `CUSTOM_NAV_CHANGES`, the `specs/` pointer), keep comments to a line plus a docs link, exempt the README from the freeze. Done as one recorded starter-file change, with the hashes updated. | `src/custom`, `scripts/custom-starters.mjs` |
| 7.5 | `deploy:prod`: same production check as the guided deploy (alias `production` or a prod or live id), no `--force`. | `scripts/arc-deploy.mjs:559` |
| 7.6 | README matches the docs: 14 features, no referrals, `arc:configure`, `check:core`. `engines` says Node 22.18. | `README.md`, `package.json` |
| 7.7 | Requirements page lists Java 21 for the rules tests; the install check becomes a light one (type check or one server spec), not the 15 GB suite. | `docs/getting-started` |
| 7.8 | `check:core` lets an app own a README and its ignore entries; its message uses the HTTPS remote like the install docs. `SECURITY.md` and the configure page agree on which environment files are committed. | `scripts/check-core.mjs` |
| 7.9 | Hygiene: remove `_feat-dodo-payments-phases_test_instructions.md`; neutral project id in two scripts and three specs; drop dead `.gitignore` entries. | root, `scripts/` |
| 7.10 | Functions logging: one logger (`logger.*`), replacing the 234 `console.*` calls. | `functions/src` |
| 7.11 | Tests, docs. | |
| 7.12 | Critical review of RF7, then a last pass over the whole plan: every review item fixed, dropped with a reason, or in the backlog. | |

Not in this plan: renaming the mixed-style folders under `functions/src`, splitting the 3,195 line editor component, and merging the two template hydration copies. Each is a refactor with no visible gain and a real risk of regressions; they go to the backlog.

---

## Order and size

| Phase | What it protects | Rough size |
|-------|------------------|-----------|
| RF1 | Public data and the form path | small |
| RF2 | Functions and sign-in | medium |
| RF3 | Hosting and packages | medium (3.5 is the large item) |
| RF4 | Admin work and access | medium |
| RF5 | Admin clarity | large (5.3 translation sweep) |
| RF6 | Members and visitors | medium |
| RF7 | App developers | medium (7.2 is the large item) |

RF1 to RF3 first and in that order, because they are the security phases and share one deploy. RF4 next: it stops lost work. RF5, RF6 and RF7 are independent of each other.

## Decisions (2026-11-10)

RF1, RF2 and RF3 run together on one branch and merge once.

- Email webhook signatures (2.2): left out for now.
- Every other recommendation accepted, as written into the tables above.
- Dodo (2.4): fixed without first proving the hole.
- Analytics default stays as it is; term list (5.4) waits for RF5.
