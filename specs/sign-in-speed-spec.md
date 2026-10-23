# Sign-in Speed: Fewer Waits Before a Code: Build Spec (SP)

**Status:** agreed with Gunjan 2026-10-23, after comparing a report on another app's slow OTP
sign-in with Arc CMS. Not built.
**Branch:** `perf/sign-in-speed`, cut from `dev` (e621480d), worktree `../arccms-sign-in-speed`.

**Scope:**
1. **Reads that do not depend on each other run together** in the sign-in callables and in the
   path a code email takes: the settings documents, the account lookup beside the check for a
   code already sent, the two hourly limits of a code request, the code email's template,
   wording and settings, and the contact and suppression checks of `queueEmail`.
2. **One call before a code, not two.** `checkPhoneAccount` and `checkEmailAccount` send the
   code themselves when the next screen is the code screen, so the page no longer waits for
   the check and then for `requestPhoneOtp` or `requestSignupOtp`.
3. **The code screen starts its countdown at once**, with "Sending your code..." under the
   boxes until the send answers, so Resend is not offered while the first send is still going.

**Out of scope:**
- `minInstances`: Gunjan turned it down on cost (2026-10-01). The page's warm-up calls stay
  the answer to cold starts.
- Moving xlm's functions next to its database (asia-south1): a separate release, not built.
  It would still be the biggest single gain on xlm.
- The PIN check, `processEmailTemplate`, the provider send itself, and creating the sign-in
  token (`createCustomToken`, a remote signing call on Cloud Functions; avoiding it would mean
  keeping a service-account key in the functions).
- An in-memory cache of the settings documents: an admin who changes a setting expects the
  next sign-in to follow it. Once the reads run together, a cache would save one round trip.

---

## 1. What is true today

Measured 2026-10-23 at localhost against xlm (database asia-south1, functions us-central1,
Test SMS and Simulated email providers), functions warm, from Continue to the code on screen:

| Path | Calls | Total |
|---|---|---|
| Phone, new number | `checkPhoneAccount` 2.1 s, then `requestPhoneOtp` 3.8 s | 6.0 s (12.0 s on a cold start) |
| Email, new address | `checkEmailAccount` 1.9 s, then `requestSignupOtp` 5.9 s | 7.8 s (11.5 s on the first try) |

- Every sign-in callable waits on its database reads one after another. `requestPhoneOtp`
  ([phoneAuth.ts](../functions/src/auth/phoneAuth.ts)) reads `Settings/users`, then
  `Settings/sms`, then `phone_index`, then the `users` record, then `phone_otps`; runs the
  caller limit and then the number limit (a transaction each, two round trips each); issues
  the code (a transaction); sends the SMS; writes the SMS log. About 12 round trips in a row.
- `requestSignupOtp` is about 19: the earlier code, both limits, the template, the issue
  transaction, then in `queueEmail` `Settings/email`, the contact, the suppression, the log
  write, the claim transaction, then in `sendMail` `Settings/email` again and the log update,
  then `Settings/email` a third time for `isSimulatedEmail`.
- Where the functions sit next to the database a round trip takes a few milliseconds and none
  of this shows. On xlm each takes about 300 ms.
- The page calls a check first and waits for it, then asks for the code in a second call that
  reads most of the same again.
- The page goes to the code screen before it sends, but starts the countdown only when the
  send answers. Until then the screen offers Resend, and a click sends a second request.
- Already in place, unchanged: callables (no trigger round trip), codes kept server-side only
  and sealed, the page's warm-up calls, the install's functions region next to its database
  (`ARC_FUNCTIONS_REGION`), verify on the last digit, no `setPersistence` call.

## 2. Decision log

| # | Decision | Why |
|---|---|---|
| SP-D1 | **`phoneContext` reads `Settings/users` and `Settings/sms` together.** Every phone callable uses it. | Neither read needs the other. |
| SP-D2 | **`requestPhoneOtp` reads the account and the number's earlier code together** (signup and reset). A link request still reads the signed-in record first, since the earlier code is checked against its uid. The refusals keep their order: no account, signups closed, then "already sent". | Two independent reads; the page sees the same answers. |
| SP-D3 | **The two hourly limits of a code request are counted together** (`consumeRateLimits`, accounts.ts), for phone, sign-up, password reset and email link codes. When either refuses, the other's count is given back and the first refusal in the list is thrown (the caller limit before the number or address limit, as today). | Two transactions at once instead of one after the other. Giving the count back keeps SC-D3: only codes really sent count. Today a number refusal still used up one of the caller's 20. |
| SP-D4 | **The checks count their caller limit while they read**: `checkPhoneAccount` and `signInWithPin` with the settings, `checkEmailAccount` with the settings and the record. The answer still waits for the limit: a refused caller learns nothing. | One or two round trips fewer each. |
| SP-D5 | **`checkPhoneAccount` with `sendCode: true` sends the code when the next screen is the code screen**: a new number while signups are open (`signup`), or a number with an account and no PIN (`reset`). The send is the one `requestPhoneOtp` makes (one shared function: the "already sent" check, both limits, the same reply). A number with a PIN, or a new number while signups are closed, sends nothing. | Saves a whole call from the browser, plus the reads the second call repeated. |
| SP-D6 | **`checkEmailAccount` with `sendCode: true` sends the sign-up code when the address is new and signups are open**, through the function `requestSignupOtp` uses, with the `name` and `language` the page passes. The page asks for it only when sign-up needs a code (E4: email on and "require verification" on), as it decides today. | The same saving for email. The page keeps the E4 decision. |
| SP-D7 | **A refused or failed send does not fail the check.** The reply carries the check's answer as before, plus either `code` (what the request callable would have answered) or `codeRefused` (`{ code, message, details }` of the refusal). | The person lands on the same screen with the same message as today; a limit on codes never hides the check's answer. |
| SP-D8 | **The page asks for `sendCode` only when it has no code still working for that number or address** (SC-D1). Coming back within a code's life sends nothing, as today. | Otherwise a return within the 10 minutes would resend (SC4 sends the same code again after the minute). |
| SP-D9 | **`SignInService` turns `codeRefused` into the error the callable would have thrown**, in the member's language (SC-D7), and the page runs it through the code screen's handling unchanged (the "please wait" countdown, the limit's clock time). | One error path on the page. |
| SP-D10 | **`requestPhoneOtp` and `requestSignupOtp` stay** for Resend, Forgot PIN, adding a number and older pages. | Only the first send moves into the check. |
| SP-D11 | **`issueEmailOtp` reads its template, the app's wording and `Settings/email` together, once**, and hands the settings to `queueEmail` (`emailSettings`, which it already takes) and to the test-mode checks. `isSimulatedEmail()` and `resetCodesShown()` stay, built on the same pure checks. | Three reads of one document become one, and the rest run at once. Covers sign-up, password reset and email link codes. |
| SP-D12 | **`queueEmail` reads the contact and the suppression together.** The gates keep their order. | Two independent reads; an email blocked by the contact gate costs one extra read, which it would not have made before. |
| SP-D13 | **A `sendNow` email is written already claimed** (`sendClaimedAt`), so the call that queued it sends it without the claim transaction, and `onEmailLogCreate` sees the claim and leaves it. `sendMail` takes the settings its caller just read (optional argument); the trigger and the retries still read them. | Removes a transaction and a read from every sign-in code email. A call that stops between the write and the send leaves the same claimed log it leaves today between the claim and the send. |
| SP-D14 | **The code screen starts the countdown when a send starts**, with the line "Sending your code..." until it answers. A send that fails clears the countdown, so Resend is there at once (as today); a "please wait" sets it from the server's seconds (SC-D2). | No Resend while the first send is still going, and the person sees something is happening. |
| SP-D15 | **`completePhoneSignup` stores the PIN, sets the new account's claims and makes the sign-in token together.** | Three independent calls; the token carries no claims (they are read when the browser exchanges it), and the reply still waits for all three. |

## 3. Phases

| Phase | What | Done when |
|---|---|---|
| SP1 | Phone server reads together: SP-D1 to SP-D4, SP-D15 | unit tests for `consumeRateLimits` (both pass, one refuses and the other is given back, order of refusals), `requestPhoneOtp` refusal order; existing sign-in tests pass |
| SP2 | Email server reads together: SP-D4 (email), SP-D11 to SP-D13 | tests: `issueEmailOtp` reads `Settings/email` once and passes it on; a `sendNow` log is written claimed and sent without a claim; the trigger skips it; contact and suppression gates unchanged |
| SP3 | Check and send in one call: SP-D5 to SP-D10 | server tests: phone sends for signup and for no PIN, not with a PIN or closed signups; email sends only for a new address with signups open; refusal in the reply. Page tests: no second call when the check sent, no `sendCode` with a fresh code, refusal shown on the code screen |
| SP4 | Countdown at once: SP-D14 | page tests: countdown and "Sending" line while the send is pending, Resend back after a failure; Hindi string |
| SP5 | Docs: docs/features/sign-in.html and every page `npm run docs:affected` lists | `npm run check:docs` and the whole suite green |
| SP6 | Deploy the changed functions to xlm, browser test, critical review | timings after, below; phone sign-up, PIN sign-in, Forgot PIN, Resend, a refused send, email sign-up checked in the browser |

## 4. Functions to deploy

The deploy menu's "functions changed since the last deploy" (import graph), which includes at
least `checkPhoneAccount`, `requestPhoneOtp`, `verifyPhoneOtp`, `completePhoneSignup`,
`signInWithPin`, `resetPin`, `checkEmailAccount`, `requestSignupOtp`, `requestPasswordReset`,
`requestEmailLinkOtp` and every function that queues email (`queueEmail`, `sendMail`). The
website is not deployed for this; the browser test runs at localhost against xlm's functions.

## 5. Results

To be filled in SP6, measured the same way as section 1.
