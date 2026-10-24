# System Clock and Time Zones: Build Spec (T1 to T6)

**Status:** approved 2026-10-24; T1 to T6 built on this branch the same day. Not merged, pushed or deployed. Browser check of the signed-in screens pending (needs a sign-in on the worktree's dev server).
**Branch:** `claude/system-clock-6f0a4b` (worktree), cut from `dev` at 62fad02b.
**Scope:** one true "now" for the browser (`ArcClock`), three kinds of time zone (site,
member, place) stored as IANA names, and one way to show a moment in a zone (`arcTime`).
A general Arc CMS feature: nothing in it knows about a point of sale, a shop or a business.

**Out of scope:** a chat (it is only the worked example below), any app's country pack or
place records, a zone stored on the user record (the member's choice is per device, like
the member language, T-D7), emails and SMS in the member's zone (the server does not know
it; they keep their current wording), schedules of Cloud Functions (they stay in UTC),
date-only admin screens that format with `toLocaleDateString` (section 6, backlog), and
moving a live install's existing data.

---

## 1. What is true today

- Every time shown in core comes from Angular's `| date` pipe or `toLocaleDateString()`,
  both in **the device's zone**, whatever it is. There is no site zone and no way for a
  person to choose one.
- `| date` takes a zone only as a fixed offset (`'+0530'`), so it cannot show a moment in
  `Europe/Zurich` correctly on both sides of a summer time change.
- Nothing measures the device clock. An app that stamps a record with `Date.now()` writes
  whatever the device believes; a phone set 10 minutes fast reorders records and fails
  any rule that compares with `request.time`.
- The static pages the publish functions write format dates on the server, in UTC
  (`functions/src/shared/content-cards.ts`, `functions/src/shared/template-hydration.ts`,
  `functions/src/pages/deployContentPage.ts`). An article published at 00:30 in Zurich
  shows the day before.
- Core `| date` uses with a time of day: "Draft saved" and "Published" in the editor
  (`create-content.component.html`, a fixed 12-hour pattern), Products' created date,
  Feedback, Messages, Transactions, App users' activity, the media manager and media file
  panel, Search settings' last run, and date columns of `app-global-table` (which apps use
  too, with their own `dateFormat`).
- `Settings/localization` is public read and cached on the device by `LocalizationService`
  (`arc-site-languages`). The onboarding wizard does not write it.

## 2. The example to design against

Anna in Zurich and Ravi in Pune chat in an Arc app. Arc has no chat; this is the example
used here and in the docs, never built.

| Need | How Arc serves it |
|------|-------------------|
| A message is one moment, and a fast phone cannot reorder messages | The app stores `sentAt: serverTimestamp()`. The server stamps it; both readers get the same instant. Shown before the write lands with Firestore's `serverTimestamps: 'estimate'`. |
| Each sees their own time | `{{ m.sentAt \| arcTime: 'time' }}`: the member zone by default. Anna sees 22:00, Ravi 01:30. |
| "Today" and "Yesterday" follow each reader | `{{ m.sentAt \| arcTime: 'day' }}`. For Ravi the 22:00 Zurich message is already "Today" at 01:30. |
| "2 minutes ago" uses the true now | `{{ m.sentAt \| arcTime: 'ago' }}`, counted from `ArcClock.now()`, so a phone set 10 minutes slow does not say "in 8 minutes". |
| A time that belongs to a place shows both | A meeting at the Zurich office: `{{ meeting.at \| arcTime: 'place' : 'Europe/Zurich' }}` shows "22:00 Zurich (01:30 for you)" to Ravi and "22:00" to Anna. |

## 3. Decision log

| # | Decision | Choice |
|---|----------|--------|
| T-D1 | Where the server time comes from | **The `Date` header of a tiny no-store file on the site's own Hosting**, `/_arc/clock.json` (body `{}`). No Firestore read, no function, no cost, works signed out. Compared in section 4. |
| T-D2 | Making sure the answer is fresh | Four guards, each covered by a test: (1) every request has a new query (`?t=<random>`), so no cache, the service worker's or the browser's, can hold its key; (2) `fetch(..., { cache: 'no-store' })`; (3) `firebase.json` sends `Cache-Control: no-store` for `/_arc/**`, so the CDN goes to the origin every time; (4) an answer with an `Age` header above 0, no `Date` header, a status other than 200, or a round trip over 5 seconds is ignored and the last good offset kept. A test also fails if any service worker caching rule in `scripts/pwa-workbox.ts` matches `/_arc/`. |
| T-D3 | The offset | `offset = serverTime - deviceTime at the middle of the round trip`, where `serverTime` is the `Date` header plus 500 ms (the header drops the milliseconds). Expected error: half a second plus half the round trip, plenty for a 2 minute warning and for showing minutes. Sub-second order comes from `serverTimestamp()`, never from the clock. |
| T-D4 | When it measures | When the app starts, when the browser comes back online, when the page becomes visible again (at most once a minute), and every 30 minutes. Only in the browser; on the server render the offset is 0. |
| T-D5 | Offline | The last good offset and when it was measured are kept on the device (`arc-clock`, localStorage, safe when unavailable). A page opened offline starts with it, so an offline device still shows the corrected time; `synced()` stays false until a fresh measurement succeeds. Known limit, documented: a device clock changed while offline is not noticed until the next measurement. |
| T-D6 | `ArcClock` API | A root service in `src/app/core/time/arc-clock.ts`. Signals: `now()` (corrected epoch ms, ticks every second, for templates and effects), `offset()` (ms, positive when the device is behind), `synced()` (a measurement succeeded since this page opened), `lastSyncedAt()` (corrected epoch ms of the last good measurement, or null), `skewed()` (the device is off by more than the threshold). Methods: `exact()` (corrected epoch ms at this instant, for stamping a record on the device when `serverTimestamp()` cannot be used) and `sync()` (measure now). |
| T-D7 | The skew threshold | 2 minutes by default. An app sets its own in a new starter file, `src/custom/clock.ts`, shipped empty: `export const CUSTOM_CLOCK: CustomClock = {}` with `skewSeconds?: number`. Read in the bundle; a value that is not a positive number stops `npm run dev` and `npm run build` with a message, like `src/custom/sign-in.ts`. |
| T-D8 | Zone values | Always an IANA name (`Europe/Zurich`), never an offset or an abbreviation. A zone is checked with `Intl.DateTimeFormat` and turned into its current name (`Asia/Calcutta` becomes `Asia/Kolkata`, `Europe/Kiev` becomes `Europe/Kyiv`; some browsers still report the old names). A name the browser does not know falls back to the next zone in line (T-D11) and is never written. |
| T-D9 | Site zone | `timeZone` on `Settings/localization` (already public read and cached on the device, so no rules change). Set on **Settings, Localization** with the zone picker. The onboarding wizard writes it from the browser of the person setting up the site. An install that predates this has none: times that use the site zone use **UTC** until an admin sets one, and the Localization page shows "Your site has no time zone yet" with one button, "Use Europe/Zurich", filled from that admin's browser. |
| T-D10 | Member zone | Each person's own zone, in the admin area as well as the member area (unlike languages, one person has one zone). It **follows the device** unless the person chooses one. The choice is kept on the device (`arc-member-zone`), like the member language: no Firestore field, works on the sign-in screen, and a shared device keeps it. Chosen on the profile page (admin and member), in a "Time zone" row: "Automatic: Asia/Kolkata" until they pick one. From code: `setMemberZone('Europe/Zurich')`, `setMemberZone(null)` to follow the device again. |
| T-D11 | Place zone | A plug point by value, not by file: the app passes the zone of something it owns, such as a shop's `zone` field, when it formats: `arcTime(at, 'place', shop.zone)`. A place can carry a name for the label: `{ zone: 'Europe/Zurich', name: 'Main Street' }`. Fallback order when a zone is missing or unknown: place, site, UTC; member zone falls back to the device, then UTC. |
| T-D12 | Formatting | `formatArcTime()` (pure, `src/app/core/time/arc-time.ts`) on `Intl.DateTimeFormat` with `timeZone`, formatters cached by locale, zone and format. Formats: `time` (22:00), `date` (24 Oct 2026), `dateTime`, `short`, `medium`, `long`, `full` (Intl's date and time styles), `day` ("Today", "Yesterday", else the date), `ago` ("2 minutes ago", Intl.RelativeTimeFormat), `place` (T-D13), an `Intl.DateTimeFormatOptions` object, or an Angular date pattern (`'MMM d, y'`), which is formatted by Angular's `formatDate` with the zone's offset **at that moment**, so summer time is right and `app-global-table` columns keep their `dateFormat`. 12 or 24 hours follow the locale. "Today", "Yesterday" and "ago" come from `Intl.RelativeTimeFormat`, so they need no new translation keys. |
| T-D13 | Place labels | `place` shows the time in the place's zone, the place's name (or the city from the zone, `Europe/Zurich` gives Zurich) and, when the viewer's zone shows a different time, the viewer's time: "22:00 Zurich (01:30 for you)". When the viewer's day differs, their part gets the short weekday: "(Sat 01:30 for you)". When both zones show the same time, just "22:00". "for you" is one translation key, `common.time.for_you`, with English and Hindi. |
| T-D14 | Moment input | `Date`, epoch ms, an ISO string, a Firestore `Timestamp` or `{ seconds, nanoseconds }`. Null, undefined or invalid gives an empty string, never "Invalid Date". |
| T-D15 | `arcTime` pipe and function | `{{ moment \| arcTime: format : zone : locale }}`, zone being `'member'` (default), `'site'`, `'device'`, an IANA name or a place object. One impure, memoised pipe: it formats again only when its inputs change, or, for `day` and `ago`, when `ArcClock.now()` moves on (`ago` each minute under an hour, `day` at the reader's midnight). For code outside templates: `ArcTime.format(...)` on the service, and a plain `arcTime(...)` function, like `setMemberLanguage`. The locale follows the language on screen at once (Intl needs no locale data); an Angular pattern uses `LOCALE_ID`, like `\| date`. |
| T-D16 | Building blocks for apps | `<arc-zone-picker>`: a searchable list of zones ("Zurich, GMT+2"), with an optional "Automatic" first item ([(value)], [allowAutomatic]); used by Settings and the profile page, and by an app for its places. `<arc-clock>`: the corrected date and time in a zone and format, with a warning icon and text when the device is off ("This device's clock is 7 minutes fast"); for an app's footer. Core places neither `<arc-clock>` nor a skew warning on its own screens. |
| T-D17 | Which zone core screens use | **The reader's own zone (member zone)** for every time in the admin and member areas: "Draft saved", "Published", created dates, feedback, messages, transactions, activity, uploads, last runs, table columns. **The site zone** for what the site states to everyone: the dates on published pages, written by the publish functions and by the browser's fallback renderer. |
| T-D18 | Server side | A small `siteTimeZone()` in `functions/src/shared/site-settings.ts` reads `Settings/localization.timeZone` (UTC when unset or invalid) for the publish functions. No other function changes. |
| T-D19 | Keeping new screens right | A test fails when a core template or component uses Angular's `\| date` pipe or `DatePipe` with a time of day, naming the file and pointing to `arcTime`. |

## 4. Where "now" comes from (T-D1)

| | Hosting `Date` header (recommended) | Firestore `serverTimestamp` round trip | Callable function |
|---|---|---|---|
| Cost | None (a few hundred bytes from the CDN) | A write and a read per measurement, per device | One invocation per measurement |
| Signed out, sign-in screen | Works | Needs a writable document: either auth, or a public write that anyone can abuse | Works, if public |
| Precision | About 0.5 s plus half the round trip | Milliseconds, but the commit time inside the round trip is unknown | Milliseconds, but a cold start can make the round trip seconds long |
| Offline or slow network | Fails cleanly; keep the last offset | The write queues and resolves later, giving a wrong offset unless handled | Fails; keep the last offset |
| New parts to deploy | One static file and one header rule | A rules change and a collection | A function in every install |
| Catch | Must bypass caches (T-D2) | Cost grows with devices and tabs | Cost and cold starts |

The Realtime Database's `.info/serverTimeOffset` is built for exactly this, but Arc does
not use the Realtime Database, and adding one to every install is not worth it.

On `npm run dev` the answer comes from the dev server on the same machine, so the offset
is about 0: right, and harmless. Testing a wrong device clock needs a deployed site, or
the test helpers (T2).

## 5. Phases

Each phase ends with its tests green and a critical review of the phase; fixes from the
review land before the next phase starts.

### T1. Zones and formatting (pure code, no Angular)

- `src/app/core/time/zones.ts`: `isZone()`, `canonicalZone()`, `deviceZone()`,
  `zoneOffsetMinutes(zone, moment)`, `zoneCity(zone)`, `zoneLabel(zone, moment, locale)`
  ("Zurich, GMT+2"), `allZones()` (from `Intl.supportedValuesOf('timeZone')`, canonical,
  sorted).
- `src/app/core/time/arc-time.ts`: `toMoment()`, `formatArcTime()` with every format of
  T-D12 and T-D13, `zonedDayKey()` for day boundaries.
- Tests: Europe/Zurich on both sides of the summer change (last Sunday of March and of
  October, including the hour that happens twice), Asia/Kolkata (+05:30, no summer time),
  America/Phoenix (no summer time while the rest of Arizona's neighbours change),
  "Today" and "Yesterday" for Anna and Ravi from the same moment, the place label with and
  without a day change, an Angular pattern on each side of a summer change, old zone names,
  unknown zones, every moment input of T-D14, 12 and 24 hours by locale.
- Critical review of T1.

### T2. The clock

- `public/_arc/clock.json` and the `firebase.json` header rule (T-D2).
- `src/app/core/time/clock-sync.ts` (pure: build the request, read an answer, accept or
  ignore it, compute the offset) and `src/app/core/time/arc-clock.ts` (the service, T-D4
  to T-D6).
- `src/custom/clock.ts` (starter, shipped empty), its type and check, its hash in
  `SHIPPED_FILES` (`scripts/custom-starters.mjs`), and the build check in `vite.config.ts`.
- Tests: the offset from a stubbed answer (device fast, device slow, in sync); a cached
  answer (an `Age` header, a missing `Date`, a slow round trip) is ignored and the last
  offset kept; the request URL is new each time and `cache: 'no-store'`; no service worker
  rule matches `/_arc/`; the offset survives a reload offline and `synced()` stays false;
  `skewed()` with the default and a custom threshold; measuring on start, online, visible
  (throttled) and every 30 minutes with fake timers; nothing runs on the server render.
- Critical review of T2.

### T3. Site zone, member zone and the pipe

- `ArcZones` (`src/app/core/time/arc-zones.service.ts`): `device()`, `member()`,
  `memberChoice()`, `site()`, `useMemberZone(zone | null)`, plus `setMemberZone()`.
- `timeZone` on `ILocalizationSettings` (kept by `normalizeLocalizationSettings` and by
  every save of the Localization page), the site zone block on Settings, Localization, the
  onboarding write, the "no time zone yet" prompt (T-D9).
- `<arc-zone-picker>`, the "Time zone" row on the profile page, `<arc-clock>`.
- `ArcTimePipe` and `ArcTime` (T-D15). Translation keys in English and Hindi; the member
  ones added to `member-keys.ts`.
- Tests: fallbacks of T-D11; the member choice kept and cleared; onboarding writes the
  browser's zone; the Localization page saves the zone without losing the languages, and
  saves the languages without losing the zone; the pipe re-formats `ago` as the clock
  moves and only then; `<arc-clock>` shows the warning only when skewed; the picker
  filters and shows "Automatic"; the member screens' pseudo-language test covers the new
  row.
- Browser check at localhost:5173: onboarding is not re-runnable on xlm, so the onboarding
  write is covered by tests; the Localization page and the profile row are checked by eye.
- Critical review of T3.

### T4. Core screens move to `arcTime`

- Every `| date` use listed in section 1 moves to `arcTime` in the member zone; the
  editor's fixed 12-hour pattern becomes `dateTime`, so a Swiss admin sees 24 hours.
- `app-global-table` gets an optional `dateZone` per column (a zone, or a function of the
  row, for a table of several places); its `dateFormat` keeps working (T-D12).
- The guard test of T-D19.
- Tests: each moved screen shows a known moment in a chosen member zone.
- Browser check of the moved admin screens at localhost:5173.
- Critical review of T4.

### T5. Published dates in the site zone

- `siteTimeZone()` (T-D18), passed to the date formatting in
  `functions/src/shared/content-cards.ts`, `functions/src/shared/template-hydration.ts`
  and `functions/src/pages/deployContentPage.ts`, and to their browser twins
  (`src/app/core/utils/content-cards.ts`, `template-hydration.service.ts`).
- Tests: an article published at 00:30 Zurich shows that day with the site zone, the day
  before in UTC; unset zone gives UTC as today.
- Needs a deploy of the publish functions (targeted list given at the end of T5), then a
  republish to see it on live pages.
- Critical review of T5.

### T6. Docs and final review

- New `docs/app/clock-and-zones.html`: what each zone is for, `ArcClock`, `arcTime` and its
  formats, the place plug point, `<arc-zone-picker>` and `<arc-clock>`, the chat example,
  stamping records (server first, `exact()` when it must be the device), testing a wrong
  clock.
- `docs/app/custom-space.html`: `src/custom/clock.ts` in both tables, and the new building
  blocks.
- Every page `npm run docs:affected` lists, the docs index and nav, and screenshots of
  Settings, Localization and the profile page.
- `npm run check:docs`, the whole suite (`npm run test`), and a final critical review of
  all phases.

## 6. Backlog (not in this work)

- Date-only admin screens that call `toLocaleDateString('en-US', ...)` (version history,
  tags, waitlists and their users, content types, drafts table, checkout success). They show
  the device's day and a fixed US format; move them to `arcTime: 'date'` when touched.
- A zone on the user record, for emails in the member's zone.
- Sharing one measurement across open tabs.

## 7. What the app side does later (Arc POS, not here)

For reference only, so the plug points fit: a country pack fills a location's `zone`
(`Europe/Zurich`) with `<arc-zone-picker>` as the override; sales show
`arcTime(sale.at, 'place', location.zone)`; the POS footer is `<arc-clock>` in the
location's zone, which warns when the till's clock is off; records stamped on the device
use `ArcClock.exact()` instead of `Date.now()`.
