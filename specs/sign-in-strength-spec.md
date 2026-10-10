# Sign-in Strength and Code Box Focus: Build Spec (SS)

**Status:** BUILT 2026-10-10 (SS1 to SS5), agreed with Gunjan 2026-10-10. Not committed.
**Branch:** `feat/sign-in-strength`, cut from `dev` (fff8e26), worktree `../arccms-sign-in-strength`.

**Scope:**
1. **Sign-in strength.** An app chooses, at build time, whether new passwords and PINs
   follow the strict rule (today's behaviour, the default) or a simple one for casual apps.
2. **Code box focus.** Opening a PIN or code screen puts the cursor in its first box.

**Out of scope:** a switch in the admin UI (a runtime switch could not change what the
browser bundle checks, and the developer is the one who knows the app is casual); a
4-digit PIN; phone sign-in without a PIN (an SMS every sign-in); different settings per
Firebase project; Firebase's hosted reset page (it only falls back there when email sends
nothing, and it applies Firebase's own 6-character minimum).

---

## 1. Decision log

| # | Decision | Choice |
|---|----------|--------|
| SS-D1 | Who chooses, and when | **The developer, at build time**, like features (specs/feature-flags-spec.md, F-D1). |
| SS-D2 | Where the choice lives | **A new custom starter file, `src/custom/sign-in.ts`**, shipped empty. Empty means strict, so every existing app pulls this change with nothing to do. Per app, not per Firebase project: a casual app is casual on dev and production alike, and a staging project that differs from production hides problems. |
| SS-D3 | How many switches | **One**, `strength: 'strict' \| 'simple'`, for passwords and PINs together. Fewest choices for the developer. |
| SS-D4 | Simple passwords | **At least 6 characters, nothing else.** 6 is Firebase Auth's own minimum, and email sign-up goes straight to Firebase from the browser, so lower is not possible without moving sign-up to the server. |
| SS-D5 | Simple PINs | **Still 6 digits; any 6 digits are accepted**, including `123456` and `111111`. Same boxes, same stored hashes, nothing to migrate. |
| SS-D6 | What never relaxes | The lockout after wrong tries, the rate limits, the peppered PIN hash, and the server-side checks. Simple lowers how hard a secret must be, not how it is guarded. |
| SS-D7 | Admins | **Simple applies to every account the setting covers**, admins included: a password is chosen at sign-up, before anyone is made an admin, so the rule cannot be raised later for one role. Two exceptions where the account is known to be an owner: **the onboarding page (the first admin) always uses the strict rule.** The docs advise admins of a simple app to sign in with Google. |
| SS-D8 | Existing passwords and PINs | **Untouched in both directions.** Only new ones are checked, as today. Switching a simple app to strict later does not lock anyone out; their next new password or PIN meets the strict rule. |
| SS-D9 | App PIN stores (`createPinStore`) | **Follow the app's setting by default**, with an optional `strength` per store, so a casual app can still keep a strict staff or kiosk PIN. |
| SS-D10 | Functions build | The functions cannot import from `src/`. The existing generator `scripts/arc-features.mjs` (already run by the functions `prebuild`, the test setup and deploy) also writes a **gitignored** `functions/src/sign-in.gen.ts` with the choice. Gitignored (`functions/src/*.gen.ts`), so no app has a merge conflict on it. |
| SS-D11 | Bad value | Anything other than `'strict'`, `'simple'` or nothing **stops the build** with a message naming the file and the two values, rather than quietly falling back. |
| SS-D12 | Code box focus | The first box takes the cursor **when the boxes can take it**: on open, and again when they turn from disabled to enabled while still empty. A screen whose first field is not the boxes (sign-up's name, then PIN) focuses that first field instead. |
| SS-D13 | iPhone keyboard | iOS Safari does not open the keyboard for focus that no tap started. The cursor still lands in the box; no workaround is attempted (they are fragile and break other browsers). The docs say so. |

---

## 2. What is true today

- **Passwords.** `src/shared/utils/password-rule.ts` (mirrored in
  `functions/src/shared/password-rule.ts`, a spec checks they agree) refuses a new password
  that is under 8 characters, one character repeated, a straight run, a common password, or
  contains the person's name or email (`passwordProblem`).
  - Browser: `newPasswordValidator` on sign-up, profile, onboarding, admin Add user and
    Edit user; `passwordProblem` directly in `sign-in-methods.component.ts` (adding an email).
  - Server: `refuseWeakPassword` (refusal.ts) in `resetPassword` (passwordReset.ts),
    `linkEmail` (linkIdentifiers.ts) and `adminSetPassword`; `passwordProblem` directly in
    `adminCreateUser`.
  - Text: `PASSWORD_PROBLEM_TEXT` (English, admin pages and server fallback) and
    `member.auth.password_error.<problem>`; several member strings say "8 characters"
    (`password_required`, `weak_password`, `new_password_placeholder`, `password_placeholder`,
    `password_error.short`).
- **PINs.** Always 6 digits (`PIN_PATTERN`, accounts.ts). `isWeakPin` (accounts.ts) refuses
  repeated digits, straight runs and 16 common PINs. Checked only on the server:
  `readNewPin` in `completePhoneSignup`, `resetPin` and `setPin` (phoneAuth.ts); `linkPhone`
  (linkIdentifiers.ts); `createPinStore().set` (app-kit/pins.ts). `isWeakPin` is an app kit
  export. The browser shows the refusal from `member.auth.server_error.weak_pin`.
- **Code boxes.** `arc-code-input` (src/shared/components/code-input) focuses its first box
  once, in `afterNextRender`, when `autofocus` is true (the default). Used on the sign-in
  page (PIN, code, new PIN at sign-up with `autofocus` false, new PIN on Forgot PIN) and in
  `sign-in-methods.component.ts` (new PIN, code, new PIN). Likely misses, to be confirmed in
  the browser in SS1: the boxes are disabled (`working()`) when they render, and a disabled
  box cannot take focus, with nothing trying again once they are enabled; and a screen that
  swaps steps inside one component may reuse the boxes, so `afterNextRender` has already run.

---

## 3. The file

```ts
// src/custom/sign-in.ts (ships like this: strict)
/**
 * How hard new passwords and PINs must be (docs/app/sign-in.html). Arc CMS ships this
 * empty and never edits it again. Empty means strict.
 *
 *   export const CUSTOM_SIGN_IN: SignInChoice = {
 *       strength: 'simple',   // passwords of 6 characters or more, any 6-digit PIN
 *   };
 */
import type { SignInChoice } from '../shared/utils/sign-in-strength';

export const CUSTOM_SIGN_IN: SignInChoice = {};
```

`src/shared/utils/sign-in-strength.ts` (core) holds the type, reads the choice
(`signInStrength(): 'strict' | 'simple'`) and is mirrored for the functions like the
password rule. The functions read the choice from `functions/src/sign-in.gen.ts`.

---

## 4. The two modes

| | Strict (default) | Simple |
|---|---|---|
| New password | 8 or more characters; not repeated, a run, common or personal | 6 or more characters |
| New PIN | 6 digits; not repeated, a run or common | 6 digits |
| First admin (onboarding) | strict | **strict** |
| App PIN store | strict | simple, unless the store says `strength: 'strict'` |
| Signing in with an older password or PIN | works | works |
| Lockout, rate limits, hashing | unchanged | unchanged |

**Code shape.**
- `passwordProblem(password, owner, strength = 'strict')`: in simple mode returns `'short'`
  under 6 characters and null otherwise. The rule file is mirrored for the functions and
  cannot read the app's choice itself, so every caller passes it: the browser's
  `SIGN_IN_STRENGTH` (src/app/core/sign-in/sign-in-strength.ts), the server's
  `signInStrength()` (functions/src/sign-in-choice.ts). Leaving it out is strict, the safe
  side. `minPasswordLength(strength)` is 8 or 6; `MIN_PASSWORD_LENGTH` stays the strict
  value. `passwordProblemText(problem, strength)` says the right length.
- `newPasswordValidator(owner, strength = SIGN_IN_STRENGTH)`: the app's choice by default.
- `isWeakPin(pin)` keeps its meaning (the pattern check, an app kit export apps may call).
  A new `pinTooEasy(pin, strength = signInStrength())` is what every PIN-setting path calls:
  `isWeakPin(pin)` in strict mode, false in simple. App kit exports `pinTooEasy` and
  `signInStrength`.
- Onboarding passes `'strict'` explicitly.
- Refusals carry `min` in `details` (`weak-password`, `password-required`); the page falls
  back to the app's own minimum when a server deployed before this sends none.
- The deploy menu's "only the functions changed" choice treats a change to
  `src/custom/sign-in.ts` (and `src/custom/features.ts`, which had the same gap) as a change
  to the generated files the functions import (`GENERATED_FROM`, arc-deploy-menu.mjs).

**Text.** The "at least 8 characters" strings take the number as a parameter
(`{{min}}`) in English and Hindi, so one key serves both modes. The weak-PIN hint is only
ever shown on a refusal, so simple mode never shows it. Admin pages use
`PASSWORD_PROBLEM_TEXT`, which becomes a function of the minimum.

---

## 5. Phases

Every phase ends with a browser check where it shows on screen, the full suite (run alone,
with a full log), and a critical review of the phase (correctness, security, every touched
screen, data, tests, docs, drift from this spec); critical, high and medium findings are
fixed before the phase closes.

### SS1. Code box focus
1. In the browser (localhost, phone sign-in on the dev project), open each screen with code
   boxes and record whether the first box has the cursor: PIN sign-in, SMS code, email
   sign-up code, sign-up details (name first), Forgot PIN new PIN, profile Add phone (code,
   new PIN), profile Change PIN.
2. Fix in `CodeInputComponent`: focus the first box when it renders enabled, and again when
   `disabled` turns false while every box is empty and focus is not already elsewhere in a
   field on the page (so it never steals the cursor from someone typing). A host can still
   turn it off with `[autofocus]="false"`.
3. Sign-up details screen: the name field takes the cursor (SS-D12).
4. Tests: `code-input.component.spec.ts` for focus on render, after enable, not when
   `autofocus` is false, not when another field has the cursor.
5. Re-check every screen from step 1 in the browser; screenshot.
6. Critical review of SS1.

### SS2. The setting
1. `src/custom/sign-in.ts` starter (section 3); add it to `scripts/custom-starters.mjs` and
   stub it in both test setups.
2. `src/shared/utils/sign-in-strength.ts` and its functions mirror; a spec checks the two
   agree, like the password rule.
3. `scripts/arc-features.mjs` writes `functions/src/sign-in.gen.ts`; a bad value stops it
   (SS-D11). Tests in `scripts/__tests__`.
4. Critical review of SS2.

### SS3. Server
1. `passwordProblem` and `minPasswordLength` take the strength (both copies).
2. `pinTooEasy` in accounts.ts; `readNewPin`, `linkPhone` and `createPinStore().set` call
   it; `createPinStore` takes the optional `strength` (SS-D9) and checks it.
3. Refusal messages carry `min` in `details` for the short password, so the page can say
   the right number.
4. Tests for each callable in both modes: a 6-character password and `123456` refused in
   strict, accepted in simple; lockout and rate limits unchanged in simple.
5. Deploy only the changed functions to the dev project (one deploy after the phase):
   `completePhoneSignup`, `resetPin`, `setPin`, `linkPhone`, `linkEmail`, `resetPassword`,
   `adminSetPassword`, `adminCreateUser`. Browser-test with the dev app set to simple, then
   back to strict.
6. Critical review of SS3.

### SS4. Browser side
1. `newPasswordValidator` and `sign-in-methods` follow the setting; onboarding passes
   `'strict'`.
2. Strings take `{{min}}` (en, hi); placeholders and hints show 6 or 8; run
   `npm run i18n:keys` (restart a running dev server after it).
3. Admin Add user and Edit user show the right minimum.
4. Tests for the validator in both modes and for onboarding staying strict.
5. Browser check of sign-up, profile password, Forgot password, admin Add and Edit user,
   in both modes.
6. Critical review of SS4.

### SS5. Docs and close
1. New section in docs/app/sign-in.html (the setting, the two modes, the admin advice,
   the iPhone keyboard note); docs/reference/config-keys.html (`CUSTOM_SIGN_IN`);
   docs/app/custom-space.html (the new starter); docs/app/pin.html and
   docs/app/app-kit.html (`pinTooEasy`, the store's `strength`); docs/features/sign-in.html
   and docs/features/users-and-roles.html (rules now depend on the setting);
   docs/getting-started/first-admin.html (onboarding stays strict). Whatever else
   `npm run docs:affected` lists.
2. Retake screenshots of the sign-in screens whose hints changed.
3. `npm run check:docs`, `npm run test` alone, all green.
4. Critical review of the whole branch against this spec; report fixed items and any low
   items left with a recommendation each.

---

## 6. Acceptance

- An app with an empty `src/custom/sign-in.ts` behaves exactly as before (whole suite green
  with no test changed except new ones).
- With `strength: 'simple'`: a member signs up with `abc123` and with PIN `123456`; the
  first admin on onboarding still cannot use `abc123`; five wrong PINs still lock.
- Switching back to strict: those members still sign in; their next new password or PIN
  meets the strict rule.
- Every code box screen opens with the cursor in its first box (or the name field on
  sign-up details), and never takes the cursor from a field someone is typing in.
