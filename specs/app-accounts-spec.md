# App Accounts Without Email or Phone, and App Claims: Build Spec (A5)

**Status:** built 2026-10-06 on `feat/app-accounts`; suite and rules tests green, docs updated (docs/app/app-accounts.html, docs/app/app-kit.html). A real create, sign-in and delete on the dev project is in the end-of-work checks. Not yet merged to `dev`.
**Branch:** `feat/app-accounts`, cut from `dev` (10c8734).
**Scope:** an app built on Arc CMS can create people who have no email and no phone (for
example shop staff), sign them in with a custom token, put its own claims on them without
ever disturbing Arc's, and clean up its own data when they are deleted. This is the first
of two items that add the **app kit**, a small, documented, tested set of server exports
for an app's own functions (`functions/src/app-kit/`). The second is
the A4 spec (on branch `feat/app-pin-kit`).

**Out of scope:** how such a person proves who they are (the app decides: A4 gives it a
PIN), a UI for creating them in Arc's admin, changing the account-deletion flow itself,
and email or SMS to them (they have none, so Arc sends them nothing).

---

## 1. What is already true

- A record with `email: ''` and no email in Auth is a supported state: phone sign-up
  (`completePhoneSignup`, `phoneAuth.ts`) creates exactly that, with `owner.createUser({
  displayName })`.
- The member area gates on the resolved `users` record, not on the role (`userGuard`,
  `user.guards.ts`), so a plain `user` account is signed in. `auth.store` treats a missing
  record, or one with `isActive` unset, as signed out, so the record must carry
  `isActive: true`.
- `onUserCreated`, `onUserDeleted`, `deleteMyAccount`, the contact backfill and the
  announcements already skip an empty email. `user.deleted` already carries the Auth uid
  (`userId`) and the record id (`data.userDocId`), and no email.
- `mergeUserClaims` merges, never replaces, but reads then writes, so two writers can lose
  one write (its own comment says so).

What breaks for such a record today:

| Where | Problem |
|---|---|
| Admin edit user (`edit.[userId].page.ts`) | The email field is required and validated, so the form cannot be saved. |
| Admin view user | Shows an empty `mailto:` link beside "N/A". |
| `setPin` callable | Refuses without a phone. App accounts do not use it (A4 gives apps their own PIN). |
| Nothing creates the account | `adminCreateUser` needs an Arc admin and an email. |

## 2. Decision log

| # | Decision | Choice |
|---|----------|--------|
| C-D1 | Where the helpers live | `functions/src/app-kit/index.ts`, the one documented entry point for app functions. A test fails if it exports anything undocumented or omits anything documented. Apps import only from it; core internals stay free to change. |
| C-D2 | `createAppAccount(input)` | Creates the Auth account (`displayName` only) and the `users` record, sets `arccms_uid` and `arccms_role` (role `user`, always), and returns `{ uid, userDocId }`. Input: `displayName` (required), optional `claims` (the app's own, written in the **same** claims write, so there is no window where a claim is missing), optional `uid` (to pick the Auth uid, for apps that map their own ids). |
| C-D3 | Record shape | The same fields `completePhoneSignup` writes, with `email: ''`, `phone: ''` (not missing, so ordered queries and the admin list still find it), `isActive: true`, `status: 'Active'`, `by: 'app'`. The role is fixed to `user`: an app's own roles are claims, and Arc admin is never granted by an app helper. |
| C-D4 | Signing them in | `issueSignInToken(uid)` is exported in the kit (already independent of phone sign-in). The browser then calls `signInWithCustomToken`. |
| C-D5 | `mergeAppClaims(uid, patch)` | Merges an app's claims. **Refuses** any key starting `arccms_` and the names Firebase reserves, checks the whole claims object against Firebase's 1000-byte limit **before** writing, and never replaces what is there. A value of `null` removes the app's own claim. Values may be any JSON value, so the size check is what limits them. Errors are `HttpsError('invalid-argument')`, so a callable can pass them on. |
| C-D6 | Lost writes | `mergeUserClaims` gains **write, read back, retry** (up to three times): after writing, it re-reads the account and re-merges if its own patch is not there. Both Arc's writes and `mergeAppClaims` use it, so the two writers converge instead of one silently losing. Not a lock, so a writer outside Arc can still race; the docs say so. |
| C-D7 | `revokeSessions(uid)` | Revokes the person's refresh tokens (sign-in sessions end at the next token refresh, within an hour). Documented as such, with `owner.revokeRefreshTokens` as the only thing behind it. |
| C-D8 | `deleteAppAccount(uid)` | Finds the record by uid and deletes it. `onUserDeleted` does the rest (Auth account, PIN, contact data), then emits `user.deleted`. One helper, so an app need not know the record id. |
| C-D9 | `user.deleted` | Unchanged in shape, now **pinned by a test and documented**: `userId` is the Auth uid, `data.userDocId` is the record id, there is no email. Apps clean up their own data from an `AppEvents` trigger (docs example). |
| C-D10 | Admin screens | The edit form accepts a record that has no email (the field is only required when the record has one or the admin types one); the duplicate check skips an empty value; the view page shows no link without an email. The users list shows a small "App account" badge when `by === 'app'`. Nothing else in admin changes. |
| C-D11 | Profile, sign-in methods | **Unchanged.** The card already shows "Not added" for a missing email, and a person who links an email later becomes an ordinary account. A test pins that nothing crashes for such a record. |
| C-D13 | Empty values never match | App accounts add many records with `email: ''` and `phone: ''`. Every lookup by exact email or phone (for example `functions/src/dodo-payments/entitlements.ts`, `email-core/dripContext.ts`, `email-core/eraseContact.ts`, `auth/accounts.ts` `findUserByEmail`) is audited, and each refuses an empty or whitespace value **before** querying, so an empty value can never match these records. A source test fails on a new `where('email', '==', …)` or `where('phone', '==', …)` without that guard. |
| C-D12 | No rules change | Records are created by the Admin SDK only, as phone accounts are. A rules test pins that the owner reads their record by `arccms_uid` and cannot change `role`, `email` or `phone`. |

## 3. Build

**A5.1 App kit entry.** `functions/src/app-kit/index.ts` and its export test. Also the
docs page that lists the kit, so A4 only adds to it.

**A5.2 Claims.** Retry in `mergeUserClaims` (C-D6), `mergeAppClaims` and `revokeSessions`
(C-D5, C-D7), in `functions/src/users/claims.ts` and re-exported by the kit.

**A5.3 Accounts.** `createAppAccount`, `deleteAppAccount`, `issueSignInToken` re-export.
`createAppAccount` reuses the record-writing code `completePhoneSignup` uses rather than
copying it, so the two cannot drift apart.

**A5.4 Admin.** C-D10 in the edit, view and list pages, with the new translation keys in
`en.json` and `hi.json` (the parity test applies).

## 4. Tests

- `claims.spec`: `mergeAppClaims` merges, refuses `arccms_*` and reserved names, refuses
  over 1000 bytes without writing, removes with `null`; the retry converges when a second
  write lands in between (mocked); `arccms_*` claims written by Arc survive an app merge and
  the other way round.
- `app-accounts.spec`: `createAppAccount` makes the Auth account without email or phone,
  the record with C-D3's fields, both Arc claims and the app's claims in one write; a failure
  after the Auth account was made removes it (no orphan); `deleteAppAccount` deletes the record.
- `onUserDelete` with such a record: no email lookup, no phone index, Auth account removed
  when Arc owns it, `user.deleted` emitted with `userId` and `data.userDocId` and no email.
- `app-kit.spec`: exports equal the documented list.
- Frontend: the edit form saves an email-less record; the view page has no empty link; the
  list shows the badge only for `by: 'app'`; sign-in methods and profile render for it.
- C-D13: each audited lookup returns nothing for `''` and `'  '` and never queries; the source
  test for new exact email or phone lookups.
- `tests/rules`: C-D12. (Rules tests need Java 21.)
- `npm run build --prefix functions` (it type-checks the tests too) before calling a phase done.

## 5. Docs

- New `docs/app/app-accounts.html`: create an account, sign it in, claims (what is refused
  and why), sessions, deleting, and the `user.deleted` clean-up example, ending with a
  complete custom callable in `functions/src/custom/`.
- `docs/app/account-contract.html`: app accounts, `by: 'app'`, the claims rule, the event.
- `docs/app/functions.html` and `docs/app/custom-space.html`: the app kit as the supported
  way to use core from functions. Run `npm run docs:affected`; retake the users list screenshot
  for the badge.

## 6. Checks before it is done

- Tests, `npm run build`, `npm run build --prefix functions`, `npm run check:core` green.
- On the dev project (functions deploy by Gunjan, targeted): a custom callable creates an
  account, signs in with the token, the shell shows the person signed in, a claim added by
  the app is still there after an Arc role change, then deleting the account removes it and
  the event appears. Rules unchanged, so no rules deploy.
- Frontend checks at `localhost:5173` for the three admin changes.

**Built 2026-10-06.** As specced, plus three things found while building:

- **No "just signed up" alert for app accounts.** `onUserCreated` would have told every admin
  "Anna just signed up" for each staff account an app creates. It now skips the admin alert
  for `by: 'app'` and still emits `user.signed_up`.
- **`isArcAdmin` is in the kit,** because the docs' admin-only callable example needs it and
  apps should import only from the kit.
- **Claims before the record.** `createAppAccount` writes all claims first, then the record,
  so the first sign-in's token already carries them; the role trigger's later write merges.
- **Test mocks made realistic.** Five existing specs mocked `getUser` with fixed claims, so the
  new read-back could never see a write land. Their fakes now keep what is written, as
  Firebase does.
- The empty-value audit covered eleven exact-email lookups (no exact-phone ones exist: phone
  lookups go through the hashed index). The riskiest were the payment webhook
  (`entitlements.ts`, would have matched the first blank-email person on a payment with no
  email) and contact erasure (`eraseContact.ts`).

**End-of-work checks (functions deploy, targeted, by Gunjan):** a custom callable creates an
app account, signs in with the token, the member area shows the person signed in, a claim
added with `mergeAppClaims` survives an admin role change, the users list shows the badge
and the edit form saves without an email (retake the users list screenshot), and
`deleteAppAccount` removes everything and emits `user.deleted`.
