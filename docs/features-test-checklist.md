# Features: test checklist

The end-to-end checks for per-app features and the search rework
([feature-flags-spec.md](feature-flags-spec.md), guide [features.md](features.md)).
Unit tests cover the logic (`npm run test`); these cover what only a real build, the
browser and the dev project show.

**Where:** the dev project `xlm-project-864ff`, the frontend at localhost:5173
(`npm run dev`), signed in as an admin. **Who:** Claude runs the browser and build
checks; deploys are run by you, with the command given at that step.

**Changing features for a test:** edit `src/custom/features.ts`, wait for the dev server
to restart ("server restarted" in its log), then reload the page. Put the file back to
`export const CUSTOM_FEATURES: FeatureChoice = {};` at the end of each section.

Mark each line `[x]` when it passes, or note what happened.

## 1. The features file

- [x] 1.1 `off: ['audience']` (forms and email marketing still on): `npm run dev` stops with
      "Signup forms (forms) needs Audience (audience)" and the same for email marketing.
- [x] 1.2 `off: ['payment']` (a typo): stops with `unknown feature "payment"` and the list of
      real names.
- [x] 1.3 `on: ['pwa'], off: ['pwa']`: stops, the PWA is in both lists.
- [x] 1.4 `enabled: true` left in `src/custom/pwa.ts`: stops with where the switch went
      (`on: ['pwa']` in features.ts).
- [x] 1.5 Empty file: `npm run dev` starts; the app looks as before this work.

## 2. Everything on (nothing changed for existing apps)

- [x] 2.1 Admin menu: every item as before, including Signup Forms and each form's group,
      Content, Audience, "Email + SMS", Products, Transactions, Data.
- [x] 2.2 Settings: every tab, including Payments, SMS, Search, Discoverability, App audience.
- [x] 2.3 Dashboard: GA, Content & Media, Growth & Leads (now with a **Users** card first),
      Recent signups, Recent activity.
- [x] 2.4 Header: search box present; the bell present.
- [x] 2.5 Member area (sign in as a member): Dashboard shows "Welcome back" and "Nothing here
      yet"; the menu has Payments, Account & Billing, Premium, Profile, Plans; `/user/payments`
      shows the credits and plans page.

## 3. Several features off

`off: ['content', 'search', 'forms', 'audience', 'email-marketing', 'payments', 'sms']`

- [x] 3.1 Admin menu: only Dashboard, Media Manager, Users, Email, Feedback, Data, Profile,
      Settings, About, Logout. "Email + SMS" reads "Email", without Broadcasts, Drips,
      Announcements or SMS Logs.
- [x] 3.2 Settings tabs: no Payments, SMS, Search, App audience. User Settings: no phone
      sign-in switch. Integrations: Unsplash only (no geolocation).
- [x] 3.3 Dashboard: GA, Media, Growth & Leads with the Users card only; its "View all" goes
      to Users. No recent signups or recent activity.
- [x] 3.4 Not found (address kept): `/admin/email/broadcasts`, `/admin/broadcasts`,
      `/admin/waitlists`, `/admin/contacts`, `/admin/settings/sms`, `/admin/contents/content-types`,
      `/pricing`, `/checkout/success`, `/user/payments`, `/search`, `/blog` (a content type).
- [x] 3.5 Still open: `/admin/users`, `/admin/settings/user`, `/admin/email/composer`,
      `/admin/email-logs`, `/user/dashboard`, `/user/profile`.
- [x] 3.6 No reads for switched-off features: the sidebar's content-type and form stores stay
      empty (the dev database has both).
- [x] 3.7 Automations: only "A user signs up"; no add/remove list fields.
- [x] 3.8 Email composer: no waitlist or payment templates.
- [x] 3.9 Data export: groups "Users", "Settings & Media", "Email" (with the Suppression list);
      no "All Content" button.
- [x] 3.10 Member area: menu Dashboard and Profile only; no plan badge, no credits.
- [x] 3.11 Home page: the form's markup shows; the signup counts stay empty; no console errors;
      the public header's search box is hidden.
- [x] 3.12 Sign-up page and Profile sign-in methods: no phone option, even with phone sign-in
      switched on in User Settings.
- [x] 3.13 No console errors on any page visited (the buffer held only earlier errors: a hot-reload mid-change, sampler calls before its redeploy, a network drop).

## 4. One feature at a time (spot checks)

- [x] 4.1 `off: ['email-marketing']`: a list's page (Audience, Lists, a list) has no Broadcasts
      or Sequence tabs; the Email menu has no Broadcasts, Drips, Announcements.
- [x] 4.2 `off: ['search']`: no header search box; the content editor's Checks tab has no link
      suggestions; a content page has no related items; Search settings tab gone.
- [x] 4.3 `off: ['payments']`: members land on the blank dashboard; `/account`, `/user/premium`,
      `/pricing` are not found.
- [x] 4.4 `off: ['data']`: no Data menu; `/admin/data/export-data` not found.
- [x] 4.5 `on: ['pwa']`: the dashboard shows App installs. The install prompt needs a production
      build (docs/pwa.md, preview on port 5190); the build config switches with the file (F1 check).

## 5. Search

- [x] 5.1 Search settings lists every collection with its state. Never searchable, with a reason:
      logs, events, notifications, `SearchIndex`, `email_lookup`, `form_otps`, `phone_otps`,
      `Settings`, and `_` collections.
- [x] 5.2 "What is searchable" shows the fields each source tokenizes: per content type for
      content, the most important in bold.
- [x] 5.3 **Set up** on a collection that is not named (for example `Feedback`): the panel lists
      its text fields with examples; pick fields, title, snippet, link, who may search it; the
      preview follows. Save: the collection shows **Waiting for deploy**, nothing is rebuilt.
- [x] 5.4 Fixed 2026-09-29: the panel pre-ticked the most common fields (for `Feedback`,
      `device.language` and `device.platform`). It now ticks name-like fields high (title, name,
      subject, heading, label) and descriptive ones normal (summary, description, message, text,
      body, comment, content, details, note), and nothing else; `Feedback` gets `page.title` and
      `sender.name`.
- [x] 5.5 Name it: add `'Feedback'` to `SEARCH_COLLECTIONS` in
      `functions/src/custom/search-sources.ts`, then deploy its trigger and the search callables:
      `npm run deploy -- --only functions:arccms:arccms.searchSync,functions:arccms:arccms.search,functions:arccms:arccms.reindexSearch,functions:arccms:arccms.listSearchCollections,functions:arccms:arccms.sampleCollectionFields --project default`
- [x] 5.6 Search settings: `Feedback` is **Searchable**; press Rebuild; its entry count shows.
      (Seen once: the first rebuild's row kept "Never" until a reload; the next rebuilds updated
      it at once. Not reproduced.)
- [x] 5.7 Admin search finds a feedback item by a word in a ticked field, with the chosen title,
      snippet and badge; a result without a link shows but does not open.
- [x] 5.8 Edit the setup (tick another field), save: it rebuilds with no deploy; the new field
      is searchable.
- [x] 5.9 A new feedback document is found without a rebuild (its trigger indexed it).
- [x] 5.10 Draft queue: edit and save a content draft's title; admin search finds the new title
      within a few seconds; the `arccms-onSearchQueued` log shows the run.
- [x] 5.11 Publishing a draft: the published copy is found by public search; the drafts index
      shows it as Published.
- [x] 5.12 No function per write: in the Cloud Functions logs, sending a test email (an
      `EmailLogs` write) starts no search function. Checked on the deployed triggers instead: in
      the `arccms` database only `searchSync-Feedback` and `onSearchQueued` are search triggers.
- [x] 5.13 Clean up: take `'Feedback'` out of the file, full deploy (section 6 checks the
      prompt), then **Rebuild everything**: its entries and status go.

## 6. Deploying

- [x] 6.1 Full deploy after 5.13: `npm run deploy -- --only functions:arccms --project default`
      lists exactly `arccms-searchSync-Feedback` for deletion and asks once (a single prompt).
      Answer `y`: it is deleted. (On the day one update, `sendTestSms`, failed with a Google error
      page, so the Firebase CLI skipped the delete; the wrapper redeployed it after 65 seconds and
      then deleted `arccms-searchSync-Feedback` itself.)
- [x] 6.2 The same off a terminal without `--yes` (for example piped:
      `echo | npm run deploy -- --only functions:arccms --project default`): stops, "Not deleting
      without a yes", nothing deployed.
- [x] 6.3 A targeted deploy (`--only functions:arccms:arccms.search`) never asks and deletes
      nothing.
- [x] 6.4 A feature off end to end: `off: ['data']` deletes nothing (it has no functions);
      `off: ['sms']` lists `sendTestSms` and the phone sign-in callables for deletion. Answer `n`
      to leave the project as it is, then put the file back.
- [x] 6.5 `--probe` after a deploy that creates a callable: every callable is reachable.

## 7. Security rules

- [x] 7.1 Install Java 21 (`brew install openjdk@21`), then `npm run test:rules`: all pass,
      including the search queue rules. (Java 21 need not be linked:
      `PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH" npm run test:rules`.) The first run found two
      older failures, both fixed: a users test still expected a member to change their own email
      (server only since phone sign-in), and the feedback files rule let the owner write over a
      file, since Storage's `create` covers overwrites; it now needs `resource == null`.
- [x] 7.2 Checked live on 2026-09-29: the queue refuses an extra field, a collection that is
      not a drafts collection, and every read; an admin may write a draft's entry.

## 8. App plug points

- [x] 8.1 `src/custom/user-dashboard.ts` pointing at a page of the app: `/user/dashboard` shows it.
- [x] 8.2 A `CUSTOM_NAV` item with `feature: 'payments'`: it goes with `off: ['payments']`.
      (The item needs `allowRoles`, as the guide's example has; without it the menu hides it.)

## Results

| Section | Date | Result | Notes |
|---|---|---|---|
| 1 | 2026-09-29 | Pass | 1.3 read "Installable app (PWA) (pwa)"; the label is now "Installable app" |
| 2 | 2026-09-29 | Pass | |
| 4 | 2026-09-29 | Pass | The dev server aborted once mid-section; restarted. A second abort later showed the cause: out of memory (4 GB heap) after many restarts, one per change to the features file |
| 7 | 2026-09-29 | Pass after fixes | 57 tests; storage rules need a deploy for the overwrite fix |
| 6.5 | 2026-09-29 | Pass | Probe run on its own after the deploys: every callable reachable |
| 6.1-6.4 | 2026-09-29 | Pass | `off: ['data']` builds the same 131 functions; `off: ['sms']` builds 123 |
| 8 | 2026-09-29 | Pass | |
| 5.13 | 2026-09-29 | Pass | Index and status hold no Feedback entries after Rebuild everything |
| 5.1-5.12 | 2026-09-29 | Pass | Admin search's subtitle said content only; it now names the set-up collections |
| 3 | 2026-09-29 | Pass after a fix | 3.4: after an in-app link, `/blog` showed not-found but kept the previous page's address; the content guard now keeps the requested one (`browserUrl`) |
