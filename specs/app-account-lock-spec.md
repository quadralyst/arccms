# App Accounts Cannot Change Themselves: Build Spec (F1)

**Status:** built 2026-10-06 on `feat/app-account-lock`; suite, functions build, app type-check and rules tests green, docs updated. Not merged to `dev`. Browser checks are in the end-of-work pass (section 6).
**Branch:** `feat/app-account-lock`, cut from `dev` (0e06e38).
**Scope:** an account made with the app kit's `createAppAccount` (`by: 'app'`) is locked: the
person using it cannot change its name, photo or sign-in methods, cannot delete it, and cannot
unlock it. The server and the rules enforce this; the browser shows a read-only profile. One
account can be opted out with `createAppAccount({ ..., selfService: true })`. An app chooses
whether locked accounts may open Arc CMS's member pages at all. The app's own functions are
unaffected. Follows A5 (branch `feat/app-accounts`).

**Out of scope:** changing the lock after creation through a kit helper (an app writes
`selfService` with the Admin SDK, as an admin can in the users list), Identity Platform blocking
functions, an admin UI switch for the lock, Storage rules for avatar uploads (the upload is
harmless: the record cannot point at it).

---

## 1. What was wrong

An app account could open `/user/*`, rename itself (rules allowed `name` and `photo`), add an
email, phone or Google through the sign-in methods card (turning it into an ordinary account),
delete itself with `deleteMyAccount` (the 10-minute check always passes right after a custom-token
sign-in), and change its own `by`, which was not protected. An app cannot fix any of that: app
rules only add access, and the callables are core.

## 2. Decision log

| # | Decision | Choice |
|---|----------|--------|
| L-D1 | Where the lock lives | On the `users` record: `selfService: boolean`. A record is locked when `by == 'app'` and `selfService != true`. App accounts made since A5 (no field) are locked with no migration; every other account is untouched. `createAppAccount` always writes the field (`false` unless asked). |
| L-D2 | One definition, three readers | `functions/src/users/lockedAppAccount.ts` (`isLockedAppAccount`), `firestore.rules` (`isLockedAppRecord`), `src/app/core/app-accounts/app-account-lock.ts`. Each has its own tests with the same cases. |
| L-D3 | Rules | `by` and `selfService` join the owner-protected fields for every account. For a locked record the owner also cannot change `name`, `photo` or `emailVerified` (`email`, `phone`, `phoneVerified` were already protected). Everything else stays writable, so `preferredLanguage` still saves. Admins and the Admin SDK are unaffected. |
| L-D4 | Callables: secure by default | `requireOwnRecord()` refuses a locked app account unless called with `{ allowLockedAppAccount: true }`. Every caller today is self-service (`deleteMyAccount`, `checkIdentifierForLink`, `requestEmailLinkOtp`, `linkEmail`, `linkPhone`, `requestPhoneOtp` link, `setPin`), so they all refuse it, and a new callable built on it refuses it too. Only `refreshMyClaims` passes the option: the browser needs its claims. The refusal is `permission-denied` with `details.reason: 'app-managed'`. |
| L-D5 | Callables that find the record themselves | `verifyPhoneOtp` and `verifySignupOtp` with purpose `link` now call `requireOwnRecord` (a link code was already only for the caller's uid). `claimFirstAdmin` refuses a locked account: becoming admin is a change. `ensureGoogleAccount` and `createAccountRecord`, when the caller already has a record, run the broken-lock check (L-D7). |
| L-D6 | Audit | A source test lists every callable file that reads the caller's own record, each with a verdict (guarded, admin only, or why the lock does not apply: `consumeCredits`, `notificationPrefs`, `trackPwaEvent`). A new file fails the test until reviewed. A second test allows `allowLockedAppAccount` only in `refreshMyClaims`. |
| L-D7 | Browser-side linking | Firebase lets a signed-in browser call `linkWithPopup`, `linkWithCredential`, `linkWithPhoneNumber`, `updateProfile` and `updatePassword` without Arc's server. **Arc cannot refuse these without Identity Platform blocking functions**, which Arc does not use and which would need every install to upgrade. So: every control is hidden for a locked account; the store refuses name, photo and password changes before calling Firebase; the record never follows (rules, L-D3). And when the server sees a locked account signed in by anything other than a custom token (`firebase.sign_in_provider != 'custom'`) in `refreshMyClaims`, `ensureGoogleAccount` or `createAccountRecord`, it unlinks every provider, replaces a linked email with `{uid}@moved.invalid` (Firebase cannot clear one), removes a linked phone, revokes all sessions and refuses (`functions/src/auth/appAccountLock.ts`). The normal Google sign-in page calls `ensureGoogleAccount` and signs out on the error, so the ordinary path is closed. Only a token-sign-in session is trusted, so an app that adds sign-in methods to a locked account with the Admin SDK sees them removed the first time someone uses them: such an account should be made with `selfService: true`. |
| L-D8 | Claims ride along | Until the server sees it (L-D7), a Google session on a locked account carries the app's claims and `arccms_uid`. The docs tell apps to check `request.auth.token.firebase.sign_in_provider == 'custom'` in rules that trust a claim alone. Not built into `ownsUserRecord()`: it would need a lock claim on every app account and changes a stable helper; left for the coordinator (section 7). |
| L-D9 | Member pages setting | A new starter file, `src/custom/app-accounts.ts`, exporting `CUSTOM_APP_ACCOUNTS: AppAccountChoice = {}` with one optional key, `memberPages` (default `true`). No existing starter export fits (home pages map roles to paths; features are on/off lists). Registered like every starter file: README table, `custom-space.html`, `keep-core-generic.html`, `config-keys.html`, the starter test. |
| L-D10 | The guard | `memberPagesGuard` (user.guards.ts) is `userGuard` plus the choice, used on Arc's own member routes only: `/user/dashboard`, `/user/profile`, `/user/payments`, `/user/premium`, `/account`. `userGuard` is unchanged, so an app's own pages still let a locked account in. A test pins the guarded routes. |
| L-D11 | Where a refused account goes | Its role's home from `src/custom/home.ts`; when that is a member or admin page (the default `/user/dashboard` is), the site's home `/`. Neither is guarded by `memberPagesGuard`, so there is no loop. The member menu hides the member pages for such an account. |
| L-D12 | Read-only profile | When the record is locked: no photo change or remove, no name Edit, no sign-in methods card, no password card, no delete card, and one line (`member.profile.app_managed`, en and hi) saying why. |
| L-D13 | Member language | The member language (A1) is kept per device, not on the record, so the lock does not touch it. The admin language (`preferredLanguage`) stays writable. |
| L-D14 | Neutral examples | The app-accounts docs examples used shop wording; they now use neutral `site` and `front-desk` claims. |

## 3. Build

- **Functions:** `users/lockedAppAccount.ts` (new), `auth/appAccountLock.ts` (new), `auth/accounts.ts`
  (`requireOwnRecord` option), `users/accountCallables.ts`, `auth/googleAccount.ts`,
  `auth/emailAccount.ts`, `auth/phoneAuth.ts`, `auth/signupOtp.ts`, `users/syncUserRole.ts`,
  `app-kit/accounts.ts` (`selfService` input).
- **Rules:** `firestore.rules` users update.
- **Frontend:** `src/custom/app-accounts.ts` (new starter), `src/app/core/app-accounts/app-account-lock.ts`,
  `user.guards.ts` (`memberPagesGuard`), `app.routes.ts`, `user-shell.component.ts`, `profile.page.*`,
  `auth.store.ts`, `auth.model.ts`, `en.json`, `hi.json`.

## 4. Tests

- `functions/src/__tests__/appAccountLock.spec.ts`: every self-service callable refuses a locked
  account, lets a `selfService` one and an ordinary one through; deleting and first admin never
  happen; `refreshMyClaims` works with a custom token and cleans up and refuses otherwise;
  `ensureGoogleAccount` and `createAccountRecord` clean up a linked Google or password; the
  source audit (L-D6).
- `appKit.spec`: `selfService` is `false` by default, `true` when asked.
- `tests/rules`: a locked account cannot write `name`, `photo`, `emailVerified`, sign-in fields,
  `by` or `selfService`, can write `preferredLanguage`; a `selfService` account can change name and
  photo but not the flag; ordinary accounts as before but `by`/`selfService` protected; admins can.
- Frontend: `app-account-lock.spec` (lock, choice, landing never loops), `user.guards.spec`
  (`memberPagesGuard` and the pinned routes), `profile.locked.spec` (rendered read-only profile;
  unchanged for ordinary and `selfService`), `auth.store.lock.spec` (store refuses before Firebase),
  `custom-space.spec` (starter ships empty, the plug point works).

## 5. Docs

`docs/app/app-accounts.html` (new sections: Locked by default, The member pages, What the browser
can still do), `app-kit.html`, `account-contract.html`, `custom-space.html`, `member-area.html`,
`pages-and-routes.html`, `members/overview.html`, `features/users-and-roles.html`,
`operations/security-rules.html`, `reference/cloud-functions.html`, `reference/data-model.html`,
`reference/config-keys.html`, `contributing/keep-core-generic.html`.

## 6. End-of-work checks

Deploy (Gunjan, targeted): functions `refreshMyClaims`, `deleteMyAccount`, `checkIdentifierForLink`,
`requestEmailLinkOtp`, `linkEmail`, `linkPhone`, `requestPhoneOtp`, `verifyPhoneOtp`, `setPin`,
`verifySignupOtp`, `claimFirstAdmin`, `ensureGoogleAccount`, `createAccountRecord`, then rules.

Browser pass at `localhost:5173`:
- A locked app account (made by a custom callable) signs in with its token; `/user/profile` shows
  name and photo with no Edit, no photo buttons, no sign-in methods card, no password card, no
  delete card, and the "managed for you" line. The member menu shows Dashboard and Profile.
- With `memberPages: false` in `src/custom/app-accounts.ts`: `/user/profile` and `/user/dashboard`
  land on `/` (or the role's home when the app sets one), with no loop; the menu hides them.
- An ordinary member's profile is unchanged.
- A `selfService: true` app account can rename itself and sees the sign-in methods card.
- Google linked to a locked account in the console (or by script), then a Google sign-in: refused,
  signed out, Google gone from the Auth account.

Screenshots to retake: the member profile page (`/user/profile`) for an ordinary member if the
docs show it, and a new one of the read-only profile for `docs/app/app-accounts.html` if wanted.

## 7. For the coordinator

- L-D8: whether `ownsUserRecord()` should also require a custom-token session for locked app
  accounts (needs a lock claim, set by `createAppAccount` and the role trigger).
- `docs/app/member-languages.html` still has a "shop's staff" example heading, outside this item.
