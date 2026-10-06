# Analytics That Respects Consent: Build Spec (A7)

**Status:** spec written 2026-10-06, not built.
**Branch:** `feat/app-analytics-consent`, cut from `dev` (10c8734).
**Replaces:** item 6 in `specs/_todo.md` ("Analytics that follows consent"), which this
builds. Mark that item done when this merges.
**Scope:** an install chooses whether Google Analytics tracks every visitor (today) or
only visitors who accepted the cookie banner. Analytics becomes a switchable feature. A
route can opt out of tracking. The email domain is no longer sent. When tracking is not
running because consent is needed, the admin screens that show Google Analytics say so.

**Out of scope:** Google's Consent Mode, other analytics providers, cookie categories
beyond accept or reject, storing the visitor's choice on the server, and changing the
numbers the admin dashboard shows (those come from the connected GA4 property).

---

## 1. What is true today

- `app.config.ts` provides Firebase Analytics, `ScreenTrackingService` and
  `UserTrackingService` for every browser visitor. Nothing checks the cookie banner.
- The banner (`site-usage-banner.component.ts`) saves `accepted` or `rejected` to
  localStorage (`arc_site_usage`, per device) and nothing reads it. The banner is off by
  default (`isEnabled: false` in the site usage settings) and never comes back once answered.
- `GaTrackingService` sends the events listed in `docs/features/analytics.html`, UTM
  values and the referral code as user properties, and, after a form sign-up,
  `user_email_domain` (only caller: `waitlist.component.ts`).
- Analytics is core: no feature switch, no way to remove it.

## 2. Decision log

| # | Decision | Choice |
|---|----------|--------|
| Y-D1 | The install setting | `analyticsConsent: "always" \| "required"` in `arccms.config.json`, shared or per project, written by `arc:configure --analytics-consent=<value>` into `arc-install.ts` (the same chain as `offlineCache`, the A3 spec (on branch `feat/app-offline-cache`)). **Default `"always"`**, which is today's behaviour, so no install changes unless it asks. `"required"`: nothing is tracked until the visitor accepts. |
| Y-D2 | Consent means | In `required` mode a visitor is tracked only when **the banner is on** (site usage settings `isEnabled`) **and** their saved choice is `accepted`. Banner off, choice missing or `rejected` all mean no tracking. (Decided 2026-10-06: banner off means no tracking.) |
| Y-D3 | Feature switch | New feature `analytics`, default on, no dependencies, in the feature registry (`feature-registry.ts`, mirrored in `functions/src/feature-flags.ts`). Off removes: all tracking code and the Google Analytics script, the admin Settings tab and its route, the dashboard analytics section, and the five `AnalyticsDashboard` functions (per F-D3 of the feature spec). `specs/feature-flags-spec.md` and `docs/app/choose-features.html` stop calling analytics core. |
| Y-D4 | Nothing loads before consent | **In `always` mode the wiring stays exactly as today** (`provideAnalytics`, `ScreenTrackingService`, `UserTrackingService`, Google's automatic page view), so existing installs record the same events and the dashboard's numbers do not move. **In `required` mode** those providers are left out and a new `AnalyticsService` (`src/app/core/analytics/`) loads Firebase Analytics on demand (a dynamic import) only once tracking is allowed, never during server rendering, and only when the browser supports it and a `measurementId` exists. With the feature off, neither is loaded. |
| Y-D5 | Same events in `required` mode | After consent, `AnalyticsService` sends **the events the AngularFire services send**: `screen_view` on each route activation with the same parameters (`screen_name`, `firebase_screen`, `firebase_screen_class`, `page_path`, `page_title`, and the previous-screen ones), Google's automatic `page_view` left on (not `send_page_view: false`, so it is neither lost nor doubled), and `setUserId` with the Auth uid while signed in (cleared at sign-out). A test compares the parameter names with AngularFire's. The first page view after consent is the one Google sends when it starts. |
| Y-D6 | One gate | `GaTrackingService` and every other caller go through `AnalyticsService.log(...)`, which does nothing unless tracking is allowed **right now**. A guard test (like `arc-config-guard.spec.ts`) fails if any file outside `core/analytics/` imports `firebase/analytics` or `@angular/fire/analytics`, so a new feature cannot bypass consent. Apps use `AnalyticsService.log()`; the docs' old advice to inject `Analytics` is replaced. |
| Y-D7 | Withdrawing | When a visitor who accepted later rejects, collection stops at once: `setAnalyticsCollectionEnabled(false)`, `window['ga-disable-<measurementId>'] = true`, and the `_ga` and `_ga_<id>` cookies are deleted (on the host and its parent domain). Accepting again turns it back on. |
| Y-D8 | Reopening the choice | `SiteUsageService.reopen()` clears the saved choice, so the banner shows again, and the banner reacts to the choice as a signal instead of reading it once. Arc adds no new link; the docs show a "Cookie settings" link an app can place that calls it. The service exposes the choice as a signal, so `AnalyticsService` reacts without polling. |
| Y-D9 | Per route | `data: { analytics: false }` on a route, **deepest wins, children inherit**, as `feedbackButton` does. Entering such a route turns collection off with `setAnalyticsCollectionEnabled(false)` (all hits stop, including Google's automatic ones); leaving it turns it on again if tracking is allowed. **No page reload.** Hits already sent are not recalled, so an app with a strict page (a children's screen) should not link to it from a tracked page with sensitive context in the address; the docs say so. |
| Y-D10 | No email domain | `linkUserAfterSignup(userId, waitlistId)`: the email argument and `user_email_domain` go. `primary_waitlist` and the user id stay. A test asserts no property value contains an `@` or is derived from an email. |
| Y-D11 | Always mode | Nothing changes for an install that keeps the default (Y-D4): same providers, same events, same numbers. The route opt-out (Y-D9), the feature switch (Y-D3) and the email domain removal (Y-D10) still apply. |
| Y-D12 | Telling the admins | A status line, in plain words, on **Settings, Analytics** and above the analytics section of the **admin dashboard**, built from one `AnalyticsStatus` computed value. States: *tracking all visitors* (always mode); *tracking visitors who accepted cookies* (required, banner on); **not tracking anyone: the cookie banner is off and this site waits for consent** with a link to Settings, Site usage (required, banner off); *no measurement id in the web settings* (shows the fix); none when the feature is off (the section is gone). In `required` mode with the banner on, the dashboard also says its numbers cover only visitors who accepted. The install setting is shown read-only with the command that changes it. |
| Y-D13 | Where the choice is stored | Unchanged: localStorage per device (`arc_site_usage`). Documented, with the consequence that a visitor is asked again on another device or after clearing site data. |

## 3. Build

**A7.1 Setting and feature.** `analyticsConsent` through the install chain
(`arc-configure.mjs`, `arc-install.ts`, `arc-config.ts`, example config); the `analytics`
feature in both registries, `feature-routes.ts` (`admin/settings/analytics`), the settings
tab filter, the dashboard section and the functions group, with the existing feature
coverage tests extended to it.

**A7.2 Service.** `AnalyticsService` with the allowed-now computed value (feature on,
`measurementId` present, browser, then mode, banner and choice per Y-D2 and the route
flag) and `log()`. In `always` mode it uses the Analytics instance the unchanged providers
give (injected as optional); in `required` mode it loads its own after consent and sends the
Y-D5 events, the user id and handles withdrawal. `app.config.ts` includes the three providers
only when the feature is on and the mode is `always`. Move `GaTrackingService` onto `log()`.

**A7.3 Banner and consent.** `SiteUsageService`: choice and banner-enabled as signals,
`reopen()`. The banner component follows them. The settings document is read once at
startup only in `required` mode.

**A7.4 Route flag.** `data.analytics` reader, shared with the other route-data readers
(`specs/app-pwa-update-spec.md` adds the same kind of reader; use one).

**A7.5 Admin status.** `AnalyticsStatus` and the two displays, with `en` and `hi` strings.

**A7.6 Email domain.** Y-D10 and its caller.

## 4. Tests

- `AnalyticsService`: nothing is imported or initialised in `required` mode until
  accepted with the banner on; each way of being off (feature off, no measurement id, banner
  off, rejected, pending, opted-out route) sends nothing; accept starts, reject stops and
  clears cookies; the first page view after accept is sent; a route opt-out turns collection
  off and back on; sign-in sets the user id only while allowed; `always` mode starts at once.
- A guard test for Y-D6 (no direct Firebase Analytics imports outside the folder, and
  `app.config.ts` for the `always` providers).
- `always` mode: the providers in `app.config.ts` are the same three as before.
- `required` mode: `screen_view` carries the same parameter names AngularFire's
  `ScreenTrackingService` sends, and `send_page_view` is not turned off.
- `GaTrackingService`: every public method goes through the gate; the email domain test.
- `SiteUsageService` and the banner: the signals, `reopen()` shows the banner again.
- Feature coverage: `analytics` off leaves no route, tab, dashboard section or function.
- `arc-configure.spec` and `arc-config.spec`: the setting and its default.
- Admin status: each state's text, and that banner off in `required` mode shows the warning
  on both screens.
- Existing analytics, banner and app specs pass in the default (`always`) mode.
- `npm run build --prefix functions` (the function group changes).

## 5. Docs

- Rewrite `docs/features/analytics.html`: the two modes, what is collected and when (each
  event, user properties, the user id, that the choice is per device), the route opt-out,
  withdrawing and reopening, and the removal of the "banner alone does not provide consent"
  warning in favour of the setting. Update `docs/features/banners.html`,
  `docs/app/choose-features.html`, `docs/reference/config-keys.html`,
  `docs/app/pages-and-routes.html` (`analytics: false`) and `docs/app/custom-space.html`.
- Retake the screenshots of Settings, Analytics and the dashboard analytics section, and of
  the banner if it changed. Run `npm run docs:affected`.
- Mark item 6 done in `specs/_todo.md`.

## 6. Checks before it is done

- Tests, `npm run build`, `npm run build --prefix functions`, `npm run check:core` green.
- At `localhost:5173` (the dev project, real analytics property): in `required` mode check
  the network panel shows **no** Google request before accepting, requests after, none after
  rejecting or on an opted-out route; the admin status line in each state. In `always` mode
  check the old behaviour. Functions deploy only if the feature switch changed them (targeted).
- GA4 DebugView, by Gunjan: in `always` mode the same events as before this change for one
  visit; in `required` mode the same events after accepting, and none before.
- A real GA4 DebugView check of the first page view after accepting, by Gunjan.
