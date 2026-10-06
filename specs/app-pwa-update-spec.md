# App-Chosen PWA Update: Build Spec (A6)

**Status:** built 2026-10-06 on `feat/app-pwa-update`; suite green, docs updated, checked in a real browser against a production build (see section 6). Not yet merged to `dev`.
**Branch:** `feat/app-pwa-update`, cut from `dev` (10c8734).
**Scope:** an app built on Arc CMS decides when its people are offered a waiting PWA
update. Today the update bar is held by CSS on full-screen routes and comes back on the
next normal page, so an app that lives only on full-screen routes is never offered an
update. This adds a small public API and one route flag. Nothing changes for pages
that do not use them.

**Out of scope:** the update bar's look, the install prompt, the service worker's caching
rules, and any automatic or forced update.

---

## 1. What is already true

- `registerType: 'prompt'` in `vite.config.ts`, with no `skipWaiting` or `clientsClaim`:
  a new version waits until someone applies it. Arc never reloads by itself.
- `PwaService` (`src/app/core/pwa/pwa.service.ts`) has the signal `updateReady` (true
  when a version is waiting) and `update()`, which applies it and reloads.
- `PwaUpdateBarComponent` shows the bar when `updateReady()` is true. `app.ts` hides it
  with CSS while `FullScreenService.active()` is true. The signal stays true meanwhile.
- The service worker checks for a new version once an hour.

So most of the signal already exists. The gaps are a documented, stable API, a way to
check on demand, and a way for an app to own the prompt on routes that are not full screen.

## 2. Decision log

| # | Decision | Choice |
|---|----------|--------|
| P-D1 | Public API | `PwaService` documents three members: `updateReady` (a **read-only** signal), `applyUpdate()` and `checkForUpdate()`. `update()` stays as an alias of `applyUpdate()` so nothing breaks. |
| P-D2 | Read-only signal | `updateReady` is exposed with `asReadonly()`. The bar's close button uses a new `dismissUpdate()`, which sets a separate read-only `updateBarClosed` signal. **Closing the bar does not clear `updateReady`**, so an app can still apply an update the person closed. A newer version found later opens the bar again. |
| P-D3 | Check on demand | `checkForUpdate()` asks the service worker to look now, resolving when it has looked. An app can call it when a lock screen opens, instead of waiting up to an hour. It does nothing when the `pwa` feature is off. |
| P-D4 | Route opt-in | `data: { pwaUpdate: 'app' }` on a route. **Any route on the way to the page can set it, and every page below inherits it.** On such a page Arc's bar is not shown at all (not merely held), because the app shows the update itself. |
| P-D5 | Full-screen routes without the flag | **Unchanged.** The bar is held and returns on the next normal page, as today. |
| P-D6 | No silent reloads | Arc never calls `applyUpdate()` on its own, on any route. A test asserts that the only callers are the bar's button and app code, and that the service worker config has no `skipWaiting`, `clientsClaim` or `autoUpdate`. |
| P-D7 | Feature off | With the `pwa` feature off there is no service worker: `updateReady` is always false and both methods do nothing. Documented. |
| P-D8 | The flag's value | `'app'` is the only value. Absent means Arc shows the bar. Other values are ignored, so a later value can be added without a break. |

## 3. Build

**A6.1 Service.** In `pwa.service.ts`: read-only `updateReady`, `applyUpdate()`,
`checkForUpdate()`, `dismissUpdate()`. Keep the registration from `registerSW`'s
`onRegisteredSW` so `checkForUpdate()` can call `registration.update()`.

**A6.2 Route flag.** `src/app/core/pwa/pwa-update-route.ts`: `routeOwnsPwaUpdate()` reads
`pwaUpdate` along the activated route, and `PwaUpdateRouteService` keeps a signal of it
(like `FullScreenService`). The two existing readers differ (`fullScreen` takes the deepest
value, the feedback button hides if any route says so) and are left alone. The bar itself
reads the signal and renders nothing on such a page, so no CSS in `app.ts` is needed.

**A6.3 Bar.** `update-bar.component.ts` calls `applyUpdate()` and `dismissUpdate()`, and
shows only when an update is waiting, the bar was not closed and the app does not own the
update on this page.

## 4. Tests

- `pwa.service.spec.ts`: `updateReady` follows `onNeedRefresh`; `applyUpdate()` applies
  and clears it; `checkForUpdate()` calls the registration's update and is a no-op with
  the feature off; the signal cannot be written from outside.
- `pwa-update-route.spec.ts` and `update-bar.component.spec.ts`: the flag is read from the
  page or any route above it, other values are ignored, the bar is hidden on a flagged page
  (full screen or not) and shown on a normal one. The existing `app.spec.ts` full-screen
  tests keep passing unchanged: a full-screen page without the flag still holds the bar.
- `pwa-no-silent-reload.spec.ts` (P-D6): prompt mode and none of the three words in
  `vite.config.ts`, and the only caller of `applyUpdate()`/`update()` is the bar.
- `pwa-update-off.spec.ts` (P-D7): the feature off registers nothing and the methods do nothing.
- Existing PWA and bar specs keep passing.

## 5. Docs

- `docs/app/pwa.html`: a section "Show the update yourself", with a lock-screen example
  that reads `updateReady()`, calls `checkForUpdate()` on open and `applyUpdate()` on a tap.
- `docs/app/pages-and-routes.html`: add `pwaUpdate` next to `fullScreen` in the route data.
- `docs/app/custom-space.html`: mention the API under the core building blocks.
- Run `npm run docs:affected`. No screenshots change (the bar itself is unchanged).

## 6. Checks before it is done

- `npm run test -- --run` green, `npm run build` ok, `npm run check:core` clean.
- The service worker only runs in a production build, so the browser check is
  `npm run build` then a preview server: ship a second build, see `updateReady` flip on a
  flagged full-screen route, see the bar stay hidden, see `applyUpdate()` reload to the new
  build. No deploy needed.

**Checked 2026-10-06** with a temporary full-screen route carrying `pwaUpdate: 'app'`, the
`pwa` feature on, a production build served by `vite preview` and two further builds
shipped over it: `checkForUpdate()` found the new version and `updateReady()` turned true;
Arc's bar stayed hidden on the flagged page and the page stayed on the old build (no
reload); `applyUpdate()` reloaded into the new build; on a normal page with a newer build
waiting, Arc's bar showed as before. Finding: a deploy removes the old version's code files,
so an old page cannot load a route it had not opened yet until the update is applied; the
docs tell apps to offer the update early. The temporary route and features change were
removed.
