# Claims Writes Take Turns: Build Spec (F5)

**Status:** built 2026-10-06 on `fix/claims-merge-lock`; suite, functions build and rules tests green, docs updated. Not yet merged to `dev`.
**Branch:** `fix/claims-merge-lock`, cut from `dev` (0e06e38), rebased on bf90c28.
**Scope:** close the lost-write race in `mergeClaims` (`functions/src/users/claims.ts`), so
Arc's own claims writes and an app's `mergeAppClaims()` on the same account keep each
other's claims, and make every doc state the real guarantee.

**Out of scope:** writers outside Arc CMS that call `setCustomUserClaims` themselves (they
take no lease and can still overwrite claims; the docs say so), and a Firestore TTL policy
on the lease collection (leases are deleted when the write ends; one left by a crash is a
tiny document that the next write on that account takes over).

---

## 1. What was true

`mergeClaims` read the claims, wrote them all, read them back and retried when its patch
was missing (A5, C-D6). That narrows the race but does not close it: if writer A reads back
before writer B's write lands, both read-backs pass and A's claims are gone. The docs said
Arc's and an app's claims "never lose each other".

## 2. Decision log

| # | Decision | Why |
|---|---|---|
| CL-D1 | **Close it** with a per-account lease, not a docs-only fix. | The cost is small: a claims write that changes nothing (the usual role sync) takes no lease, and one that changes something costs two short Firestore transactions (take, give back), next to three Auth calls it already makes. Claims writes are rare: sign-up, a role change, a record move, `refreshMyClaims` when the token is wrong, an app's own claims. A lost `arccms_uid` denies a person their own record, which is worth closing. |
| CL-D2 | A lease on `_claim_locks/{uid}`, taken and given back in transactions; the Auth calls run between. | A Firestore transaction cannot contain `setCustomUserClaims`, and transactions retry, so the transaction guards only the lease document. The holder writes a random token; giving back deletes only its own token, so a writer whose lease expired never frees the next writer's lease. |
| CL-D3 | Lease 15 seconds; a waiter waits up to 20 seconds with growing, jittered pauses (25 ms doubling to 1 s), then fails with an error. | The work is three Auth calls, about a second. The wait outlasts a crashed holder's lease and stays inside a function's 60-second default timeout. |
| CL-D4 | The read-back and redo (up to three times) stays inside the lease. | A writer that outlives its lease can still race the next one, and a writer outside Arc can still overwrite. The read-back catches both when it sees the patch missing. |
| CL-D5 | Check the claims once before taking the lease; return when they already say so. | Most calls change nothing; they cost no Firestore write. Safe: a write in progress started from the same claims, so it keeps them. |
| CL-D6 | `_claim_locks` closed to every client in `firestore.rules`. | Only functions touch it (Admin SDK). |
| CL-D7 | The real guarantee, as the docs state it: two writes through Arc CMS on one account take turns and keep each other's claims, unless one is still running when its 15-second lease runs out; it is then read back and redone if its claims are missing. Writers outside Arc CMS take no lease. | Precise, not "never". |

## 3. Build

- `functions/src/users/claimLock.ts`: `withClaimLock(uid, work)`, `CLAIM_LOCKS`,
  `CLAIM_LOCK_LEASE_MS`, `CLAIM_LOCK_WAIT_MS`.
- `mergeClaims` runs its read, write and read-back loop inside `withClaimLock`, after a
  first check that skips the lease when nothing would change. Every Arc claims write
  (`mergeUserClaims`, `setRecordClaims`, `clearArcClaims`, `setUserRecordClaim`) and the
  app kit's `mergeAppClaims` and `createAppAccount` go through it, so nothing else changes.
- `firestore.rules`: `match /_claim_locks/{uid} { allow read, write: if false; }`.
- Docs: `docs/app/app-accounts.html` (the guarantee), `docs/concepts/roles-and-claims.html`,
  `docs/app/account-contract.html` (use `mergeAppClaims()`, not a hand-made read and write),
  `docs/operations/security-rules.html` and `docs/reference/data-model.html` (the new
  collection).

## 4. Tests

- `functions/src/__tests__/claimLock.spec.ts`: a fake Auth whose writes land with set
  delays makes two merges interleave so that one reads back before the other's slower write
  lands. With the lease turned into a no-op the test shows one set of claims lost; with the
  lease both are kept, and four racing merges all land. Also: no lease when nothing changes,
  the lease is given back when the work throws, an expired lease is taken over, a live one
  makes the waiter fail after the wait without removing it, and a writer never removes a
  lease that went to another writer. Checked by hand: with `withClaimLock` replaced by a
  pass-through in `mergeClaims`, the two concurrency tests fail.
- `tests/rules/firestore.rules.spec.ts`: `_claim_locks` is closed to anonymous, signed-in
  and admin clients.
- `appKit.spec.ts`, `onUserDelete.spec.ts`, `syncUserRole.spec.ts`: their fake Firestore has
  no lease collection, so they mock `withClaimLock` as a pass-through.

## 5. End-of-work checks

- After deploying functions and rules: change a user's role in the admin and check the
  claims still land (the person's token shows the new `arccms_role` after a refresh), and no
  `_claim_locks` document is left behind in the Firestore console.
- Deploy order: functions first, then rules (rules only close a new, unused collection).
