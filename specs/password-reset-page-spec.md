# Password reset in Arc CMS (spec, not built)

Status: agreed with the user 2026-10-09, not built. Option A (emailed code) chosen; see
section 11. Follows F22 (fix/sign-in-f22, in ../arccms-f22), which made one password rule
(`passwordProblem()` in `src/shared/utils/password-rule.ts`) apply everywhere except
Firebase's hosted reset page. Build on top of F22 once it is merged into dev.

## 1. The gap

Forgot password (`forgotPassword()` in `src/app/pages/(auth)/(signup)/signup.page.ts`) calls
`sendPasswordResetEmail`. Firebase emails a link to its own action page
(`<project>.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=...`). That page:

1. applies only Firebase's 6 character minimum, not Arc's rule;
2. is in Firebase's words and look, not the member language or the site's brand;
3. opens in the browser, never inside an installed PWA; on iPhone the person then has to go
   back to the app and sign in again, since Safari and the home screen app keep separate
   sign-ins.

The F22 test switch ("Show password reset links on screen", `requestPasswordResetLink`) lands
on the same page. And the email itself never reaches Email Logs or the Simulated provider.

## 2. Link or code (decided: code)

Both options have Arc send the email through its own email engine, not Firebase. That part is
not optional, see section 3.

| | A. Emailed code, reset on the sign-in page (recommended) | B. Emailed link to an Arc page, /reset-password |
|---|---|---|
| Steps for the person | Forgot password, read the 6 digit code, type it with the new password, signed in | Forgot password, open the email, tap the link, type the new password, signed in |
| Installed PWA | Stays in the app throughout | Link opens the browser (always on iPhone; on Android only if Chrome hands the link to the app). After the reset the person goes back to the app and signs in |
| Password rule | Checked on the page and again on the server, which sets the password with the Admin SDK (name and email both known there) | Checked on the page only (`confirmPasswordReset` is a client call), like sign-up; the server never sees the new password |
| Reuses | The email code machinery of sign-up and add-email: `signup_otps`, `issueEmailOtp`, one code at a time, sealed resends, 5 tries, 10 minutes, rate limits, the "We sent the same code again" wording | Little: a new page, new route, link building |
| Site address | Not needed | The server must build the link from `baseUrl` (site-settings.ts), which is the live site, so a reset asked for on localhost lands on the live site |
| Test mode | The code shows on the page, like the sign-up code and the SMS "Show PIN reset codes on screen" | The link shows on the page, as F22 does today |
| Matches | Forgot PIN (SMS code, then a new PIN, on the same page) | Firebase's habit; nothing else in Arc |

Recommendation: **A**. It closes all three gaps, keeps the person in the app, puts the rule on
the server too, and is mostly reuse. B is what the F22 follow-up note named; it is kept below
in short so the choice is made on purpose.

## 3. Why Arc sends the email (both options)

The other ways to point Firebase's reset email somewhere else both fall short:

- **Firebase console action URL** (Authentication, Templates, Customize action URL) is one
  setting per project, for every email action (reset, verify email, recover email, change
  email). In a shared sign-in pool (CO6) it would also move the host app's emails to Arc's
  page. It cannot be set from the deploy without the Identity Toolkit admin API and extra
  permissions, and a wizard step asking the admin to paste a URL into the console is a step
  most will skip.
- **`actionCodeSettings`** on `sendPasswordResetEmail` sets only the continue URL: the person
  still resets on Firebase's page and then sees a Continue button.

So Arc makes the code (A) or the Firebase action code (B, from the Admin SDK's
`generatePasswordResetLink`, whose `oobCode` Arc lifts into its own link) and sends the email
itself. Nothing to set up per install, the host app's emails are untouched, and the email
shows in Email Logs with the site's sender and template.

## 4. Design for option A

### Flow on the sign-in page

1. Password step, **Forgot password**. The page calls `requestPasswordReset({ email })`.
2. The step changes to: "We emailed a code to {{ email }}." with a **Code** field, a
   **New password** field (show/hide, `newPasswordValidator` with the email as owner) and a
   **Set password** button. "Send the code again" under it, with the same wait between
   sends (`resendWait` in codeSeal.ts) and wording as the sign-up code.
3. **Set password** calls `resetPasswordWithCode({ email, code, password })`. On success the
   page signs in through the normal path (`authStore.login`), so a blocked or no-access
   account is handled as at sign-in, and the person lands where sign-in takes them.
4. **Back** returns to the password step.

### Server (functions/src/auth/, beside signupOtp.ts)

- `EmailOtpPurpose` gains `reset`. A reset code never verifies a sign-up and the reverse
  (`matchesPurpose`).
- `requestPasswordReset({ email })`: rate limited per IP and per address like
  `requestSignupOtp`. Looks up the record; refuses `no-email-account` when there is no account
  Arc may reset (section 5). Calls `issueEmailOtp(email, 'reset')` with a new
  "Password reset code" template, seeded lazily as the sign-up template is. Returns
  `{ sent, again?, testCode? }`; `testCode` only with the Debug Provider and the reset switch
  on.
- `resetPasswordWithCode({ email, code, password })`: checks the code (wrong, expired, too
  many tries: the same reasons and words as the sign-up code), then `passwordProblem(password,
  { email, name })` from the record, refusing `weak-password` with the `problem` as
  `linkEmail` does. Then `updateUser(uid, { password })`, `revokeRefreshTokens(uid)` so every
  other session is signed out (as a PIN reset does), and the code is marked used.
- `requestPasswordResetLink` (F22) is removed.

### When the email engine cannot send

When Email is off or has no provider, `requestPasswordReset` answers `{ sent: false,
reason: 'email_disabled' }` and the page falls back to today's `sendPasswordResetEmail`, so
a fresh install can still reset. Firebase's page and its 6 character minimum apply only then;
the docs say so. (Sign-up by email already needs the engine, so in practice this is a site
that only has Google or phone sign-in plus old password accounts.)

### Test mode

The F22 switch keeps its stored field (`Settings/email.showResetLinks`, mirrored to
`Settings/email_status.showResetLinks`) and is relabelled **Show password reset codes on
screen**, matching SMS. With it on, the code shows in the test box on the page, as the
sign-up code does. Off by default, off when the Debug Provider is left, hint unchanged in
meaning.

### Email language

Arc's emails stay in English (docs/app/member-languages.html, "What stays in English").
Firebase's reset email followed the member language where Firebase had a template, so a
Hindi member's reset email becomes English. The email is short and mostly the code; the page
around it is in their language. Accepted unless the user wants the reset template per
language, which would be the first translated email and belongs in its own task.

## 5. Shared sign-in pool (CO6)

Today Firebase resets any login in the pool, the F22 test path only Arc's own. With A:

| Record | Reset from Arc's sign-in page |
|---|---|
| Arc record, `authOwner` missing or `arccms` | Yes |
| Arc record, `authOwner: shared` (uses Arc and the host app with one login) | Yes. It is the same person's one login: the new password works in the host app too. The host app's own rule, if stricter, is not applied |
| Arc record, `authOwner: host` | No: "Reset your password in the app you signed up with." The host app owns that login |
| No Arc record (a host app user only) | No, the same answer. They could not sign in to Arc anyway |

The refusal reason is `host-account`; the words are the member key below.

## 6. Member strings (English, Hindi)

Under `member.auth.reset.*`. Existing `reset_link_sent`, `reset_link_label` and
`reset_link_open` go; `reset_failed` stays for the fallback.

| Key | English | Hindi |
|---|---|---|
| `title` | Choose a new password | नया पासवर्ड चुनें |
| `code_sent` | We emailed a code to {{ email }}. | हमने {{ email }} पर एक कोड ईमेल किया है। |
| `code_label` | Code | कोड |
| `new_password_label` | New password | नया पासवर्ड |
| `submit` | Set password | पासवर्ड सेट करें |
| `resend` | Send the code again | कोड फिर से भेजें |
| `done` | Password changed. You're signed in. | पासवर्ड बदल गया। आप साइन इन हैं। |
| `host_account` | Reset your password in the app you signed up with. | जिस ऐप से आपने साइन अप किया था, उसी में पासवर्ड रीसेट करें। |
| `test_label` | Test mode, no email sent. Your code: | टेस्ट मोड, कोई ईमेल नहीं भेजा गया। आपका कोड: |

Code errors and "We sent the same code again." reuse the sign-up code keys. Password errors
reuse `member.auth.password_error.<problem>`. Admin: `show_reset_links` becomes "Show password
reset codes on screen" / "पासवर्ड रीसेट कोड स्क्रीन पर दिखाएँ".

## 7. Option B in short (not chosen, kept for the record)

- Route `reset-password` in `app.routes.ts`, explicit (file-based pages render "Content Not
  Found"), full screen like sign-in, outside the language redirect so `/hi/reset-password`
  works.
- Page reads `oobCode`, calls `verifyPasswordResetCode` (shows the email; expired or used code:
  "This link has expired. Ask for a new one." with a button back to Forgot password), takes the
  new password through `newPasswordValidator`, calls `confirmPasswordReset`, then signs in.
- `requestPasswordReset` builds `${baseUrl}/reset-password?oobCode=...&lang=..` from
  `generatePasswordResetLink`'s `oobCode`, refusing host accounts as in section 5, and sends
  it through the email engine. Same fallback when the engine cannot send.
- An unknown `mode` (someone sends another Firebase action here) is forwarded to Firebase's
  own handler with the query intact.
- The rule is checked on the page only, as at sign-up.

## 8. Tests

- `signupOtp.spec.ts` (or a new `passwordReset.spec.ts`): reset codes are a purpose of their
  own; one code at a time; wrong, expired and 5-tries refusals; `weak-password` with each
  problem, including `personal` from the record's name; host and no-record refusals; `shared`
  allowed; `updateUser` and `revokeRefreshTokens` called; the code is used once; `testCode` only
  with Debug Provider plus the switch; `email_disabled` when the engine is off.
- `signup.page.spec.ts` and `signup.page.render.spec.ts`: Forgot password shows the code step;
  validator messages; success signs in through `authStore.login`; fallback calls
  `sendPasswordResetEmail`; test code shown; `host_account` message; Back.
- Hindi parity test covers the new keys; `email-setting` spec for the relabelled switch.
- Rules unchanged (the codes live in `signup_otps`, already closed to clients).
- Browser pass on the xlm dev project with the Debug Provider and a real provider: reset,
  sign in on another device first and see it signed out, Hindi, a phone-width screen, the
  installed PWA.

## 9. Docs

- docs/features/sign-in.html: "Forgot password" rewritten for the code, the fallback and the
  test switch; "Passwords" drops the Firebase reset page sentence (keeps it only for the
  fallback); the functions table swaps `requestPasswordResetLink` for the two new callables;
  the troubleshooting row about Email Logs changes.
- docs/app/sign-in.html: the setup step about the reset switch; a line for host app users
  (section 5).
- docs/app/member-languages.html: the reset email is now Arc's and in English.
- docs/features/email.html: the new template in the template list.
- docs/reference/cloud-functions.html: the two callables.
- Screenshots: the sign-in page's reset step, Settings, Email with the relabelled switch.

## 10. Phases

1. Server: `reset` purpose, the two callables, the template, refusals, tests.
2. Page: the code step, fallback, test code, strings in English and Hindi, tests.
3. Settings relabel, `requestPasswordResetLink` removed, browser pass on xlm (functions
   deploy first).
4. Docs and screenshots, `npm run docs:affected`, `npm run check:docs`, the full suite.
5. Critical review of the whole change; fix critical and high items, report the rest.

Deploy: functions only (`requestPasswordReset`, `resetPasswordWithCode`, and deleting
`requestPasswordResetLink`). No rules or indexes.

## 11. Decisions (agreed 2026-10-09)

1. Option A: an emailed code, reset on the sign-in page. Option B is not built.
2. `shared` accounts may reset from Arc; `host` accounts and logins without an Arc record are
   sent to the host app.
3. The reset email is in English, like Arc's other emails. A translated reset email would be
   its own task.
