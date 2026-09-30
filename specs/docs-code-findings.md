# Findings while writing the developer docs

Written 2026-09-30 while the docs were built. Each writer read the code for the area it documented
and noted what looked wrong. **None of these was fixed**: the docs task changes no code. They are
the writers' observations, each checked against the code by the writer, not by a second person.
Triage them; several are security issues.

Where the docs describe behavior that is a bug (for example broken unsubscribe links), the page states
what happens today, so the page must change when the bug is fixed. Security defects are deliberately
not written into the docs; they are listed here only.

## Security and data exposure

1. `seedStaticPages` (functions/src/pages/seedStaticPages.ts) is a callable with no auth check, still
   carrying a TODO about it: anyone can trigger a rebuild and republish of every page. It also writes
   robots.txt, llms.txt and sitemap.xml whatever the `seo` switch says.
2. `handleEmailWebhook` verifies no signature on incoming provider webhooks.
3. `testProviderConnection` and `testSmtpConfigConnection` need only a signed-in user, not an admin: a
   signed-in person can make the server send mail with credentials they supply.
   `testAnalyticsConnection` is signed-in only and unused (a debug function). `searchUnsplash` accepts
   any signed-in user.
4. `ensureWaitlistExists` is public and creates a `Waitlists` document for any unknown id.
5. `syncAllUserRoles` checks the `role` on the caller's `users` record instead of the claim, and has no
   admin screen.
6. Rules: the `Waitlists/{id}/users` create rule accepts any fields (such as `emailVerified` or
   `queuePosition`) even when signed out; `referrals` has the same problem with `status`. Anyone can set
   `Waitlists.totalSignups` and `WaitlistUserTags_*.usageCount`. The `users` update rule does not protect
   `updatesEndingReminderSent` or `pwa`, so a person can write those on their own record (install
   counts can be faked). Storage rules let staff write into `users/` folders. The catch-all admin
   rule lets admins write `Settings/search_status`, which a comment says is functions-only.

## Core carries app-specific things (breaks "keep core generic")

7. `KNOWN_ROLES` (functions/src/users/syncUserRole.ts) and the `UserRole` enum
   (src/shared/components/base/base.component.ts) include `propertyOwner` and `facilityManager`.
   `KNOWN_ROLES` gates `adminCreateUser` and the default role, so an app cannot add its own role without
   editing core, although src/app/core/home/home.ts says an install may have its own roles.
8. Our own Firebase project id is committed as a default: functions/scripts/check-callable-access.sh
   falls back to it when `FIREBASE_PROJECT` is unset; src/environments/environment.ts,
   environment.prod.ts and arc-install.ts hold our dev project's values (environment.prod.ts also has
   `production: false`), so a fresh clone points at our project. Ship placeholders.
9. `package.json` says Node >=20.19.1, but scripts/arc-features.mjs (functions `prebuild`, and the test
   global setup) needs Node 22.18 or later and the functions ask for Node 22.
10. CLAUDE.md calls firestore.app.rules, storage.app.rules and firestore.app.indexes.json starter files,
    but none of them exists in the repository.

## Apps built on a copy fail core tests

11. `src/app/core/features/feature-coverage.spec.ts` checks every route in app.routes.ts, including
    `CUSTOM_ROUTES`: any route an app adds (for example `learn`) has "no owner" and `npm run test` fails.
12. `src/app/custom-space.spec.ts` ("ships every starter file empty") fails as soon as an app fills any
    starter file (routes, nav, home, i18n, features, search sources, functions index).
13. There is no plug point for app links in the member menu (only the Home item from `CUSTOM_HOME`), and
    app translations load only for `en` and `hi` (the language list is hardcoded in translation.loader.ts).

## Behavior that is wrong or broken

14. **Email links (fixed on fix/unsubscribe-hosting-rewrite: Hosting rewrites added, and the base falls back to the hosting site):** unsubscribe and preference links are built as `{liveUrl}unsubscribe?...` and
    `{liveUrl}email-preferences?...`, but firebase.json has no rewrite to `arccms-handleUnsubscribe` or
    `arccms-handleEmailPreferences`, so they reach the not-found page. `liveUrl` cannot be set in the admin
    UI (the control exists, no input) and `constant.live_url` is empty, so links come out relative.
15. Composer templates made with "New email" (`custom_*`) get no `senderEmail`/`senderName`, so drip and
    rule sends have an empty From. The open-tracking pixel uses `emailLogsData.id`, which is never set
    (`?emailId=` empty). Bounces update the log status only; nothing writes to `Suppression`.
16. The Site usage banner stores accept/reject in localStorage `arc_site_usage` but nothing reads it:
    Google Analytics runs regardless. The notification-type `enabled` flag is saved but never checked;
    `admin_webhook_failure` is registered but nothing creates it. The first Google Analytics connect sends
    no measurementId, so the property picker appears instead of auto-detecting.
17. `createCheckoutSession` takes the email from Firebase Auth, so accounts made with a phone number fail
    with "Your account has no email address."
18. `*appIfEntitled`, `entitledGuard` and `hasTier()` check only `isPro` and the rank, not status or expiry:
    a `past_due` plan keeps access until it expires. `EntitlementService.load()` reads once, not live.
19. `/admin/users` Edit writes a `password` field the rules refuse (`hasNoPassword`), and changing the email
    there leaves the Auth email unchanged. The Users "Verify" action is a placeholder ("Email verification
    not yet implemented"). No admin screen changes an existing person's role; an admin can only be added at
    `/admin/users/admin`, which is not in the menu. `common-constants.ts` has a `customer` role that
    `adminCreateUser` rejects, so `/admin/users/customer` Add fails, and `fixedRoles` labels it "User".
    `linkEmail` passes an 8-character minimum while `adminCreateUser` exports 6.
20. `onContentTypeDelete` deletes `publishedHistory` (lowercase) but the pipeline writes
    `PublishedHistory`; it also leaves `translations` and `DeploymentLogs` behind and leaves the type's pages
    live on Hosting. `processPublishQueue` overwrites `publishedOn` on every publish.
    `PublishQueueService.enqueue` reads `_publish_queue`, which the rules deny, so its cleanup always fails
    silently. `redeployAll()` and `syncAllUserRoles` have no UI.
21. Image sizes: an upload smaller than a size's limit stores no file for that size, so derived `_m`/`_l`
    URLs 404; with an upload folder (`storagePrefix`) the size regex matches only `mediaImages/`, so no size
    bindings are produced.
22. Data import cannot write `Contacts` or `Suppression` (functions only) though export offers them. Media
    export names entries `name + ext` (`photo-xl.webp.webp`) so restore from the manifest matches nothing;
    the manifest's empty `storagePath` falls back to the full download URL (pointing uploads at the old
    bucket); only the XL file is exported. Data export leaves out `Authors`, content `translations` and
    `PublishedHistory`.
23. Merge tags `##EMAIL##`, `##REFERRAL_CODE##` and `##CONTENT##` are offered in the editors but no core
    sender supplies their values, so they come out empty; the `waitlist_broadcast_email` tag context has no
    editor. The `EmailLog` rule (singular) is used by no code, and the admin test-email dialog writes
    `EmailLogs` directly instead of going through `queueEmail()`.
24. `arc:configure` silently drops config values that are not strings (`"adminOnlySignIn": true` is
    ignored). In `CUSTOM_HOME`, `'*'` never changes where admins land (the `admin` default wins).
25. The wizard's "Skip & Go to Dashboard" (`skipSetupAndGo`) creates the default content type and waitlist
    without checking the feature switches (`completeSetup` does check them).
26. `site-jsonld.ts` always emits the WebSite SearchAction pointing at `/search`, even when `search` is off
    and that page shows not-found. Templates: `nextContent.url` and `previousContent.url` work only in the
    in-browser renderer, not in published pages.
27. `deploy:dev` and `deploy:prod` pass `--force`, which also answers yes to deleting removed functions, so
    they delete without asking. A deploy of named functions with `firestore:rules` or `firestore:indexes` as
    targets is not recorded in `.arc-deploy-state.json`.

## Copy and text

28. `admin.settings.search.developer_note` in src/assets/i18n/en.json tells admins to read the search developer guide from the working papers (a file that is gone). scripts/arc-deploy.mjs, arc-deploy-menu.mjs and check-core.mjs print
    messages that point at `specs/...` files (repointed to the docs by the guide retirement, check them).
    The Localization settings strings contain em dashes ("— (root)", `intro_2`), against the writing rule
    for UI copy.

## Forms, audience and sending (from the audience and marketing pages)

29. The form drawer's "Save form answers as" never shows: it lists input names from `Waitlists/{id}.fields`
    and nothing in core writes that field.
30. A form's default tag uses two different tag sets: the drawer offers `WaitlistUserTags_{form}` but contact
    sync treats `defaultTagId` as a `ContactTags` id (and `migrateTagsToContacts` rewrites it to a slug), so a
    tag picked in the drawer can end up as an orphan id on the contact. The Tags page subtitle says tags can
    target sends, but broadcasts and announcements only target lists (plus source, createdAfter and
    premiumType filters).
31. Home-page forms fail after a slug change: the markup looks a form up by slug but submits the attribute
    value as the document id ("This form does not exist").
32. A broadcast paused because the daily or hourly quota ran out continues in a new run straight away, not
    when the quota resets; it can use up the 200-run limit and end as `failed`.
33. A deleted template stalls drip steps: every enrollment on that step is held and retried every 15 minutes
    without end. Drip `exit.onListLeave` and `exit.onUnsubscribe` are stored but never read (people always
    leave when they leave the list or unsubscribe).
34. The welcome template sends only when an address is verified, so a form that confirms people without a
    code never sends it.
35. Deleting a manual list leaves its id in contacts' `listIds`. The Contacts table loads only the 500 most
    recently updated contacts; search and filters work on those only.
36. `migrateWelcomeToSequences` has no admin screen.

## Website building (from the website path)

37. The default template's Info Card block cannot be filled by a new content type: field keys come from the
    name through `fieldKeyFromLabel` (underscores and spaces become hyphens), so a new field can never get the
    key `info_cards` the template expects.
38. Static pages: only `privacy-policy` and `cookie-policy` (hard-coded `STATIC_PAGES` in
    functions/src/pages/seedStaticPages.ts and generateSitemap.ts) get the site header, footer and styles and
    are in the sitemap; any other file in `public/pages/` is served raw with empty `<arc-header>` and
    `<arc-footer>` tags.
39. `data-waitlist-form` forms and `<arc-content-partials>` work only on the home page
    (`home-base.component.ts`); published pages strip partials and wire no forms.
40. Nothing blocks a content type slug that is already a site address (`search`, `p`, `admin`, `waitlist`).
    Editing a form's slug keeps the old document id and lookups use id in some places and slug in others.
41. `validateTemplateFolder` (template-folder.service.ts) checks for `{folder}-list.html` and
    `{folder}-detail.html`, but the real files are `list.html` and `detail.html` (dead code).
42. The terms and privacy links under every signup form are empty by default and can be set only by editing
    core `src/shared/constants/legal-notice.ts`.
43. A website must edit `public/templates/`, `public/pages/`, `public/_partials/`, `public/index.html` and
    `legal-notice.ts`, all core files for `check:core`, with no custom plug point for a website's own
    templates and pages. There is also no page or plug point for editing the home page and its translated
    versions (a core route and component).
44. The Settings, About "Address" hint says it appears in email footers; the email compiler uses the Brand
    Kit `physicalAddress`. The menu says "Signup Forms" while the page title says "Waitlists" and the button
    "Add Waitlist".

## From the review pass

45. `syncAllUserRoles` calls `setRecordClaims` for every record with a `uid`, including blocked or detached
    ones (`isActive: false`, `status: 'Detached'`), handing those accounts their claims back; `refreshMyClaims`
    and `onUserRoleChange` both refuse to. `createAccountRecord` (functions/src/auth/emailAccount.ts) creates a
    record without a verification ticket (it only marks `emailVerified: false`), so the sign-up code step is
    enforced only by the browser.
46. storage.rules: the catch-all `match /{first}/{second}/{rest=**}` gives `isEditor()` write access to
    `users/{userDocId}/...` folders. Harmless while editor means admin, worth tightening.
47. `src/test/setup.ts` mocks `custom/features` but not `custom/routes`, so one entry in
    `src/custom/routes.ts` makes "gives every page URL exactly one owner" fail, with an error telling the
    developer to edit core `feature-routes.ts`.
48. `scripts/arc-deploy-menu.mjs` ignores the seed's exit status, so it prints "Done:" even when publishing the
    pages failed. `npm run deploy:dev` and `deploy:prod` build the functions twice. The comment in
    `scripts/arc-upgrade.mjs` overclaims: it deletes any function with an Arc CMS function name outside the
    `arccms` codebase, including a same-named function of another app.
49. After a signed-out admin signs in to resume the setup wizard, `signup.page.ts` sends them to
    `/admin/dashboard` instead of back to the wizard. "This site already has an administrator" only appears in
    the browser console.
50. `README.md` and the old install guide said Node >=20.19.1; the root `package.json` `engines` still does
    (see item 9).

## From the later reviews

51. `queueEmail` spreads `params.data` after the base log fields (queueEmail.ts:137), so custom event data can
    overwrite `toEmail`, `bcc` or `template`. The Admin alerts switch does not gate the admin digest although its
    label says it does (sendAdminDigest.ts, email-setting.model.ts). The Resend send path drops BCC.
52. Notification registry types `subscription_changed`, `trial_ending` and `updates_ending` are never created but
    show as member switches; the "Enabled" toggle on Notification types is never read; phone-only users get no
    announcements and cannot save notification preferences without an email.
53. Automations: `enrollInDrip` is never executed (appEvents.ts:243); `waitlist.joined` offers "Create a
    notification" but the event has no userId. Property auto-detect for Google Analytics sends the status
    `measurementId`, which is empty on a first connect, and there is no way to pick a property after closing the
    picker.
54. Users admin: clicking a name does nothing (`onCellClick` checks `displayName` but the column key is `name`).
    `toggleSignup` in User Settings never updates the form, so a later toggle can turn sign-ups back on
    unnoticed; with sign-ups off the page hides the Phone number and Google switches.
55. `resolvePwaConfig` never falls back to `name` for `shortName` because the default `shortName` is
    `'Arc CMS'`: an app that sets only `name` gets "Arc CMS" under its home-screen icon.
56. `buy()` in pricing.page.ts swallows checkout errors and shows the buyer nothing. `payment_failed_email` is
    sent without a dedupe key, so a retried `handlePaymentEvent` can send it twice; `scanUpdatesEnding` sends
    without a dedupe key and reads all matching users in one unpaged query.
57. `searchUnsplash` lets any signed-in account use the site's Unsplash key. `runSeed` writes robots.txt,
    llms.txt, the sitemap and feeds even with `seo` off; the list page head always carries the RSS link. The
    file upload service points `_m`/`_l` URLs of small images at files that do not exist (and its comment says
    the opposite of what the code does). Restore from manifest applies `withStoragePrefix` to a `storagePath`
    that may already carry the prefix. `getAvailableTemplates` calls a nonexistent `/api/templates`.
58. `public/index.html` ships cards for a `user-manuals` type that onboarding no longer creates. The home-page
    form success panel (`waitlist-form.service.ts`) ignores `gamificationEnabled`.
59. `unsubscribeLegacyLink` unsubscribes by a guessable member id (deliberate, per its comment). The old install
    guide's troubleshooting told readers to deploy with `firebase deploy --only firestore:rules`, which skips
    the install settings (the guide is gone, check nothing else says it).
