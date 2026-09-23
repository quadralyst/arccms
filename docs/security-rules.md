# Firebase Security Rules

## Overview

Arc CMS uses Firestore and Cloud Storage security rules to control data access. There are two types of users that interact with the system:

- **App users** - Authenticated via Firebase Auth (admins, customers). Identified by `request.auth`.
- **Waitlist subscribers** - Unauthenticated visitors who sign up for waitlists via public pages. They do NOT have Firebase Auth accounts.

---

## Firestore Rules

### Helper Functions

| Function | Description |
|----------|-------------|
| `isAuthenticated()` | `request.auth != null` |
| `isAdmin()` | Authenticated + custom claim `role == 'admin'` |
| `isEditor()` | `isAdmin()`, or authenticated + custom claim `role == 'editor'`. Content staff. Nothing in the app grants `editor` today, so in practice this is admins |
| `isOwnUserDoc()` | Authenticated + the document's `uid` field equals `request.auth.uid` (user doc ids are auto-generated, so ownership is the field, not the id) |
| `isSelfAssignableRole(data)` | `data` has no `role`, or `role == 'user'` |

### Roles and the admin claim

`isAdmin()` reads the `role` custom claim on the ID token. The
`onUserRoleChange` Cloud Function (`functions/src/users/syncUserRole.ts`) copies
`users/{docId}.role` into that claim. So whoever can write `role` on a user
document decides who is an admin, and the rules make sure that is only admins
and the Admin SDK:

- **Create:** a signed-in user may create only a document whose `uid` is their
  own, with no `role` or `role: 'user'`. Admins may create any user document.
- **Update:** a user may edit their own document but never `role`, `uid`,
  `isActive`, `status` or the premium entitlement fields, and may set
  `emailVerified` only to `false` (the email-change flow). Admins may edit any
  user document.
- **Read:** your own document, or any as an admin. A client query on `users`
  must filter on `uid == request.auth.uid` or the rules reject it.

`onUserRoleChange` is a second line of defence. It is a
`onDocumentWrittenWithAuthContext` trigger: when a document gains an elevated
role (anything other than empty or `user`), it syncs the claim only if the
write came from the Admin SDK (`service_account` or `system`) or from a user who
already holds the admin claim. Otherwise it logs an error, reverts the role on
the document and leaves the claim alone. Demotions always sync.

Claims are **merged**: the function reads the user's existing custom claims and
changes only `role`, so claims set by anything else survive.

**Default role for sign-ups.** The sign-up page always writes `role: 'user'`.
If an admin set `Settings/users.defaultRole` to something else, the trigger
applies it with the Admin SDK right after a self sign-up. That makes
`Settings/users` security relevant, so it is admin write only.

### The first admin on a fresh install

On a fresh install nobody holds the admin claim, so neither path above can
create the first admin. The onboarding wizard handles it like this:

1. The wizard signs the person up and creates their user document with
   `role: 'user'`, like any sign-up.
2. It calls the `claimFirstAdmin` callable. In one transaction the callable
   checks that there is no `_system/first_admin` sentinel and no user document
   with `role: 'admin'`. If both hold, it writes the sentinel, sets the caller's
   `role` to `admin` and sets the admin claim before returning. Otherwise it
   refuses with `permission-denied`.
3. The wizard force-refreshes the ID token and carries on with the admin-only
   setup steps. If the claim is missing (for example the call failed), the next
   admin-only step retries the callable once.

What this guarantees:

- Only one first admin, even if two people race the wizard.
- A finished install cannot be taken over by revisiting `/onboarding`: an admin
  already exists, so the callable refuses. That holds even if someone resets
  `Settings/onboarding_status`.
- Installs from before this change have no sentinel, but they have an admin
  document, which is enough for the callable to refuse.
- If every admin is later deleted, the sentinel still blocks the callable. To
  recover, set `role: 'admin'` on a user document in the Firebase console. The
  console writes as the Admin SDK, so `onUserRoleChange` trusts it and sets the
  claim.

What it does not guarantee: on a brand-new, publicly reachable install, whoever
reaches the wizard first becomes the admin. That was already true before, so
finish onboarding right after deploying.

`_system/{docId}` is closed to every client, admins included. A client that
could delete the sentinel could claim admin again.

### Collection Access

| Collection | Read | Write | Notes |
|------------|------|-------|-------|
| `ContentTypes/{id}` | Public | Staff (`isEditor()`) | SSR needs to read for routing |
| `arc_{slug}` (published) | Public | Staff | Published content |
| `arc_{slug}_drafts` | Staff | Staff | Draft content, also its `translations/{lang}` subcollection |
| `Tags_{slug}` | Public | Staff | Content tags |
| `Authors/{id}` | Public | Admin | Author profiles printed on bylines and in JSON-LD; no private fields by design |
| `Settings/discoverability` | Admin | Admin | Default author, crawler policy, IndexNow key |
| `WaitlistUserTags_{id}` | Admin | Admin | Internal admin data |
| `media/{id}` | Public | Staff | Media library records for images on public pages |
| `email_lookup/{hash}` | Public | Authenticated | SHA-256 email hash for signup |
| `Settings/email_status` | Public | Admin | Only `isEnabled` flag |
| `Settings/site-usage` | Public | Authenticated | Cookie banner config |
| `Settings/misc` | Public | Authenticated | Misc settings |
| `Settings/cache` | Public | Admin | CDN cache config |
| `Settings/global-message` | Public | Authenticated | Banner config |
| `Settings/users` | Public | Admin | Signup toggle and `defaultRole`, which the role trigger applies to sign-ups, so never writable by ordinary users |
| `Settings/about` | Public | Authenticated | Site identity (name, URL, address, logo, description, profile links, public contact email): the same data every static page publishes as schema.org JSON-LD; the SPA fallback reads it to emit the same nodes |
| `Settings/email` | Admin | Admin | Contains SMTP credentials |
| `Settings/integrations` | Admin | Admin | Contains API keys (Unsplash) |
| `Settings/analytics` | Admin | Admin | Contains the Google OAuth client secret |
| `Settings/dodo-payments` | Admin | Admin | Contains payment API keys + webhook secret |

> **`Settings/emailTestingConnection` no longer exists.** Testing an email provider
> used to write the provider configuration — SMTP password, Gmail password, Resend
> API key — into that document for a Firestore trigger to act on, and nothing ever
> cleared it. It is now the `testSmtpConfigConnection` callable, which authenticates
> the caller and keeps the credentials in the request body. Do not add a rule for
> the document: the one that used to be here was a nested `match` that silently
> granted nothing, and a downstream fork "fixed" it into an unauthenticated
> read/write grant over live credentials. See `scripts/purge-email-testing-doc.mjs`
> for cleaning up deployments that still hold the document.
| `users/{id}` | Owner or Admin | Owner (never `role`, see above) or Admin | User profiles; the `role` field feeds the admin claim |
| `_system/{id}` | None | None (Cloud Functions only) | First-admin sentinel written by `claimFirstAdmin` |
| `_publish_queue/{id}` | None (Cloud Functions only) | Staff | Processed by Cloud Functions |
| `AnalyticsDashboards/{id}` | Admin | Admin | |
| `EmailTemplate/{id}` | Admin | Admin | |
| `BroadcastEmails/{id}` | Admin | Admin | |
| `EmailLog/{id}` | Admin | Admin | |
| `ErasureLog/{emailHash}` | Admin | None (Cloud Functions only) | Erasure receipts. Hash-keyed and address-free; functions-only write because an editable audit trail is not an audit trail |

### Waitlist Collections (Unauthenticated Access)

These collections allow unauthenticated writes because the waitlist signup flow runs client-side without login. Field-level validation prevents abuse.

| Collection | Read | Create | Update | Delete |
|------------|------|--------|--------|--------|
| `Waitlists/{id}` | Public | Admin | Admin | Admin |
| `Waitlists/{id}/users/{id}` | Public | Validated | Validated (limited fields) | Denied |
| `WaitlistedUsers/{id}` | Public | Validated | Validated (limited fields) | Denied |
| `WaitlistedUsers/{id}/referrals/{id}` | Public | Validated | Validated (limited fields) | Denied |

#### Create Validation (WaitlistedUsers + Waitlists/users)

- Must include `email` and `waitlistId`
- `email` must be a non-empty string under 255 characters

#### Update Validation (WaitlistedUsers + Waitlists/users)

Only these fields can be updated:
`emailVerified`, `verificationCode`, `verificationExpires`, `verifiedAt`, `queuePosition`, `isSubscribed`, `firstName`, `leaderboardLink`, `totalReferrals`

#### Create Validation (referrals)

- Must include `referrerEmail` (non-empty string under 255 characters)

#### Update Validation (referrals)

Only these fields can be updated: `status`, `completedAt`

---

## Storage Rules

| Path | Read | Write |
|------|------|-------|
| `/{allPaths=**}` | Public | Staff (`role` claim `admin` or `editor`) |
| `/avatars/{uid}/{file}` | Public | The user whose uid it is; images under 5 MB only |

Storage is public-read because images are served on public pages and via SSR.
The media library, imports and exports are admin tools, so writing anywhere
else in the bucket needs the staff claim. Members set a profile photo from
their profile page, which uploads a resized WebP to their own `avatars/{uid}/`
folder and stores the URL in `users.photo`. Admins keep picking their photo
from the media library.

---

## Testing the rules

- `npm run test` includes `functions/src/__tests__/securityRulesRoles.spec.ts`,
  source-level guards that fail if the role and content-write holes reappear,
  and `syncUserRole.spec.ts` for the trigger and `claimFirstAdmin`.
- `npm run test:rules` runs `tests/rules/` against the Firestore and Storage
  emulators with `@firebase/rules-unit-testing`. It needs the Firebase CLI and
  Java 21 or newer.

---

## Known Limitations

1. **No rate limiting on waitlist signup** - An attacker could spam the waitlist create endpoint. Mitigation: migrate waitlist signup to a Cloud Function with rate limiting (planned for v1.1).

2. **No bot detection** - No CAPTCHA or proof-of-work on waitlist signup. Mitigation: add reCAPTCHA verification in Cloud Function (planned for v1.1).

3. **Staff storage writes have no file-type or size validation** - Only staff can write outside `avatars/`, and avatars are limited to images under 5 MB.

4. **Some settings are still writable by any signed-in user** - `Settings/about`, `site`, `email_status`, `global-message`, `misc`, `site-usage` and `onboarding_status`. None of them feeds a permission check, but any signed-in user can deface them. Only admin pages and the onboarding wizard (after the admin claim) write them, so they can move to `isAdmin()` in a follow-up.

5. **`email_lookup` is writable by any signed-in user** - The email-change flow writes it from the client. A user could add or remove other hashes. It no longer decides whether onboarding runs (`Settings/onboarding_status` does, and `claimFirstAdmin` refuses once an admin exists), so the impact is limited to the "email already registered" check.

6. **`emailVerified` on create is client asserted** - The sign-up page writes `emailVerified: true` after its OTP step, and the rules cannot check that the OTP happened.
