# App-Chosen PWA Update: Build Spec (A6)

**Status:** spec written 2026-10-06, not built.
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
| P-D2 | Read-only signal | `updateReady` is exposed with `asReadonly()`. The bar's close button uses a new `dismissUpdate()` instead of writing the signal, so an app cannot put the service in a wrong state. |
| P-D3 | Check on demand | `checkForUpdate()` asks the service worker to look now, resolving when it has looked. An app can call it when a lock screen opens, instead of waiting up to an hour. It does nothing when the `pwa` feature is off. |
| P-D4 | Route opt-in | `data: { pwaUpdate: 'app' }` on a route. **Deepest route wins and children inherit**, the same rule `data.feedbackButton` uses. On such a route Arc's bar is not shown at all (not merely held), because the app shows the update itself. |
| P-D5 | Full-screen routes without the flag | **Unchanged.** The bar is held and returns on the next normal page, as today. |
| P-D6 | No silent reloads | Arc never calls `applyUpdate()` on its own, on any route. A test asserts that the only callers are the bar's button and app code, and that the service worker config has no `skipWaiting`, `clientsClaim` or `autoUpdate`. |
| P-D7 | Feature off | With the `pwa` feature off there is no service worker: `updateReady` is always false and both methods do nothing. Documented. |
| P-D8 | The flag's value | `'app'` is the only value. Absent means Arc shows the bar. Other values are ignored, so a later value can be added without a break. |

## 3. Build

**A6.1 Service.** In `pwa.service.ts`: read-only `updateReady`, `applyUpdate()`,
`checkForUpdate()`, `dismissUpdate()`. Keep the registration from `registerSW`'s
`onRegisteredSW` so `checkForUpdate()` can call `registration.update()`.

**A6.2 Route flag.** A small helper reads `pwaUpdate` from the deepest activated route,
the way `routeIsFullScreen` and the feedback button read theirs (reuse a shared reader if
one exists; otherwise add one used by all three, without changing their behaviour).
`app.ts` adds a host class when the flag is `'app'`, and the stylesheet hides
`arc-pwa-update-bar` on it, next to the existing full-screen rule.

**A6.3 Bar.** `update-bar.component.ts` calls `dismissUpdate()` rather than writing the
signal.

## 4. Tests

- `pwa.service.spec.ts`: `updateReady` follows `onNeedRefresh`; `applyUpdate()` applies
  and clears it; `checkForUpdate()` calls the registration's update and is a no-op with
  the feature off; the signal cannot be written from outside.
- `app.spec.ts`: the bar is hidden on a route with `pwaUpdate: 'app'`, also when that
  route is not full screen; a full-screen route without the flag still hides it and the
  bar returns on a normal page; a child inherits the flag; a normal page is unchanged.
- A guard test for P-D6: the service worker options contain none of the three words, and
  update calls in `src/app` sit only in the bar and the service.
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
