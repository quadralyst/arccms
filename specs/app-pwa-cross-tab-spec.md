# Another Tab's Update Never Reloads an App-Owned Page: Build Spec (F2)

**Status:** built 2026-10-06 on `fix/pwa-cross-tab-reload`; suite green, docs updated
(docs/app/pwa.html, docs/features/pwa.html). The two-tab check in a real browser is in the
end-of-work checks. Not yet merged to `dev`.
**Branch:** `fix/pwa-cross-tab-reload`, cut from `dev` (0e06e38).
**Scope:** A6 (the PWA update control) promised that a page with `data: { pwaUpdate: 'app' }`
is never reloaded by Arc CMS. The PWA library broke that promise from another tab: when any
one tab applies an update, every open tab reloads. This takes the reload away from the
library. Normal pages behave as today.

**Out of scope:** the update bar, the caching rules, and what an app shows for the update.

---

## 1. What was wrong

- `PwaService` registers through vite-plugin-pwa's `registerSW` (1.3.0, the build bundles
  `dist/client/build/register.js`). In prompt mode, once a new version is waiting, it adds a
  workbox-window `controlling` listener that calls `window.location.reload()` unless the
  caller passes `onNeedReload`.
- workbox-window hears a new version installed by another tab too (`waiting` with
  `isExternal`), and fires `controlling` in **every** open tab when any tab applies it,
  because the new service worker takes over all of them.
- So Update in tab A reloaded an opted-in page in tab B, mid-task. The no-silent-reload test
  only scanned Arc CMS's own source.

## 2. Decision log

| # | Decision | Choice |
|---|----------|--------|
| X-D1 | How to stop the library's reload | Pass `onNeedReload` to `registerSW`. The library then never reloads by itself. Keeping the library (not our own workbox-window registration) keeps its registration error handling and update prompt exactly as they are. |
| X-D2 | Opted-in page, another tab updated | No reload. `updateReady()` turns (or stays) true, and the bar-closed flag is cleared. The page keeps running the old version. |
| X-D3 | `applyUpdate()` after that | The new version already controls the page, so there is nothing to ask the service worker: it reloads the page. |
| X-D4 | The tab that applied the update | Reloads, as before, even on an opted-in page: the app asked for it. |
| X-D5 | Normal page | Unchanged: reloads into the new version. |
| X-D6 | A newer version found after the switch | Applied through the service worker again (skip waiting, then reload). |
| X-D7 | `StaleCodeService.stale()` | Not set by the switch itself. It still turns true if a screen's code is then missing, as in A8. `updateReady()` is the signal for this case. |
| X-D8 | How the page reloads | Through a root `PWA_RELOAD` token (default `location.reload()`), so tests can watch it. |

## 3. Build

- `src/app/core/pwa/pwa.service.ts`: `onNeedReload` calls `onNewVersionInControl()`, which
  checks `routeOwnsPwaUpdate()` on the current route before any reload; `applyUpdate()`
  reloads directly once the switch happened; `PWA_RELOAD` token.

## 4. Tests

- `src/app/core/pwa/pwa-cross-tab.spec.ts` runs the library's real registration code, filled
  in the way the plugin fills it, over stand-ins for workbox-window and the page:
  - with no `onNeedReload`, the library reloads the page by itself (pins the danger);
  - on an opted-in route, another tab's `controlling` reloads nothing and turns
    `updateReady()` on, and `applyUpdate()` then reloads without asking the service worker;
  - on an opted-in route, the app's own `applyUpdate()` still reloads;
  - on a normal page, the new version reloads the page;
  - a newer version found after the switch goes through skip waiting again.
- `src/app/core/pwa/pwa-no-silent-reload.spec.ts`, extended to third-party code: the plugin
  bundles `client/build/register.js`; `injectRegister: false` and only `pwa.service.ts`
  imports `virtual:pwa-register`; every `location.reload()` in the library's registration
  code is the `onNeedReload` fallback, and it navigates no other way (an upgrade that
  changes this fails); `PwaService` always passes `onNeedReload`, which checks the route
  before `PWA_RELOAD`, and reloads nowhere else but `applyUpdate()`.

## 5. Docs

- docs/app/pwa.html: "When another tab updates" under "Show the update yourself". Also
  neutral wording in two examples.
- docs/features/pwa.html: "Safe updates" says other open tabs reload, except app-owned pages.
- No screenshots change.

## 6. End-of-work checks (browser)

Production build with the `pwa` feature on, served by `vite preview`, a temporary route
with `data: { fullScreen: true, pwaUpdate: 'app' }`:

1. Open the flagged route in tab B and a normal page in tab A.
2. Ship a second build; in A, wait for the bar (or call `checkForUpdate()`), click Update.
3. A reloads into the new build. B does **not** reload; in B, `updateReady()` is true.
4. In B, call `applyUpdate()`: B reloads into the new build.
5. Repeat with B on a normal page: B reloads when A updates, as before.
