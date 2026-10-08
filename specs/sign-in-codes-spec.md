# Sign-in Codes: Waits, Limits and Server Messages: Build Spec (SC)

**Status:** BUILT 2026-10-08 (SC1 to SC4), agreed with Gunjan 2026-10-08 (the team's report on sign-in codes, items 1 to 3;
item 4, the country picker, shipped as specs/phone-country-spec.md).
**Branch:** `fix/sign-in-codes`, cut from `dev` (ee8b075), worktree `../arccms-phone-country`.

**Scope:**
1. Coming back to a number (or address) whose code is still valid goes straight to the code
   boxes, and the resend countdown carries on. A "please wait" from the server starts the
   countdown instead of showing an error.
2. Only codes actually sent count towards the hourly limits: the one-minute wait is checked
   first, and a send the provider refuses gives its count back. The limit message says when
   the person can try again.
3. Every refusal a member can see carries a reason code (and its numbers) in `details`; the
   page shows it from member strings in the member's language, the server's English only as
   a fallback.

4. **One code at a time (SC4, added 2026-10-08).** Asking again while a code still works
   sends the same code, so two messages never carry different codes.

**Out of scope:** the "[429]" the team saw after a message. Nothing in Arc CMS or the Firebase
SDK adds it (the SDK maps HTTP 429 to `resource-exhausted` and keeps the message as sent); it
is likely the app's own error display or a proxy. Once the page shows translated reasons,
no server text reaches members as is. Asked the team for the exact text and response body.

---

## 1. What is true today

- `changeIdentifier()` (signup.page.ts) zeroes the countdown; `checkPhone()` sends a new
  code at once; the server refuses it inside `RESEND_THROTTLE_MS` (60 s); `startCountdown()`
  runs only on success, so the page shows "Please wait 39s" with Resend live.
- `requestPhoneOtp` (phoneAuth.ts) calls `consumeRateLimit` for the caller (20 an hour) and
  the number (5 an hour) before `issuePhoneOtp` checks the wait. `requestSignupOtp` and
  `requestEmailLinkOtp` do the same for email. Each refused send uses one of the five.
- `consumeRateLimit` (accounts.ts) is a fixed window from the first use; its message says
  "in an hour" whatever is left. It is an app kit export (docs/app/app-kit.html).
- About 30 member-facing refusals in `functions/src/auth/*` are English sentences; a few
  carry `details.reason` (`signup-closed`, `no-access`, `app-managed`, `sign-in-not-ready`,
  `weak-pin`, `wrong`, `no-pin`, `locked`, `pin-required`, `password-required`).
  `readSignInError()` shows `err.message` as it is.

## 2. Decision log

| # | Decision | Why |
|---|---|---|
| SC-D1 | **The page remembers each code it asked for**, by channel, purpose and number or address, with when it was sent (and the test code, if shown). Coming back to the same one within the code's life (10 minutes) goes to the code boxes without sending; the countdown shows what is left of the minute, and Resend comes back after it. | The code already sent still works; sending again only hits the wait and the limit. Someone who went back because no SMS came still gets Resend once the minute is up. |
| SC-D2 | **A `wait` refusal starts the countdown** from `details.wait`, with one quiet line: "We sent a code a moment ago. Enter it, or ask for a new one when the timer ends." No error. | A code was sent (maybe from another tab); the person only needs to wait or use it. |
| SC-D3 | **Order on the server: checks, wait, limits, send.** `assertPhoneResendReady` / `assertEmailResendReady` run before `consumeRateLimit`; the issue functions keep their own check for races. | A refused send must not use up a code. |
| SC-D4 | **A send the provider refuses gives its counts back** (`releaseRateLimit`, which lowers the count by one). Email is queued, so only a failure to queue releases. | Only codes actually sent count. |
| SC-D5 | **`consumeRateLimit` says when it reopens**: `details.retryAfter` (seconds) and a `reason` (an optional new argument, `too-many-attempts` by default). The page says "Try again after 5:42 PM" in the member's language and clock. | Exact, and a clock time needs no plural forms. The app kit signature only gains an optional argument. |
| SC-D6 | **Every member-facing refusal carries `details.reason`** (kebab case) and its numbers, through one helper, `refuse(code, reason, message, extra)`. A refusal that means a bug ("Unknown request.") has none. | One place, testable. |
| SC-D7 | **`SignInService` translates** a refusal with a reason through `member.auth.server_error.<reason>` (dashes become underscores), with its numbers as parameters, before any page sees it; no key, or no reason, keeps the server's text. | Every sign-in page and the profile get it at once, through the `readSignInError()` they already use. |
| SC-D9 | **A resend sends the same code while it can still be used**: not verified, not expired, under 5 wrong tries, for the same purpose (and, to add a number or email, the same account), and less than 30 minutes since it was first made. Otherwise a new code. | Two messages with different codes leave the person guessing which works; only the newest did. The 30-minute cap keeps one code from living for hours. |
| SC-D10 | **The code is kept sealed beside its hash**: AES-256-GCM, with a key derived from the server secret in `_system/pin_pepper` and the document id as associated data, so a sealed code cannot be moved to another number. The hash is still what a guess is checked against. A record that cannot be opened (written before SC4) gets a new code. | The hash of a 6-digit code protects nothing (a million tries); sealing is no weaker and lets the code be sent again. |
| SC-D11 | **A resend restarts the 10 minutes and keeps the wrong tries.** The wait check, the choice of code and the write happen in one transaction. An SMS the provider refuses puts the old times back (a new code is deleted, as before). | The message says "expires in 10 minutes", so it must stay true. Tries no longer start again at 0 with every resend. One transaction closes the race between two requests at once. |
| SC-D12 | **The reply says `sameCode: true`**, and the page shows "We sent the same code again." in place of the sent toast. | The person knows any message they got works. |
| SC-D8 | **A test lists every reason the server uses** and fails when one has no English or Hindi member string, or when a member-facing `new HttpsError(` without a reason is added to the sign-in functions. | Keeps 3 from coming back. |

## 3. Reasons

| reason | numbers | today's text |
|---|---|---|
| `wait` | `wait` | Please wait {wait}s before asking for another code. |
| `too-many-codes` | `retryAfter` | Too many codes for this number (address). Please try again in an hour. |
| `too-many-attempts` | `retryAfter` | Too many attempts. Please try again later. |
| `sms-failed` | | We couldn't send the SMS. Please try again in a moment. |
| `email-failed` | | We couldn't send the email. Please try again later. |
| `code-expired` | | That code has expired. Please ask for a new one. (also "Your code has expired", "Please verify the number/email again") |
| `code-tries` | | Too many tries. Please ask for a new code. |
| `code-wrong` | | That code didn't work. |
| `invalid-number` | | Enter a valid mobile number. |
| `country-not-allowed` | `codes` | Only numbers starting {codes} can be used here. |
| `invalid-email` | | Enter a valid email address. |
| `name-required` | | Please enter your name. |
| `pin-format` | | Your PIN is 6 digits. |
| `weak-pin` | | That PIN is too easy to guess. |
| `number-taken` | | This number already has an account. |
| `no-account` | | No account uses this number. |
| `account-blocked` | | This account is blocked. Please contact the site administrator. |
| `wrong` | `remaining` | Wrong PIN. {n} left. |
| `no-pin`, `locked` | | Set a PIN with a code / Too many tries. Reset your PIN with a code. |
| `signup-closed`, `no-access`, `app-managed`, `sign-in-not-ready` | | (as today) |
| `phone-off`, `google-off` | | Phone (Google) sign-in is not turned on for this site. |
| `sign-in-again` | | Please sign in again. / Please sign in with Google again. |
| `email-has-account`, `google-email-taken` | | You already have an account with this email... / An account with this email already exists... |
| `pin-required`, `password-required`, `add-phone-first` | | (as today) |
| `email-managed`, `email-not-movable`, `sign-in-managed` | | (linking an email, as today) |

## 4. Phases

Each phase: build, its tests, `npm run test` alone with a full log (it type-checks), then a
critical review as the last task. Server changes are browser-checked only after Gunjan deploys
the changed functions (no emulator; `npm run dev` uses the real project).

### SC1: Server (functions deploy)
1. `refuse()` and reasons on every member-facing refusal (SC-D6), the reason test (SC-D8).
2. `consumeRateLimit` with `reason` and `retryAfter`, and `releaseRateLimit` (SC-D4, SC-D5).
3. Wait before limits in `requestPhoneOtp`, `requestSignupOtp`, `requestEmailLinkOtp` (SC-D3),
   release on a refused send (SC-D4).
4. Specs for the order, the release and the details.
5. Targeted deploy command for Gunjan; browser check after it: a wait refusal has
   `details.reason` and `wait`, and does not count.
6. Critical review of SC1.

### SC2: The page
1. `SignInService` translates reasons (SC-D7); member strings in English and Hindi.
2. Sign-in page: codes remembered per number and address (SC-D1), `wait` starts the
   countdown (SC-D2); the profile's add-a-number and add-an-email flows the same.
3. Specs: back to the same number within the minute and after it; a wait refusal; a
   translated message in Hindi; the clock time for `retryAfter`.
4. Browser: the team's steps (Change number, back with the same number), Resend after the
   minute, the page in Hindi.
5. Critical review of SC2.

### SC3: Docs
1. `npm run docs:affected`; at least docs/features/sign-in.html (codes, limits, messages),
   docs/features/sms.html (limits), docs/app/app-kit.html (`consumeRateLimit` details),
   docs/features/languages.html or member-languages.html (the new member keys), changelog.
2. `npm run check:docs`, full suite, functions build.
3. Critical review of SC3 and of the whole SC build against this spec.

### SC4: One code at a time (functions deploy)
1. `codeSeal.ts`: seal and open a code; the reuse rule (SC-D9, SC-D10).
2. `issuePhoneOtp` and `issueEmailOtp`: wait check, choice of code and write in one
   transaction; restart the expiry, keep the tries; put the times back on a refused SMS
   (SC-D11); `sameCode` in the reply (SC-D12).
3. The page and the profile: "We sent the same code again."; `code_already_sent` says
   "ask for it again" (English and Hindi).
4. Specs: same code on resend, tries kept, new code after expiry, lock, verify, another
   purpose or 30 minutes; the sealed code is not the code and is bound to its document;
   the page's line.
5. Docs: sign-in and SMS pages, changelog.
6. Critical review of SC4.

## 5. Deploy

Functions: the sign-in callables that throw refusals or count limits (the list goes in the
SC1 report). Hosting for the page. No rules or index changes.
