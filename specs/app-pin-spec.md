# PIN Building Block for Apps: Build Spec (A4)

**Status:** built 2026-10-06 on `feat/app-pin-kit`; suite and rules tests green, docs updated (new page docs/app/pin.html). A real PIN sign-in on the dev project is in the end-of-work checks. Not yet merged to `dev`.
**Branch:** `feat/app-pin-kit`, cut from `dev` (10c8734).
**Depends on:** the A5 spec (on branch `feat/app-accounts`), which creates the app kit entry point
`functions/src/app-kit/index.ts`. This branch adds to it, so merge A5 first.
**Scope:** an app's own functions can set and check a 6 digit PIN, with lockout and rate
limits, using Arc's existing PIN code through documented exports. The app's PINs are kept
apart from Arc's phone PINs. Phone sign-in behaves exactly as today.

**Out of scope:** any screen, sign-in flow or callable for app PINs (the app writes
those), SMS reset for app PINs, changing the PIN rules (6 digits plus the weak PIN check),
and timed unlocking.

---

## 1. What is already true

`functions/src/auth/accounts.ts` holds `setPin`, `checkPin`, `hasPin`, `isWeakPin`,
`PIN_PATTERN`, `consumeRateLimit`, `callerKey` and `issueSignInToken`. The PIN code is
sound (peppered, scrypt, a transaction for the count) but:

- storage is fixed to `auth_pins/{uid}` and the limit to 5 (`MAX_PIN_ATTEMPTS`);
- `setPin` does not check length or weakness (its callers do);
- a lock is cleared only by `setPin`, in practice by the SMS reset;
- `issueSignInToken`'s failure message says "Phone sign-in isn't ready";
- nothing tells an app which of these it may rely on: apps can import them by relative
  path, with no promise they stay.

Two facts from the rules that shape the storage choice:

- Collections named `arc_*` are **public to read**, and `Tags_*` too (`firestore.rules`,
  the `match /{collection}/{docId}` block). If an app chose its own collection name for
  PINs, one wrong prefix would publish PIN hashes.
- Everything not matched is denied by default, but Arc's own secrets (`auth_pins`,
  `_rate_limits`) also have an explicit deny rule and a rules test, which is the pattern to follow.

## 2. Decision log

| # | Decision | Choice |
|---|----------|--------|
| N-D1 | Storage | **One fixed core collection, `app_pins`**, document id `<namespace>__<uid>`, with `uid` and `namespace` fields. An app chooses only the namespace (`till`, `staff`), never a collection name, so an app PIN cannot share `auth_pins` and cannot land in a public prefix. Arc's rules deny all client access to `app_pins`, with a rules test beside the one for `auth_pins`. |
| N-D2 | Namespace | Lower case letters, digits, `-` and `_`, starting with a letter, 2 to 31 characters, no `__`. Anything else throws at the call. |
| N-D3 | API shape | `createPinStore(namespace, { maxAttempts })` in the app kit returns `{ set, check, has, clearLock, remove }`. The namespace and the attempt limit (default 5, 1 to 20) are fixed once, so a call cannot forget them. These are the brief's `setPin`, `checkPin`, `hasPin` and `clearPinLock`, plus `remove`. |
| N-D4 | What `set` does | Validates (`PIN_PATTERN`, then `isWeakPin`) and throws `HttpsError('invalid-argument')` with a plain message, then stores. Storing replaces the record, which also clears any lock. Arc's internal `setPin` stays as it is (no validation), because its callers validate. |
| N-D5 | `check` | Returns Arc's existing result (`ok`, or `none`, `locked`, `wrong` with `remaining`), through the same transaction and the same count, with the store's attempt limit. |
| N-D6 | Unlocking | `clearLock(uid)` resets `failedAttempts` without changing the PIN; `set` also clears it. Both are the app's call. Arc's SMS reset still applies to phone PINs only. |
| N-D7 | One implementation | The internal functions gain an optional store argument (`collection`, `docId`, `maxAttempts`) defaulting to `auth_pins/{uid}` and 5. The app kit calls the same code, so there is no second copy to keep correct. The phone PIN tests run unchanged. |
| N-D8 | Deletion | `onUserDeleted` also deletes `app_pins` documents whose `uid` is the person, so an app PIN never outlives its account. Tested. |
| N-D9 | Rate limits | `consumeRateLimit(key, max, windowMs, message)` is exported as it is. New `hashedKey(scope, value)` returns the hash an app should pass as `key`, prefixed with the scope, so apps choose their own key (a device id, a staff id) without writing raw values or colliding with Arc's keys. |
| N-D10 | `callerKey` | Today it takes the **last** `X-Forwarded-For` entry, which is the caller's address for a request that reaches a callable straight from Google's front end (all of Arc's callables: the browser calls them through the Functions SDK, not through Hosting). Behind a Hosting rewrite the last entry is the proxy's, so every caller would share one limit. Fix: `callerKey(request, { trustedProxies })`, default `0` (today's behaviour exactly); `1` skips one proxy at the end. The comment and docs say which paths need which. Decided 2026-10-06 not to run a header test now: an app that serves a callable through a rewrite can use an app-chosen key instead (N-D9) and the option is there when it needs it. |
| N-D11 | `issueSignInToken` | Exported through the kit. Its failure message and the admin alert become neutral ("Sign-in isn't ready on this site yet"), because it now serves more than phone sign-in. The text moves with its tests. |
| N-D12 | What the kit exports from this item | `createPinStore`, `isValidPin`, `isWeakPin`, `consumeRateLimit`, `hashedKey`, `callerKey`, `issueSignInToken` (A5 has already added the account and claims exports). |

## 3. Build

**A4.1 Internals.** Parametrize `setPin`, `checkPin`, `hasPin` in `accounts.ts` per N-D7.
Add `clearPinLock`. No behaviour change for `auth_pins`.

**A4.2 Kit.** `createPinStore`, `hashedKey`, `callerKey`'s option, the neutral token
message, all re-exported from `app-kit/index.ts`.

**A4.3 Rules and cleanup.** The `app_pins` deny rule in `firestore.rules`; the delete
step in `onUserDelete.ts`. (A rules deploy is needed for the explicit rule, though
default-deny already protects it before then.)

## 4. Tests

- `pin-store.spec`: set then check ok; wrong PIN counts down `remaining`; the Nth wrong PIN
  locks and the next correct one is still `locked`; `clearLock` unlocks without changing the
  PIN; `set` unlocks; weak and malformed PINs are refused at `set`; two namespaces for one
  uid are independent; the same namespace and uid never touch `auth_pins`; limit options
  1 and 20 work, 0 and 21 throw; bad namespaces throw.
- Parallel `check` calls cannot all read the same count (the transaction still holds).
- `callerKey`: default unchanged for every header shape the existing test covers;
  `trustedProxies: 1` picks the second from the end, falls back when there are too few.
- `hashedKey`: stable, scoped, never contains the raw value.
- The existing phone PIN, reset and sign-in tests pass without edits (except the message
  text in N-D11).
- `tests/rules`: `app_pins` joins the deny loop with `auth_pins`. (Java 21.)
- `onUserDelete`: removes `app_pins` for the uid, and only that uid.
- `app-kit.spec` (from A5): the export list now includes this item's names.
- `npm run build --prefix functions` before calling it done.

## 5. Docs

- New `docs/app/pin.html`: namespaces, limits and lockout, unlocking, rate-limit keys,
  what `callerKey` assumes, and **a complete custom callable** in `functions/src/custom/`:
  `signInWithAppPin` takes `{ staffId, pin, deviceId }`, rate limits by device and by staff
  id with `hashedKey`, checks the PIN with the store, and returns `issueSignInToken` for the
  account A5 made, plus the line for `public-callables.txt` and the browser call with
  `signInWithCustomToken`.
- `docs/app/functions.html`, `docs/app/custom-space.html`, `docs/app/rules-and-indexes.html`
  (`app_pins` is reserved) and the sign-in page for the neutral wording. Run `npm run docs:affected`.

## 6. Checks before it is done

- Tests green, `npm run build --prefix functions`, `npm run check:core`.
- On the dev project: deploy only the custom example and the changed core functions with
  targeted commands; set and check a PIN for an A5 account, watch the lock at the limit,
  clear it, sign in with the returned token. The rules deploy is separate (functions first,
  then rules).

**Built 2026-10-06.** As specced. Notes from building:

- `checkPin`, `setPin`, `hasPin` take an optional location (`PinLocation`: collection, doc id,
  attempt limit, extra fields), defaulting to `auth_pins/{uid}` and 5, so phone sign-in runs
  the same code unchanged; `clearPinLock` and `removePin` are new. A v1 PIN rewritten on a
  correct check keeps the app PIN's `uid` and `namespace` fields.
- `check()` treats a value that is not a string as a wrong PIN (it costs a try), so a client
  cannot probe the lock state for free.
- `hashedKey` keys start `app-<scope>-`, apart from every Arc CMS key.
- Account deletion queries `app_pins` by `uid`, so it needs no import from the app kit.
- The docs reference pages list `app_pins` (data model, security rules), and the rules page
  now warns apps that `arc_` and `Tags_` collection names are public.

**End-of-work checks (targeted functions deploy and a rules deploy, by Gunjan):** deploy the
docs' `signInWithAppPin` and `setStaffPin` as custom functions, set a PIN for an A5 app
account, sign in with it, watch it lock at the limit and unlock with `clearLock`, and see the
rate limit refuse after too many tries from one device id.

## Addendum: the phone sign-in PIN at an app's gate (2026-10-10)

Built on `feat/phone-pin-check`, merged into `dev` a20fe12. An app asked to let a signed-in
person open a gate inside it (a parent area) with the PIN they sign in with by phone. Using
`signInWithPin` there would let a child at the gate lock the parent's sign-in.

| # | Decision | Rule |
|---|---|---|
| N-D13 | API | `createPhonePinCheck(namespace, { maxAttempts })` gives `has`, `check` and `clearLock`; namespace and limit checked as for `createPinStore` (`checkPinOptions`). |
| N-D14 | The PIN | Read from `auth_pins/{uid}` and compared with `pinMatches()`, the code `checkPin` uses. Never written (a pre-pepper hash is left for sign-in to upgrade), never returned. Setting it stays with sign-in. |
| N-D15 | Wrong tries | Counted in `app_phone_pin_tries/<namespace>__<uid>` (`uid`, `namespace`, `pinId`, `failedAttempts`), closed by the rules. Never in `auth_pins`; a correct PIN deletes the count, and does not reset sign-in's. |
| N-D16 | Unlocking | `clearLock(uid)`, or a new phone PIN: `pinId` is a fingerprint of the PIN's salt, so a count for an older PIN is ignored. |
| N-D17 | Locks apart | The gate opens with the right PIN even while phone sign-in is locked: the caller is already signed in to that account. |
| N-D18 | Deletion | `onUserDeleted` removes the counts by `uid`, as for `app_pins`. |

Docs: docs/app/pin.html#phone-pin. Tests: `phonePinCheck.spec.ts`, `onUserDelete.spec.ts`, the rules test for closed collections.

