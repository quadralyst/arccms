# Sign-in PIN briefs F30, F31, F32: proposal

**Status: agreed by Gunjan 2026-10-25 (all of it, with the decisions below). Build order F30, F32, F31 part 2, F31 part 1.**
Branch `claude/sign-in-f30-f32-3e413c`, cut from `dev` at `c8353c49`.

## Built (2026-10-25, branch `claude/sign-in-f30-f32-3e413c`)

- F30 `731b8868`, F32 `d5970dc0`, F31 part 2 `d51bc10a`, F31 part 1 server `0c5b09ab`, then the browser side, docs and review fixes.
- Changes from the proposal found while building: `setPin` and `checkPhoneSignIn` are now deployed with or without the `sms` feature (email accounts have PINs too); every PIN sign-in remembers its device whether the setting is on or not, and a signed-in device reports itself once (`rememberThisDevice`), so turning the new-device code on later asks for no code on devices in use; on a site using passwords, an account with a password gets no email-and-PIN sign-in (`pin-sign-in-off`).
- Browser test on xlm (2026-10-25): email sign-up with a PIN, the new-device code, Forgot PIN, a password account choosing a PIN, and switching back to Password all pass. `providersToUnlink: ['password']` does stop the password working, but Firebase keeps the email's `password` provider entry, so the profile now goes by the server's rule for its password section (`a940d3ab`).
- Still unchecked: `arccms_session` through the hourly token refresh (needs Arc POS's till sign-in), and the phone new-device code in a browser.
- Low, left: in Password mode the profile offers no Change PIN for an email-only PIN account (Forgot PIN on the sign-in page still works); the profile subtitle still says "Manage your name, email, password and photo." for PIN accounts.

## Decisions so far (Gunjan, 2026-10-25)

- **Updates never break a running app.** Every piece is off until an app or admin turns it on; what it needs (the PIN reset template, a person's device list) is made on first use; the starter file is not edited; an upgrade test covers a site as it is today.
- **F32 agreed:** using a person's sign-in PIN on a shared screen is the app's business decision. Arc documents the risks.
- **Email PIN or password is an admin setting** (Settings, User Settings, beside phone and Google): "New email accounts sign in with: Password / 6-digit PIN", default Password. An app may fix it in `src/custom/sign-in.ts`; the admin then sees it as set by the app. This replaces the build-time-only choice below.
- **The sign-in page asks each account for what it has**, never for what the setting says: the server tells the page, from the account itself, whether it has a PIN and whether it has a password. The setting decides only what new email sign-ups choose and whether password accounts are offered a PIN. Switching either way locks nobody out.
- **"Ask for a code on a new device" is the same kind of admin setting**, off by default, for email and phone PIN sign-ins, fixable by the app. The code comes before the PIN. A device already signed in when the setting is turned on (or when the update lands) is remembered without a code.

Three requests from an app built on a copy of Arc CMS (a point-of-sale app where each
iPad is one till and staff pick their name and type a PIN). In short:

- **F30.** A sign-in token that carries claims for that one sign-in (which till it is), not for the account.
- **F31.** Email accounts sign in with a 6-digit PIN like phone accounts, if the app chooses; and a fresh code before a sensitive action.
- **F32.** An app signs a member in with their own sign-in PIN, counted as a real sign-in try.

Every change is opt-in. An app that changes nothing in `src/custom/` and calls nothing new sees no difference.

---

## What the code does today (checked, not assumed)

- `issueSignInToken(uid)` (`functions/src/auth/accounts.ts`) calls `createCustomToken(uid)` with no claims.
- Account claims (`mergeAppClaims`) live on the Auth account and are the same on every device. Limit 1000 bytes, no `arccms_` names, no Firebase reserved names.
- The sign-in PIN is `auth_pins/{uid}`: **one per account, not per phone number.** 5 wrong in a row locks it; Forgot PIN (a code) sets a new one and signs every other session out.
- **Phone sign-in has no device memory.** A number with a PIN goes straight to the PIN screen on any device. A code is sent only for sign-up, Forgot PIN, or a number with no PIN yet. So the brief's "a code the first time on a device, like phone" is not how phone works today. This matters for F31 and F32 (see the question in F31).
- `setPin` (change PIN while signed in) refuses an account with no phone ("Add a phone number first").
- Email sign-in is Firebase's own password sign-in in the browser. Email codes exist for sign-up, linking an address and Forgot password (`signupOtp.ts`, `passwordReset.ts`), with a 1 per minute, 5 per hour per address and 20 per hour per caller limit.
- `arc-code-input` (`src/shared/components/code-input/`) is the row of digit boxes the sign-in page uses; it is already a standalone component.
- `createPhonePinCheck` (app kit) reads the phone PIN for an app's gate, counts wrong tries apart, and must never sign anyone in.

---

## F30. Claims for one sign-in

### Options

1. **Flat names in the token** (`{ pos: 'pos2' }` beside the account's claims). Simple to read in rules, but a session claim and an account claim of the same name can collide, and which one Firebase keeps is not something to build security on. Refusing a name that is on the account at issue time does not help: `mergeAppClaims` can add it later.
2. **One container claim, set by Arc only** (recommended). Arc puts the app's session claims in the token under one name, `arccms_session`: `request.auth.token.arccms_session.pos`. No collision is possible by construction: `mergeAppClaims` already refuses every `arccms_` name, and Arc never puts `arccms_session` on an account. And because only `issueSignInToken` writes it, its presence alone proves the session came from the app's own token.

### Proposed API

```ts
// functions/src/custom/...
import { issueSignInToken, sessionClaims } from '../app-kit/index.js';

const token = await issueSignInToken(uid, { pos: 'pos2' });   // sessionClaims is optional
// in another callable, later in that session:
const { pos } = sessionClaims(request);                      // {} when the session has none
```

```
// firestore.app.rules (new core helper beside signedInByApp())
function sessionClaim(name) { return request.auth.token.get('arccms_session', {}).get(name, null); }
allow create: if sessionClaim('pos') == request.resource.data.posId;
```

- Same rules as `mergeAppClaims`: a plain object, at least one name, no reserved names, values any JSON, the whole object 1000 bytes or less (Firebase's own limit for a custom token's claims). `arccms_` names inside the object are allowed, since they cannot be confused with Arc's (they sit inside the container); or refused, for the same rule everywhere. Recommended: refused, one rule to learn.
- Life: kept through the hourly token refresh for that session; gone at sign-out or the next sign-in on that device; `revokeSessions(uid)` ends it. To change it, sign in again with a new token.

### What changes for other apps

Nothing unless they pass the second argument. One new rules helper in core `firestore.rules` and one new app-kit export.

### Risks

- A claim says which device the sign-in **was made for**, not that the session is still there: a refresh token copied off the iPad carries it. Same as any Firebase session; documented.
- Every request carries the claims in its ID token, so keep them small (an id, not a record).
- Firebase keeping developer claims through the refresh is documented behaviour; the build checks it on the xlm dev project before docs say so.

### Tests

Unit: the token is created with `{ arccms_session: {...} }`, refusals for bad names, size, non-objects; `sessionClaims()` reads it. Rules test (`npm run test:rules`): `sessionClaim('pos')` reads the container, and an **account** claim `pos` does not satisfy it. App-kit export list test and docs: `docs/app/app-accounts.html` (beside "Your own claims"), `docs/app/app-kit.html`, `docs/app/rules-and-indexes.html`.

---

## F31 part 1. Email accounts sign in with a PIN (an app's choice)

### The question to settle first: a code on a new device, for whom?

The agreed idea was "a code the first time on a device, then the PIN". Phone does not do that today (above). F32 makes it matter: the owner will type their sign-in PIN at a till, in front of staff, many times a day. Without a new-device code, anyone who sees it can sign in as the owner from their own phone with the number and that PIN.

| Option | Email PIN accounts | Phone accounts | Cost |
|---|---|---|---|
| A. PIN only, like phone today | address + PIN on any device | unchanged | weakest: a seen PIN or a known address is enough to try, 5 wrong tries lock the owner out |
| B. New-device code for email only | code on a new device, then PIN | unchanged | a person who also has a number can still use the PIN alone by phone |
| **C. New-device code as one app choice for both** (recommended) | code on a new device, then PIN | code by SMS on a new device, then PIN | one SMS per new device for phone people; other apps unchanged (off by default) |

### Proposed choice (superseded: now an admin setting the app may fix, see "Decisions so far")

```ts
export const CUSTOM_SIGN_IN: SignInChoice = {
    strength: 'simple',
    emailSignIn: 'pin',      // default 'password': today's email sign-in
    newDeviceCode: true,     // default false: a code the first time a PIN is used on a device (email or SMS)
};
```

The starter file stays as shipped (it is frozen, F24); only the `SignInChoice` type gains the two names, and the docs explain them.

### How it works with `emailSignIn: 'pin'`

- **Sign-up by email:** code by email (as today), then name and a 6-digit PIN. The server makes the account (email verified, no password), its record, the PIN and the claims, and returns a sign-in token, as phone sign-up does (`completeEmailSignup`).
- **Sign-in:** email, then the PIN (`signInWithEmailPin`), which returns a sign-in token. Same `auth_pins/{uid}`, so a person with both an email and a number has one PIN.
- **New device** (`newDeviceCode: true`): a code first, then the PIN. The device is then remembered by a random key kept in the browser; the server keeps only its hash (`auth_devices/{uid}`, at most 10 devices, a device unused for a year is forgotten). Forgot PIN forgets every device. Deleting the account deletes the list (account contract updated). An installed iPhone app has its own storage, so it asks once more after install.
- **Forgot PIN:** a code by email (template `pin_reset_otp_email`, "Your PIN reset code"), then a new PIN; every other session is signed out, as for phone.
- **Same rules as phone PINs:** 5 wrong in a row lock; 30 PIN tries an hour per caller; codes 1 a minute, 5 an hour per address, 20 an hour per caller; the strength rule for new PINs.
- **Existing password accounts:** still sign in with their password. Right after, the page asks them to choose a PIN (one screen, can be skipped once). When they choose one, the password is taken off the account, so there is one way in, not two. A login owned by a host app in a shared sign-in pool (`authOwner: host`) keeps its password and is never offered a PIN.
- **Profile:** Change PIN works for email accounts (`setPin` no longer needs a phone); the password section is hidden for a PIN account.
- **Unchanged:** Google sign-in, the first admin made on the onboarding page (strict password), apps that keep `'password'`.

### What changes for other apps

Nothing unless they set the choices. Core changes: new callables (`completeEmailSignup`, `signInWithEmailPin`, PIN-reset by email, device codes), `checkEmailAccount` says whether the account has a PIN or password, the sign-in page gains the email PIN path, the profile page gains Change PIN for email, one new email template.

### Risks

- The biggest piece: the sign-in page is 1300 lines with many paths already. Each new path gets page tests and a browser pass on the xlm dev project.
- Taking the password off on "choose a PIN" cannot be undone by the person; they then rely on Forgot PIN by email. That is the point (one credential), but say so on the screen.
- Admin "Set password" (Edit user) means nothing for a PIN account. Proposed: hidden for PIN accounts; an admin "Clear PIN lock" is a possible follow-up, not in this build.
- New functions mean a deploy of those functions before browser testing (no emulator).

---

## F31 part 2. A fresh code before a sensitive action

### Options

1. **A fresh window on the account:** after a code, the account counts as "recently checked" for 5 minutes and any callable may ask `requireRecentCode(request)`. Simple, but every callable in that window gets it.
2. **A one-use proof** (recommended): confirming the code returns a proof the page passes to the one callable that needs it; that callable uses it up. Bound to the person, a purpose name and 5 minutes. The same pattern as the code tickets Arc already uses (`otpTicket.ts`).

### Proposed API

Browser (app page):

```ts
const proof = await inject(FreshCodeService).confirm({ purpose: 'pos-setup' });  // Arc's own dialog; null if cancelled
if (proof) await httpsCallable(functions, 'setUpPos')({ proof, ... });
```

For an app's own sheet instead of Arc's dialog: the callables `requestFreshCode({ purpose })` and `confirmFreshCode({ purpose, code })`, and `arc-code-input` documented as reusable.

App's function:

```ts
import { useFreshCodeProof } from '../app-kit/index.js';
await useFreshCodeProof(request, request.data.proof, 'pos-setup');   // throws reason 'fresh-code-required' when missing, used, expired or for another purpose
```

- Where the code goes: the account's verified email (free); if none, its verified number by SMS. Nothing else; the person never types an address.
- Limits as sign-in codes: 1 a minute, 5 an hour per account, 20 an hour per caller, 5 wrong tries per code.
- Test providers: the code shows on screen only when an admin turned on showing reset codes, as for Forgot PIN; otherwise in the logs.
- Naming: "fresh code" rather than "step-up", which the people using it never see anyway.

### What changes for other apps

Nothing unless they call it. Arc's own profile actions keep what they do today; moving them to fresh codes for PIN accounts is a possible follow-up.

### Risks

An SMS per sensitive action for phone-only people (rare actions, so small). A proof stolen from the page within its 5 minutes works once for that purpose only.

---

## F32. An app signs a member in with their own sign-in PIN

### Proposed API

```ts
import { signInWithMemberPin } from '../app-kit/index.js';

export const serveAs = onCall(async (request) => {
    // the app decides where this may be used, e.g. only on a till set up by the owner:
    if (!sessionClaims(request).pos) throw new HttpsError('permission-denied', '...');
    const { token } = await signInWithMemberPin(request, request.data.uid, request.data.pin, {
        sessionClaims: { pos: sessionClaims(request).pos },   // F30, carried to the new sign-in
    });
    return { token };
});
```

- Checks the PIN in `auth_pins/{uid}` with **sign-in's own count**: a wrong try here is a wrong sign-in try, the fifth locks phone and email PIN sign-in everywhere, a correct one resets the count, Forgot PIN unlocks it.
- Refuses as the sign-in page does: wrong (with tries left), locked, no PIN, blocked account, no such person. The refusals carry the same `reason`s, so the app's page can reuse the words.
- Rate limit: **wrong tries** count against a key, 30 an hour, default the caller's address, or the app's own `rateKey` (the till's id). Correct PINs never count, so a busy till is never slowed. The per-account lock already caps guesses per person at 5.
- No new-device code: the app's own setup of the device (with F31's fresh code) is the gate, and the app decides where the call is allowed.
- `createPhonePinCheck` stays as it is, for gates that must never sign in.

### What changes for other apps

Nothing unless they call it.

### Risks

- **The PIN is typed in public.** Anyone who watches it at the till has the person's sign-in PIN. With `newDeviceCode` on (option C) that PIN is useless on another device; without it, it signs in from anywhere. This is the main reason for option C.
- **A lockout from the till locks the person everywhere.** A staff member tapping the owner's name and five wrong PINs locks the owner's own sign-in until Forgot PIN. That is what was asked (one count). The app can stop earlier with its own count, never later.
- A token is handed to whoever calls the app's callable with a right PIN, so the app's callable must be limited to its set-up devices; the docs show that check.

---

## Build order and checks (only after agreement)

1. **F30**, session claims (small).
2. **F32**, member PIN sign-in (small; uses F30).
3. **F31 part 1**, email PIN sign-in and the new-device code (large: functions, sign-in page, profile, template).
4. **F31 part 2**, fresh code for sensitive actions (medium).
5. Critical review of the whole, docs (`docs/app/sign-in.html`, `pin.html`, `app-accounts.html`, `app-kit.html`, `rules-and-indexes.html`, `account-contract.html`, `docs/features/sign-in.html`), screenshots of the changed sign-in and profile screens, `npm run test`, `npm run test:rules`, `npm run check:docs`. Deploy commands for only the changed functions; browser pass on xlm at localhost:5173. Push `dev` to `github` only on Gunjan's word.
