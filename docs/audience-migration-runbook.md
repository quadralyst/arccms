# Audience unification — migration runbook

**Audience: Claude, executing this against a real ArcCMS deployment.**

Optimised for that. You cannot ask a follow-up question mid-migration, so every step below
states its expected result and its abort condition. If a step's actual result does not
match, **stop and report** — do not improvise a fix and continue.

Two absolute rules:

1. **Dry-run first, always.** Every callable below supports `{ dryRun: true }` except
   `seedEmailTemplates` and `dedupeEmailTemplates`, which are noted where they appear.
2. **Never trust a deploy's exit code.** Require an explicit `Successful create/update
   operation` line per function, and confirm with `firebase functions:list`. A deploy has
   reported exit 0 while pushing nothing on this project.

---

## 0. Pre-flight

| check | how | abort if |
|---|---|---|
| Correct project | `npx firebase-tools use` — confirm the project id with the operator before writing anything | it is not the intended project |
| Backup | Admin → Data → Export. Export **every** collection, `WaitlistedUsers` included | the export fails or is empty |
| Current state | note whether `WaitlistedUsers` exists and its document count | — |
| Tests | `npm run test` from the repo root | anything fails |
| Typecheck | `npx tsc --noEmit -p tsconfig.app.json` for frontend, `cd functions && npm run build` for functions | anything fails |

`tsconfig.app.json` matters: the root `tsconfig.json` does not cover `src/`, so it reports
clean on errors that break the Vite build.

---

## 1. Deploy, in this order

The order is **not** interchangeable. Each swap has a known failure:

```bash
# 1. Functions first.
npx firebase-tools deploy --only functions
```
Expected: `Successful create/update operation` per function, then `Deploy complete!`.
**Why first:** the U5 rules lockdown returns `permission-denied` on every signup unless
`finalizeFormSignup` already exists to do the writes the rules now forbid the client.

```bash
# 2. Indexes.
npx firebase-tools deploy --only firestore:indexes
```
Expected: `Deploy complete!`. Index builds are asynchronous — check the Firebase console
shows them **Enabled**, not Building, before step 5. A drip flush query failed silently on
this project for exactly this reason: `FAILED_PRECONDITION` swallowed by a `try/catch`.

```bash
# 3. Frontend build + hosting deploy (project's normal command).
```
**Why before rules:** the tightened member-doc read rule breaks the public leaderboard and
user-details pages on any *older* deployed bundle that still reads those docs client-side.

```bash
# 4. Confirm the new callables are publicly reachable.
bash functions/scripts/check-callable-access.sh joinForm requestFormOtp verifyFormOtp \
  finalizeFormSignup creditReferral getPublicLeaderboard getPublicMemberView
```
Expected: `✅ reachable` for all seven. If any shows `403 Forbidden` (HTML, not JSON), grant
the invoker binding the script prints. Newly created callables have **not** always received
`allUsers → roles/run.invoker` automatically on this project — `adminSetContactDisabled` and
`sendTestEmail` both needed it manually. Note that a Cloud Run refusal and an app-level
`permission-denied` both return 403; only the body differs, which is why the script exists.

```bash
# 5. Rules LAST.
npx firebase-tools deploy --only firestore:rules
```
Expected: `compiled successfully` then `released rules`.

**Abort condition for the whole section:** if step 5 is deployed before 1 or 3, signups or
the public pages break immediately. Recovery is to redeploy the previous `firestore.rules`
from git and re-verify a signup.

---

## 2. Data migration, in dependency order

Run each with `{ dryRun: true }`, read the report, then run for real, then **re-run** to
prove idempotency (a second real run should report zero work).

All are admin callables — call them from an authenticated admin session.

| # | callable | dryRun | what it does |
|---|---|---|---|
| 1 | `seedEmailTemplates` | **no** | global default templates. Idempotent by type; safe to run blind. |
| 2 | `dedupeEmailTemplates` | **no** | collapses duplicate global templates. |
| 3 | `normalizeWaitlistTemplateIds` | yes | merges per-form templates onto the canonical `${formId}_${type}` id. |
| 4 | `backfillWaitlistTemplates` | yes | per-form OTP + welcome defaults; also upgrades a superseded welcome subject to `Welcome to ##WAITLIST##`. |
| 5 | `backfillContacts` | yes | `Contacts` from existing users and verified waitlist members. |
| 6 | `backfillPendingContacts` | yes | contacts for unverified signups, consent `pending`. |
| 7 | `backfillFormLists` | yes | each form's mirrored audience list. |
| 8 | `stampFormTargetLists` | yes | `targetListIds` on each form. |
| 9 | `migrateTagsToContacts` | yes | per-waitlist tags → global contact tags. |
| 10 | `migrateFormDataToContactFields` | yes | `formData` → `Contacts.fields` + the field registry. |
| 11 | `migrateWelcomeToSequences` | yes | welcome email becomes a day-0 drip step. |
| 12 | `migrateWaitlistedUsers` | yes | historical referral records → `Waitlists/{id}/users/{memberId}/referrals`. |

**Order rationale.** 1–4 must precede anything that sends, because a form with no OTP
template now *fails closed* — `finalizeFormSignup` refuses to confirm a signup rather than
confirming it unverified. 5–8 build the audience layer that 9–11 write into. 12 is last
because it is the only one that depends on the U6 cutover being deployed.

**Step 12 is time-sensitive.** Until it runs, referral history written before the cutover is
invisible on the user-detail page (that page reads the member's own subcollection). Counts
are unaffected — they live on the member doc. Run it in the same session as the deploy, not
weeks later.

### Reading step 12's report

```json
{ "registryDocsScanned": N, "referralsFound": N, "referralsCopied": N,
  "referralsAlreadyPresent": N, "unresolved": [] }
```

`unresolved` is not a failure — it lists records the migration refused to guess at, each
with a reason (no `waitlistId` on the record, or no member back-referencing the registry
doc). Report them; do not hand-place them.

---

## 3. Verification

### 3a. The exposure is closed

Unauthenticated, using only the web API key from the deployed bundle:

```bash
curl -s "https://firestore.googleapis.com/v1/projects/<project>/databases/(default)/documents/WaitlistedUsers?key=<web-api-key>&pageSize=3&mask.fieldPaths=email"
```

Expected: `PERMISSION_DENIED`. Repeat for:
- `Waitlists/<formId>/users`
- `Waitlists/<formId>/users/<memberId>/referrals`
- `WaitlistedUsers/<id>/referrals`

**If any returns documents, the migration has not achieved its main purpose.** Stop and
report.

### 3b. The product still works — from a session-free origin

This is the step most likely to be got wrong, and it has already produced one false pass.
Firebase Auth persistence is **per-origin**. Testing on an origin where an admin is logged
in makes `isAdmin()` satisfy the very client reads the rules now deny, and everything looks
healthy.

Use a port that has never held an admin session. `.claude/launch.json` is gitignored, so
recreate this entry:

```json
{
  "name": "arccms-public-5175",
  "runtimeExecutable": "npm",
  "runtimeArgs": ["run", "dev", "--", "--port", "5175", "--strictPort"],
  "port": 5175
}
```

Then **assert** the session is absent rather than assuming it — read IndexedDB
`firebaseLocalStorageDb` → `firebaseLocalStorage` and confirm no
`stsTokenManager.accessToken`.

As an anonymous visitor on that origin:

| check | expected |
|---|---|
| New signup | member created, OTP step reached |
| Same address resubmitted | **no** duplicate member doc (one `joinForm: created member` log line for two submits) |
| OTP verification | confirms, assigns a queue position |
| Referral link signup then verify | referrer's `totalReferrals` increments by exactly 1 |
| Public leaderboard | renders, **masked** addresses only |
| User-details page | renders, position and referral stats correct |
| Member count on the form | renders |
| A leaderboard link from an **already-sent** email (legacy id) | still resolves |

### 3c. Things that look like failures and are not

- **`Please wait Ns before requesting another code`** — `requestFormOtp`'s 60-second resend
  throttle. Expected on a second submit of the same address within a minute.
- **A skipped email showing raw `##TAGS##` in the log** — a skipped email never reaches a
  provider, so `processedSubject` is never computed. Correct, not a merge-tag failure.
- **Blank page + `Failed to fetch dynamically imported module`** — the Angular Vite plugin
  holding a stale type-check program. Restart the dev server.
- **Stale browser console output after a deploy** — cross-check against an unauthenticated
  REST probe and `firebase functions:log` rather than trusting the console.

---

## 4. Rollback

| step | reversible? | how |
|---|---|---|
| 1–4 (deploys) | yes | redeploy the previous commit's artefacts |
| Rules | yes | `git checkout <prev> -- firestore.rules` then redeploy |
| Migrations 1–11 | additive | they create and update; re-running is safe. No automatic undo — restore from the step-0 export if needed |
| Migration 12 | additive | copies records, stamps `migratedAt`. Re-running copies nothing new |
| Trigger deletion | yes, by redeploy | but see below |

**`totalReferrals` cannot be un-doubled by a rollback.** Migration 12 stamps `migratedAt` on
every copy precisely so `onReferralCreate` skips it — without that guard, copying a
completed referral fires the crediting trigger and doubles every historical count. If you
suspect a double-count, compare a member's `totalReferrals` against the number of
`status: 'completed'` records in their `referrals` subcollection before doing anything else.

---

## 5. Post-migration, left deliberately undone

- **`WaitlistedUsers` is frozen, not deleted.** Rules allow admin writes only; nothing
  writes it in normal operation. Pre-cutover records are kept because already-sent links
  resolve through them and the legacy importers read them.
- **It is still offered in Admin → Data → Export**, on purpose. Removing the only way to
  back up live data before retiring it would be backwards. Remove that entry only when an
  operator has decided to delete the collection.
- **Physical deletion is a deliberate operator step**, after the verification in §3 has
  passed and an export is in hand. Nothing here does it.

---

## Appendix — traps, each of which cost real debugging on this project

- **Dry-run first.** The U5.5 backfill's first dry run revealed that template presence was
  keyed on the canonical doc id while live data held *three* id schemes (random auto-ids,
  legacy `${type}_${formId}`, canonical `${formId}_${type}`). The real run would have
  written duplicate templates for every older form.
- **Copying documents fires create triggers.** See migration 12 above.
- **A write moving is not the whole change.** Three separate bugs came from moving a write
  and leaving a *reader* pointed at the old location — a stale leaderboard rank, an admin
  referral panel showing nothing, and a referrer's count decremented twice. Every one passed
  the unit tests. Two source-scan audits now guard this:
  `functions/src/__tests__/waitlistedUsersRetired.spec.ts` and
  `listMembershipChokepoint.spec.ts`. Run them after any change in this area.
- **Verify against real data, not only tests.** Several bugs here passed unit tests and
  failed live.
- **`firebase functions:log` and REST probes are more trustworthy than the browser console**
  immediately after a deploy.
