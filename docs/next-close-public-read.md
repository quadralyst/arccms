# Closing the public read of waitlist member emails

**Status: ✅ DONE** — `f750740`. All four rules now read `allow read: if isAdmin()`, and
an unauthenticated REST probe returns `PERMISSION_DENIED` on every path. Verified on a
dev server at `:5175`, an origin that has never held an admin session.

**Not yet on your live instances.** The rules are deployed to the dev project only.
Deploy order per instance is **callables → frontend build → rules**; rules alone breaks
any deployed frontend still reading client-side.

Kept as a record of what the change involved and — more usefully — the verification
protocol, which is reusable for any public-facing rules change here.

---

## The problem

`firestore.rules` carried `allow read: if true` on:

- `Waitlists/{waitlistId}/users/{userId}` and its `referrals` subcollection
- `WaitlistedUsers/{userId}` and its `referrals` subcollection

Verified exploitable — an unauthenticated request using only the web API key, which
ships in the frontend bundle:

```bash
curl -s "https://firestore.googleapis.com/v1/projects/<project>/databases/(default)/documents/WaitlistedUsers?key=<web-api-key>&pageSize=3&mask.fieldPaths=email"
```

That returns raw subscriber email addresses. It ships in the product's rules file, so
it affects every ArcCMS deployment, and the user has confirmed live instances with real
signups.

The rules were permissive because the pages read these documents from the browser. The
fix was to move those reads server-side, then deny client reads. **There is no
rule-level alternative:** the signup flow needs `where('email','==',X)` on member docs,
and Firestore rules cannot scope a *query* to the caller's own address without auth, so
any rule permitting that query also permits listing everyone.

---

## Done already

| commit | what |
|---|---|
| `01cb28f` | `getPublicLeaderboard` + `getPublicMemberView`; leaderboard and user-details pages re-pointed. Allowlisted fields, masked addresses. `getPublicMemberView` resolves a member-doc id **or** a legacy `waitlistedUserId`, so leaderboard links already sent by email survive U6. |
| `591799c` | `joinForm` — server-side find-or-create for signup, removing the two client reads in `joinWaitlist`. Also moved the public form's member count onto the form doc's `totalSignups`. |

All deployed and verified from a session-free origin.

---

## The six reads that had to move (all done in `f750740`)

In `src/app/pages/waitlist/waitlist.service.ts`. The service now has **zero** client
reads of member docs or the registry; what remains reads the form document, which is
public by design because it renders the page.

| line | read | what it became |
|---|---|---|
| `:209` | `getDoc` on `WaitlistedUsers` — `verifyOtpAndProcessUser` cross-waitlist branch | probably deletable, same reasoning as the `joinWaitlist` branch removed in `591799c` (U6 option C). Check what still depends on it. |
| `:237` | `getDoc` on the member doc — `verifyOtpAndProcessUser` | `finalizeFormSignup` already loads this record. Consider returning what the client needs from `verifyFormOtp`/`finalizeFormSignup`. |
| `:295` | `getDocs` confirmed-members query, for queue position/totals | looks redundant — `finalizeFormSignup` already counts server-side and returns `queuePosition` + `totalSignups`. Verify, then delete. |
| `:428` | `getDocs` on member docs `where referralCode == X` — `findReferrerMember` | **the only genuinely new code needed.** Either give `joinForm` the referral code (it already accepts `referredBy`) and let it write the referral record under the referrer's member doc, or add a small `creditReferral` callable. |
| `:456` | `getDocs` on the referrals subcollection — duplicate-referral guard | moves with `:428`. |
| `:540`, `:583` | `getDoc` on the member doc — `confirmWithoutOtp`, `resendVerificationCode` | `resendVerificationCode` only needs the address, which `requestFormOtp` already has. `confirmWithoutOtp`'s read may be avoidable since `finalizeFormSignup` re-reads the doc anyway. |

## The rules change (applied)

`allow read: if isAdmin()` on all four paths listed at the top. Leave `create`
alone — a signup writes its own member doc, and the U5 lockdown already restricts which
fields an update may touch.

Optional extra hardening once `joinForm` is the only writer: deny client `create` on
member docs too. Not required to close the leak.

---

## Verification protocol

Skipping this produced a false pass once already: the signup was tested on the origin
that was logged in as admin, `isAdmin()` made the client reads succeed, everything
looked healthy — and the same test on a session-free origin failed immediately with
`permission-denied`.

**1. Use an origin that has never held an admin session.** Firebase Auth persistence is
per-origin. `.claude/launch.json` is gitignored, so recreate this entry:

```json
{
  "name": "arccms-public-5175",
  "runtimeExecutable": "npm",
  "runtimeArgs": ["run", "dev", "--", "--port", "5175", "--strictPort"],
  "port": 5175
}
```

**2. Assert the session is absent — do not assume it.** Read IndexedDB
`firebaseLocalStorageDb` → `firebaseLocalStorage` and confirm no
`stsTokenManager.accessToken`. Port **5174 is logged in as admin**.

**3. Confirm denial** with the unauthenticated REST call above on all four paths —
expect `PERMISSION_DENIED`.

**4. Then, as an anonymous visitor on the clean origin:** a new signup; a resubmitted
address creating no duplicate; OTP verification through to confirmation; a referral
crediting; the public leaderboard; the user-details page; the member count on the form.

### Two things that look like failures but are not

- `requestFormOtp` enforces a 60-second resend throttle, so a second submit of the same
  address inside a minute errors with "Please wait Ns". That is the guard working.
- A blank page plus `Failed to fetch dynamically imported module` means the Angular Vite
  plugin is holding a stale type-check program. Restart the dev server. Browser console
  output can also be stale after a deploy — cross-check against an unauthenticated REST
  probe and `firebase functions:log`.

### Typecheck note

Use `npx tsc --noEmit -p tsconfig.app.json` for frontend files. The root `tsconfig.json`
does not cover them, so it reports clean on errors that break the Vite build.

---

## Deploy order

Per instance, and not interchangeable: **callables → frontend build → rules.** Rules
alone breaks any already-deployed frontend that still reads client-side.

Test data on the dev project is disposable; the user cleans it up.
