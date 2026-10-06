# App Follow-ups, Small Items: Build Spec

**Status:** built 2026-10-06 on `chore/app-followups-small`; suite, rules tests, functions build, app type-check and a production build green. Not yet merged to `dev`.
**Branch:** `chore/app-followups-small`, cut from `dev` and rebased on bf90c28.
**Scope:** three small items, one commit each.

**Out of scope:** the working papers in `specs/` keep their wording (till, shop and cashier
appear in the A5, A1, A4 and route-code specs); they record what was decided at the time.

---

## 1. Neutral wording

Core docs, comments and tests used point-of-sale examples. They now use a kiosk, a front
desk and a site: the app kit's comments (`functions/src/app-kit/pins.ts`, `accounts.ts`),
`docs/app/` (member languages, PINs, app kit, offline, PWA), and the tests for the app kit,
PINs, member languages, PWA routes, the profile page, the rules (the app account's claim)
and a few script tests whose project names said "shop". Font Awesome icon names
(`cart-shopping`) and CSS classes named `pos` (positive) are not wording and stay.

## 2. Firebase Analytics loads on demand

| # | Decision | Why |
|---|---|---|
| S-D1 | Lazy-load in every mode, not just correct the comment. | AngularFire's `provideAnalytics`, `ScreenTrackingService` and `UserTrackingService` in `app.config.ts`, and AnalyticsService's static `Analytics` import, put the SDK in the main bundle for every visitor, consenting or not, feature on or off. AnalyticsService already rebuilt AngularFire's screen views (same parameter names, pinned by a test against AngularFire's source) and user id for `required` mode, so `always` mode now uses the same path. |
| S-D2 | In `always` mode the first screen view is sent once: by NavigationEnd if Analytics loaded first, else by the load. | No double or empty first screen view whichever finishes first. |

Checked with `npm run build`: the SDK is `assets/index.esm-*.js` (19 kB), reached only by
the dynamic `import()` in `analytics.service.ts`. `analytics-guard.spec.ts` now fails on any
static import of `firebase/analytics` or `@angular/fire/analytics` in `src/`.

## 3. The Analytics settings page goes with the feature

`admin/analytics-setting/**`, the file router's second URL for the settings page, was in
`CORE_URLS`, so the page opened with the feature off. It is now in
`FEATURE_URLS.analytics`. The settings tile and the dashboard link were already gated.
`analytics-feature-off.spec.ts` checks both URLs are consumed with the feature off and left
alone with it on.

## End-of-work checks

- `always` mode, feature on: the network tab shows the Analytics chunk and Google's
  `collect` hits on the first page; GA4 DebugView shows `page_view` and one `screen_view`
  per page, with the same parameters as before, and the user id after sign-in.
- `required` mode: no Analytics chunk until the banner is accepted.
- A page with `data: { analytics: false }` as the first page of a visit: no hit for it.
- Feature off: `/admin/analytics-setting` and `/admin/settings/analytics` show the
  not-found page.
