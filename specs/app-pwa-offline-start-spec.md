# Offline Start After an Update, and the Page Wait: Build Spec (F7)

**Status:** built 2026-10-06 on `fix/pwa-offline-start`; suite green, docs updated
(docs/app/pwa.html, docs/features/pwa.html). The real-browser run of the reproduction is in
the end-of-work checks. Not yet merged to `dev`.
**Branch:** `fix/pwa-offline-start`, cut from `dev` (0e06e38).
**Scope:** with the PWA on, starting offline right after an update never opens a blank
page, at any address the service worker has stored; and an app can shorten how long a page
waits for the network.

**Out of scope:** what the app's data does offline (A3), which screens' code is stored
(A8's `routeCode`), and the update prompt (A6).

---

## 1. What was wrong

Reasoned from the generated service worker, then reproduced by the test in section 4.

- Page loads are `NetworkFirst` into the `arc-pages` cache (50 entries). Every address
  opened with a full page load is stored: for app addresses that is the SPA shell of the
  build that served it, which names that build's hashed code (`/assets/index-XXXX.js`).
- The precache holds the shell (`/__shell.html`) and the code. On an update the new service
  worker's activation deletes the old build's precached files. The entry script was always
  precached, so it was never in `arc-code` either.
- So, offline after an update (applied, or every tab closed so the new worker took over), a
  start at a stored address got the old shell from `arc-pages`, whose entry script was in no
  cache and not on the network: Angular never started, a blank page. Nothing in the app can
  recover from that, since no app code runs. (A browser's HTTP cache can sometimes still hold
  the old file, so it was not seen every time.)
- The same old copy answered after the 4 second wait when the network was up but the
  internet was not.
- Found by the test: with `routeCode: 'visited'` only `assets/index-*.js` was stored up
  front, so a code file the shell imports statically under another name would also be
  missing offline. Today's Arc CMS build has none, so nothing changes for it, but the rule
  now follows the chunk graph.

## 2. Decision log

| # | Decision | Choice |
|---|----------|--------|
| S-D1 | Which stored page may open | Only one whose start files (hashed `/assets/...js` and `.css` in `script src` and `link href`) are all still in a cache. Otherwise the current precached shell opens at the same address. A Workbox plugin on the pages route (`cachedResponseWillBeUsed`) does it, so it applies offline and after the wait alike. |
| S-D2 | Why not clear `arc-pages` on activate, or always answer with the shell | Published pages (home, info pages, content lists, written to Hosting by the functions) use no build code and are real content: their stored copies stay useful offline across updates. The check keeps them and drops only the pages that cannot start. |
| S-D3 | A stored page with no copy at all | Unchanged: the network, then the shell. |
| S-D4 | A page of the current build | Unchanged: its stored copy opens. |
| S-D5 | `pwaUpdate: 'app'` pages | Get the current shell like any other, so they run the new version. A screen whose code was never stored still fails to load; `StaleCodeService` then sets `stale()` and does not reload on such a page (A8, its own tests). |
| S-D6 | `routeCode: 'visited'` | Stores the main bundle and what it imports statically (from the chunk graph), not only files named `index-*`. Equal to before for today's build. |
| S-D7 | The wait | `navigationTimeoutSeconds` in `src/custom/pwa.ts` (`PwaConfig`), default 4, a number from 1 to 30; anything else stops the build with a message. |
| S-D8 | Where the settings live | The service worker's settings moved from `vite.config.ts` to `scripts/pwa-workbox.ts` (`pwaWorkbox()`), so the test builds a service worker from exactly what the build uses. |

## 3. Build

- `scripts/pwa-workbox.ts`: `pwaWorkbox({ transform, navigationTimeoutSeconds })` and the
  `currentBuildPages` plugin. The plugin's source is copied into `sw.js`, so it names
  nothing outside itself.
- `vite.config.ts`: `workbox: pwaWorkbox(...)`; the route-code recorder and transform run
  whenever the PWA is on.
- `src/app/core/pwa/pwa-config.ts`: `navigationTimeoutSeconds`, default and validation.
- `src/app/core/pwa/route-code.ts`: `visited` walks static imports from the entry.
- `src/custom/pwa.ts` is unchanged (the starter stays empty).

## 4. Tests

- `scripts/__tests__/pwa-offline-start.spec.ts` (in `npm run test`, no deploy, no browser):
  builds real service workers with workbox-build from `pwaWorkbox()` for two deploys of a
  small app (a shell with an entry, a preloaded file and styles, an app screen, an admin
  screen, a published page), and runs them with Workbox's own code over stand-ins for Cache
  Storage, the server and the network. It opens `/`, `/user/dashboard`, `/app/lock` and
  `/pages/privacy` on deploy 1, ships deploy 2, installs and activates it, goes offline and
  cold-starts at each address, loading every file the page starts with.
  - Without the plugin the old page opens and its entry script is missing (the blank screen).
  - With it, for `routeCode: 'app'` and `'visited'`: nothing missing at any address, no old
    build file named, the published page from its stored copy; the app screen's own code is
    there with `app`, and with `visited` it is missing, which is A8's recovery case.
  - A page stored by the current build still opens from its copy.
  - Network up, no internet, `navigationTimeoutSeconds: 1`: the page opens after about a
    second, on the new build.
  - The timeout reaches `sw.js`: 4 by default, the app's value when set.
  - Workbox runs as its development build there (the same code with its checks on); the
    production build is minified in worker threads that the suite's zone.js setup breaks.
- `route-code.spec.ts`: `visited` keeps the entry and its static imports; the timeout's
  default, a lowered value, and the values that stop the build.
- `pwa-no-silent-reload.spec.ts`: also checks `scripts/pwa-workbox.ts` for `skipWaiting`,
  `clientsClaim` and `autoUpdate`, and that `vite.config.ts` uses it.

## 5. Docs

- docs/app/pwa.html: "Start offline after an update", with the timeout setting.
- docs/features/pwa.html: the `navigationTimeoutSeconds` key, and the fresh-content line.
- No screenshots change.

## 6. End-of-work checks (browser)

Production build with the `pwa` feature on and `routeCode: 'app'`, served by `vite preview`
(`npm run build`, then `npx vite preview --port 5190 --outDir dist/client`), Chrome:

1. **Deploy:** build and serve. Open `/`, `/user/dashboard`, a member screen and an app
   route with a full page load each (type the address), so each is stored in `arc-pages`
   (DevTools, Application, Cache storage).
2. **Deploy again:** change any app code, build again, serve again.
3. **Update:** in the open tab click Update (or close every tab of the site).
4. **Offline:** DevTools, Network, Offline (or stop the preview server).
5. **Cold start at each stored address** (new tab, type the address): each opens on the
   new build, never blank. On a `pwaUpdate: 'app'` route nothing reloads; if a screen's
   code is missing, `StaleCodeService.stale()` is true.
6. **The wait:** with `navigationTimeoutSeconds: 2`, Network throttling set to a very slow
   custom profile (or a server that never answers): a page opens after about 2 seconds.
