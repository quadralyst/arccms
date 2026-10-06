# Offline Firestore Cache: Build Spec (A3)

**Status:** spec written 2026-10-06, not built.
**Branch:** `feat/app-offline-cache`, cut from `dev` (10c8734).
**Scope:** an install can turn on Firestore's offline cache, so a signed-in page keeps
showing the data it has loaded, and writes made offline are sent when the connection
returns. It is an install setting, off by default, with a documented helper to wipe the
cache. An install that does not set it behaves exactly as today.

**Out of scope:** caching the app shell for offline start (the PWA feature does that),
offline sign-in, queueing callable functions, conflict handling beyond what Firestore does,
and automatic clearing on sign-out (decision O-D5).

---

## 1. What is already true

- `src/app/core/config/arc-firebase.ts` is the only file that creates Firestore:
  `arcFirestore()` calls `getFirestore()` for the `(default)` database and
  `getFirestore(app, databaseId)` for a named one. `arc-config-guard.spec.ts` enforces it.
- The build is browser only (`ssr: false`), so there is no server rendering of the app.
  IndexedDB is still checked at runtime, because a browser can refuse it (some private
  windows).
- Install settings flow: `arccms.config.json` (per project, gitignored) to
  `scripts/arc-configure.mjs` to the generated `src/environments/arc-install.ts` to
  `arc-config.ts` (`ArcInstallConfig`, `resolveArcConfig`). `adminOnlySignIn` is the
  closest existing example.

## 2. Decision log

| # | Decision | Choice |
|---|----------|--------|
| O-D1 | The setting | `offlineCache: "off" \| "single-tab" \| "multi-tab"` in `arccms.config.json`, shared by all projects or set per project like every other key. Default `"off"`. `arc:configure --offline-cache=<value>` sets it. |
| O-D2 | What "on" does | `arcFirestore()` calls `initializeFirestore(app, { localCache: persistentLocalCache({ tabManager }) }, databaseId)`, with `persistentSingleTabManager` or `persistentMultipleTabManager` by the setting. Named databases work: the id is the third argument. For the `(default)` database the id is left out. |
| O-D3 | When it falls back | If IndexedDB is missing or `initializeFirestore` throws (it throws when called twice with different options, which hot reload in `npm run dev` does), `arcFirestore()` falls back to plain `getFirestore()` and logs one line. The app never fails to start over the cache. |
| O-D4 | Browser only | The cache is created only when `typeof indexedDB !== 'undefined'`. Server rendering, if it ever returns, gets the plain instance. |
| O-D5 | Clearing | `clearOfflineCache()`, exported from `src/app/core/config/arc-firebase.ts` and documented. It waits for queued writes to be sent (up to a timeout, default 5 seconds), then terminates Firestore, clears the stored data and reloads the page. If writes are still queued it stops with a clear error, unless called with `{ discardPendingWrites: true }`. **Arc does not clear on sign-out by itself**, because clearing offline loses unsent writes and signing out offline must not hang. The docs tell shared-device apps to call it deliberately. |
| O-D6 | Guard | The one-file rule in `arc-config-guard.spec.ts` is widened to `initializeFirestore` and `persistentLocalCache` too. |
| O-D7 | Nothing else changes | No store or service is rewritten. Reads and writes go through the same Firestore instance, so the cache applies to all of them. |
| O-D8 | Security rules and the cache | **Reads served from the cache are not checked by security rules**: the rules run on the server, and offline there is no server. Whatever one person loaded on a device can be returned to the next person's queries on that device while offline (and, until the server answers, briefly online). The docs say this plainly, with the choice it leaves an app on a shared device: accept it (staff who share the data anyway), or call `clearOfflineCache()` when the person changes. |
| O-D9 | Opening screens offline | The cache holds **data**, not the app's code. A screen whose code was never loaded on the device cannot open offline. Storing route code ahead is `specs/app-route-code-spec.md` (A8); the docs link the two. |

## 3. Build

**A3.1 Setting.** Add `offlineCache` through the whole chain: `ArcInstallConfig` and
`ResolvedArcConfig` in `arc-config.ts` (unknown or missing value resolves to `"off"`),
`FLAG_KEYS`, `normalizeConfig`, `validateConfig` and `appValues` in `arc-configure.mjs`
(emitted into `arc-install.ts` only when not `"off"`), and `arccms.config.example.json`.

**A3.2 Startup.** `arcFirestore()` as in O-D2 to O-D4.

**A3.3 Helper.** `clearOfflineCache(options?)` as in O-D5. It needs the live Firestore
instance, so it is a function of `inject`ed state: callable from a component or service.

## 4. Tests

- `arc-firebase.spec.ts` (update its mock to include `initializeFirestore` and
  `persistentLocalCache`): off calls `getFirestore` exactly as today, for default and
  named databases; single-tab and multi-tab call `initializeFirestore` with the right
  manager and database id; a throw falls back to `getFirestore`; no IndexedDB falls back.
- `arc-config.spec.ts`: the three values, and a bad value resolving to `"off"`.
- `arc-configure.spec.ts`: the flag, validation, shared and per-project value, and that
  `"off"` is not written to `arc-install.ts`.
- `arc-config-guard.spec.ts`: widened as O-D6.
- `clearOfflineCache` unit tests: waits, refuses with writes pending, discards when asked.
- All existing tests pass with the setting off (the default).

## 5. Docs

- New `docs/app/offline.html`: the setting; **what offline covers**: writes queue while
  offline, reads come from the cache, a page that already loaded keeps showing its data;
  **what it does not**: callables, transactions and batches that read first, first sign-in
  and new sign-ins, anything never loaded, search, uploads; the shared-device note and
  `clearOfflineCache()`; that cached reads are not checked by security rules (O-D8); that a
  screen never opened cannot open offline without A8 (O-D9); the browser-limit note (a private window may refuse the cache); how
  it differs from the PWA's offline start.
- `docs/reference/config-keys.html`: the new key. `docs/getting-started/configure.html`
  and the `arc:configure` page if it lists flags.
- `docs/app/custom-space.html`: link to the new page. Run `npm run docs:affected`.

## 6. Checks before it is done

- `npm run test -- --run` green, `npm run build` ok, `npm run check:core` clean.
- Browser check on `localhost:5173` (it talks to the real dev project, no deploy needed):
  set `offlineCache` to `multi-tab`, run `npm run arc:configure`, open a signed-in page,
  go offline in the browser tools and reload data views (still shown), make a write
  offline, go online and see it sync. Then set it back to `off` and confirm the old
  behaviour.
