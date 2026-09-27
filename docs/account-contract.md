# Account contract: for apps built on Arc CMS

> **Audience:** developers and AI agents building an app on Arc CMS that shares its
> Firebase project (sign-in, Firestore database, Storage bucket). Arc CMS owns
> accounts, sign-in, roles and payments. This page is what an app can rely on.
> Payments and plans: [dodo-payments-entitlement-contract.md](dodo-payments-entitlement-contract.md).
> Security rules for app data: [app-rules.md](app-rules.md).

## 1. One person, one account

A person is one Firebase Auth account plus one record in the `users` collection.
They sign in with email and password, a phone number (an SMS code the first time,
then a 6-digit PIN) or Google ([sign-in-methods.md](sign-in-methods.md)).

The record id (`users/{userDocId}`) is **not** the Auth uid. The record carries the
uid in its `uid` field.

## 2. The `arccms_uid` claim: the record id in the ID token

Every account carries a custom claim, **`arccms_uid`**, whose value is its `users`
record id. Read it from the ID token instead of querying:

```ts
const token = await auth.currentUser.getIdTokenResult();
const userDocId = token.claims['arccms_uid'] as string;   // users/{userDocId}
```

In security rules use the helper `ownsUserRecord(userDocId)` ([app-rules.md](app-rules.md)),
which compares the claim with no document read.

**When it is set**
- On every way an account is created: email sign-up, phone sign-up, Google sign-up
  and an admin adding a user. The server sets it before the browser's first ID
  token, so it is present the moment sign-in completes.
- On sign-in, the browser checks the token. An account made before the claim
  existed gets it then (the `refreshMyClaims` callable), and the token is refreshed
  before the app is told the person is signed in.
- If a record is moved to another sign-in account, the claim follows it.
- An admin can re-apply every account's claims with the `syncAllUserRoles` callable
  (run it once after deploying this change).

**When it is missing:** deny. `ownsUserRecord()` is false without the claim. A token
can lack it only for a moment after an old account first signs in, and the sign-in
flow refreshes it before handing over.

**Other claims:** `role` is Arc CMS's role (`admin`, `editor`, `user`, ...), read by
`isAdmin()` and `isEditor()`. Arc CMS always merges claims, never replaces them, so
claims an app sets survive. Do not name an app claim `role` or `arccms_*`.

## 3. Where an app keeps a person's data

- **Firestore:** under the record, `users/{userDocId}/{collection}/...` at any depth,
  for example `users/{userDocId}/children/{childId}/progress/{lessonId}`. The app
  grants access in `firestore.app.rules` with `ownsUserRecord(userDocId)`. Nothing is
  open by default: without an app rule, only the Admin SDK can read or write there.
- **Storage:** the per-user folder `users/{userDocId}/...` (under the install's
  upload folder, if it has one: `arccms/users/{userDocId}/...`). The owner and admins
  can read it; the app grants writes, with its own size and type limits, in
  `storage.app.rules`. It is never public.

## 4. Deleting an account

An account is deleted by an admin (Users, Delete) or by the person (Profile, Delete
account, which needs a sign-in within the last 10 minutes; admins cannot delete
themselves). Either way the `users` record is deleted, and then, on the server:

1. **Firestore:** every subcollection under `users/{userDocId}`, at any depth.
2. **Storage:** the folder `users/{userDocId}/` (under the upload folder) and the
   profile photos in `avatars/{uid}/`.
3. **Sign-in:** the Firebase Auth account, unless another app owns or shares it
   (`authOwner` is `host` or `shared`), plus the email lookup, the phone number
   index and the PIN.
4. **Event:** `user.deleted` on the event bus (`AppEvents`), with `userId` (the Auth
   uid) and `data.userDocId`.

**Data an app keeps elsewhere** (another collection, another service) is the app's
to delete. Either add a Firestore trigger on `users/{docId}` deletes in the app's own
functions, or react to the `user.deleted` event. Keeping per-person data under the
record (section 3) needs neither.

## 5. Quick reference

| Need | Use |
|------|-----|
| The signed-in person's record id | ID token claim `arccms_uid` |
| Their record | `users/{arccms_uid}` (readable by its owner and admins) |
| Their plan | fields on the record: [dodo-payments-entitlement-contract.md](dodo-payments-entitlement-contract.md) |
| Their private data | `users/{userDocId}/...` in Firestore, `users/{userDocId}/` in Storage |
| Rules for it | `firestore.app.rules`, `storage.app.rules`: [app-rules.md](app-rules.md) |
| Clean up data kept elsewhere | trigger on `users/{docId}` delete, or the `user.deleted` event |
