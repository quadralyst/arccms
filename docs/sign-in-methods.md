# Sign-in methods: email, phone number, Google

Built on `feat/auth-google-phone` (2026-09-27), item 1 of the pilot framework work.
Generic ArcCMS module; its first user is a children's learning app where Indian
parents sign in on Android phones.

## What people see

**Sign-in page (`/signup`).** One field, "Phone number or email", and
**Continue with Google** when it is on. Pasted text is cleaned up at once
(`+91 98765-43210` shows as `98765 43210`).

| | Registered | New |
|---|---|---|
| Email | Password (unchanged) | Email code, then name and password (unchanged) |
| Phone | 6-digit PIN | SMS code, then name and a 6-digit PIN |
| Google | One tap | One tap; the account comes from the Google profile |

Forgot PIN, a PIN locked after 5 wrong tries, or a number that never had a PIN:
SMS code, then a new PIN. Code and PIN boxes (`arc-code-input`) verify on the last
digit, take a pasted code or a whole message, and let Android offer the code from
the SMS.

**Profile, Sign-in methods.** Add or change the email or phone number with a code
(a password or PIN is asked for only when the account has none), change the PIN,
connect Google. An email or number that is on another account shows one line
("linked to another account, verify it to move it here") and moves once the code
is verified.

**Admin.** Settings, Users: Phone number and Google switches (off by default).
Settings, SMS: provider (Test, log only, by default; MSG91), default and allowed
country codes, a test send, recent messages. Users: a Phone column and a
Detached accounts view.

## How it works

- **Phone sign-in is ArcCMS's own.** The number lives on the `users` record
  (`phone`, `phoneVerified`) and in `phone_index/{sha256(E.164)}` → `{ userDocId, uid }`,
  never on the Firebase Auth account, so a sign-in pool shared with another app
  (docs/coexistence-spec.md, P3) is untouched. After a correct PIN or code the
  server returns a custom token and the browser calls `signInWithCustomToken`.
- **Codes:** `phone_otps/{phoneHash}` (hashed, 10 minutes, 60 s resend gap, 5 tries,
  purpose `signup` / `reset` / `link`). Email codes stay in `signup_otps`, now with
  a purpose (`signup` / `link`).
- **PINs:** `auth_pins/{uid}`, scrypt with a random salt; the 5th wrong PIN in a row
  locks it until a reset by SMS code.
- **Limits:** per IP (checks, codes, PIN tries) and per number (5 codes an hour) in
  `_rate_limits`; only `Settings/sms.allowedCountryCodes` (default `91`) pass.
- **Google:** Firebase's provider, one account per email. `ensureGoogleAccount`
  creates the record for a first-timer. `onUserCreated` marks the Auth email
  verified when the server's own sign-up code proved it, so a later Google
  sign-in keeps the password instead of dropping it. A Google address that has a
  password account on another domain is connected after one password sign-in.
- **Moving an email or number** (`linkEmail`, `linkPhone`): the other account keeps
  its data. If it has no sign-in left it is **detached** (`status: 'Detached'`,
  `isActive: false`, kept, admins alerted); otherwise its owner gets an
  `account_security` notification. An email moving away also frees it on the old
  Auth account (`<uid>@moved.invalid`) and unlinks its password and Google.
  Every move is in `account_transfers`. Sign-ins another app owns
  (`authOwner` not `arccms`) are never changed.

## Callables (`arccms-` prefix)

`checkPhoneAccount`, `requestPhoneOtp`, `verifyPhoneOtp`, `completePhoneSignup`,
`signInWithPin`, `resetPin`, `setPin`, `ensureGoogleAccount`,
`checkIdentifierForLink`, `requestEmailLinkOtp`, `linkEmail`, `linkPhone`,
`sendTestSms`. Code: `functions/src/auth/`, `functions/src/sms/`.
Browser: `src/app/pages/(auth)/sign-in.service.ts`.

## Rules

Clients cannot write `phone` or `phoneVerified`, and cannot change their own
`email`. `phone_otps`, `phone_index`, `auth_pins`, `_rate_limits` are closed;
`SmsLogs` and `account_transfers` are admin read only; `Settings/sms` is admin only.

## Setting up a project

1. Firebase console, Authentication, Sign-in method: enable **Google** (only if
   Google sign-in is wanted).
2. Google Cloud console, IAM: give the functions' service account (by default
   "Default compute service account", `<project-number>-compute@developer.gserviceaccount.com`)
   the role **Service Account Token Creator**, and make sure the
   **IAM Service Account Credentials API** is enabled. Without it phone sign-in
   fails when issuing the token.
3. Deploy functions, Firestore rules and indexes.
4. Settings, Users: sign-ups on, Phone number on, Google on as wanted.
5. Settings, SMS: keep **Test** while testing (codes appear under Recent
   messages); switch to **MSG91** with the auth key and the DLT-approved OTP
   template id (containing `##OTP##`) for real SMS.

## Not built

- An admin action to attach a new email or number to a detached account (an
  admin can delete it).
- An SMS security notice to an account whose email moved away (each SMS
  template needs its own DLT registration).
- Google sign-in by redirect for installed PWAs where popups are blocked
  (revisit with the PWA kit, item 4).
