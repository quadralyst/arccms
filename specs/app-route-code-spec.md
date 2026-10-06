# Route Code Stored Ahead, and Recovery From Missing Code: Build Spec (A8)

**Status:** spec written 2026-10-06, not built.
**Branch:** `feat/app-route-code`, cut from `feat/app-pwa-update` (e5a7c45), because it uses
A6's route flag. Merge A6 first, then rebase this on `dev`.
**Scope:** two gaps found while testing A6 (`specs/app-pwa-update-spec.md`, section 6):

1. **Stored ahead.** With the PWA on, an app can have the code of its screens stored on the
   device when the app installs or updates, so a screen opens even if it was never opened
   before: offline (with A3's data cache, `specs/app-offline-cache-spec.md`) and after a
   deploy has removed the old version's files from the server.
2. **Recovery.** When a screen's code cannot be loaded (with or without the PWA), Arc does
   something sensible instead of nothing: today the click does nothing at all and the
   error is only in the console.

**Out of scope:** storing data, images or content pages ahead; keeping several old versions
on the server (a Hosting setting, not Arc); retrying a failed load more than once.

---

## 1. What is true today

- The service worker (`vite.config.ts`, `VitePWA` `workbox`) stores **up front only** the
  CSS, fonts and the main bundle (`assets/index-*.js`, 1.6 MB). Every other code file (214
  more, 4.9 MB, about 6.5 MB of code in all) is stored **the first time it loads**
  (`arc-code`, cache first, 300 entries, 30 days).
- A large part of the code is admin only: the content editor alone is 564 KB, and the
  content, media settings and export pages add more. A till never needs it.
- A deploy replaces the hashed code files on Hosting. A page of the old version can still
  open what it opened before (it is stored) but **not a screen it never opened**: the
  router's lazy import fails with "Failed to fetch dynamically imported module" (seen in
  the A6 browser check), `NavigationError` only stops the progress bar (`app.ts`), and the
  person's tap does nothing.
- The same failure happens with the PWA off, on any tab left open across a deploy.

## 2. Decision log

| # | Decision | Choice |
|---|----------|--------|
| R-D1 | The setting | `routeCode: 'visited' \| 'app' \| 'all'` in `src/custom/pwa.ts` (`PwaConfig`), default `'visited'`, which is today exactly. It only matters with the `pwa` feature on. |
| R-D2 | `'app'` | Also stored up front: the code of **every screen outside the admin area** (the app's own pages, the member area, sign-in, the public app pages) and every code file those import. The admin's screens are not, unless a non-admin screen shares the file. |
| R-D3 | How `'app'` is chosen | From the build's own chunk graph, not from file names: a small Vite plugin records each chunk's file, its source module and its static and lazy imports (`generateBundle`), and a pure function walks from the main bundle along every import **except a lazy import into an admin page** (a source file under `src/app/pages/admin/` or `src/app/pages/admin.page.ts`). What it reaches is stored ahead, through Workbox `globPatterns` plus a `manifestTransforms` filter. A page moved or renamed is followed automatically. |
| R-D4 | `'all'` | Every code file, for an app whose admins also work offline. |
| R-D5 | Size, said out loud | The build prints what is stored ahead and its size, in a line such as "PWA: 87 files, 2.4 MB stored when the app installs or updates" (numbers made up), and warns above 15 MB. The docs give today's sizes for the three values. |
| R-D6 | Recovery on a normal page | When the router fails to load a screen's code (the error matches Chrome's, Safari's or Firefox's wording for a failed lazy import), Arc **loads the address the person asked for, fresh** (`location.assign`). The tap then lands on that screen in the new version, which is what they wanted. A guard in `sessionStorage` stops a loop: if the same address failed again within 10 seconds of such a load, Arc stops and shows a short message with a Reload button instead. |
| R-D7 | Recovery on an app-owned page | On a page with `data: { pwaUpdate: 'app' }` (A6) **Arc never reloads**. It sets a read-only signal, `StaleCodeService.stale()`, and leaves the decision to the app (show "update needed", reload at a safe point with `reload()`). The navigation simply does not happen, as today. |
| R-D8 | Default behaviour change | R-D6 applies to every install, PWA or not. It changes a tap that **does nothing** into one that works, so it is treated as a fix, not an opt-in. Called out in the docs and the merge note. |
| R-D9 | A6 and A8 together | With `routeCode: 'app'`, an old version keeps opening every non-admin screen from its stored code after a deploy, until the person (or the app, through A6's `applyUpdate()`) updates. A8's recovery is the backstop for anything not stored. |

## 3. Build

**A8.1 Selection.** `src/app/core/pwa/route-code.ts`: the pure walk (R-D3), tested on fake
chunk graphs. `scripts/vite-route-code.ts`: the plugin that records the graph and feeds
`manifestTransforms`, and prints the R-D5 line. `PwaConfig.routeCode` with its default and
validation in `pwa-config.ts`; `vite.config.ts` uses it.

**A8.2 Recovery.** `src/app/core/version/stale-code.service.ts`: listens for
`NavigationError`, recognises a failed lazy import, applies R-D6 or R-D7 (using A6's
`routeOwnsPwaUpdate` on the page the person is on), exposes `stale()` and `reload()`. The
message for R-D6's stop case is a small core component with `en` and `hi` strings.

## 4. Tests

- Walk: `'visited'` adds nothing; `'app'` includes a lazy member page, the app's own pages
  and their imports, a chunk shared by admin and member pages, the translation chunks;
  excludes admin-only chunks and anything reached only through them; `'all'` includes
  everything; cycles do not loop.
- Config: the default is `'visited'`; a bad value stops the build with a message.
- Recovery: the three browsers' messages are recognised and an ordinary navigation error is
  not; a normal page calls `location.assign` with the target address; the loop guard shows
  the message on a second failure; a `pwaUpdate: 'app'` page never reloads and sets `stale()`;
  `reload()` reloads.
- `pwa-no-silent-reload.spec.ts` (A6) is updated: the only automatic load is R-D6's, and
  never on an app-owned page.
- The existing PWA, app and full-screen specs pass unchanged.

## 5. Docs

- `docs/app/pwa.html`: "Open screens offline and after a deploy": the three values, sizes,
  how `'app'` is chosen, and that it pairs with A3 for offline use and with A6 for updates.
- `docs/features/pwa.html`: what is stored ahead, by setting.
- `docs/app/pages-and-routes.html`: on a `pwaUpdate: 'app'` page Arc never reloads, also for
  missing code; `StaleCodeService`.
- `docs/operations/deploy.html`: what happens to pages left open across a deploy, before and
  after this change.
- Run `npm run docs:affected`, `npm run docs:index`, `npm run check:docs`.

## 6. Checks before it is done

- Suite, build and docs checks green.
- In the browser, with a production build and `vite preview` (as in A6):
  1. `routeCode: 'app'` with a temporary app route: after install, the service worker's
     store lists the app route's code and not the content editor's; with the preview server
     stopped (no network), the app route opens though it was never visited.
  2. `routeCode: 'visited'`, PWA off: open `/`, ship a new build, tap a link to a screen not
     opened before: it opens in the new version (R-D6). On a `pwaUpdate: 'app'` page the same
     tap does nothing and `stale()` turns true (R-D7).
- Temporary routes and settings removed afterwards.
