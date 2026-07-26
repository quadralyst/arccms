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
| `isOwner(userId)` | Authenticated + `request.auth.uid == userId` |

### Collection Access

| Collection | Read | Write | Notes |
|------------|------|-------|-------|
| `ContentTypes/{id}` | Public | Authenticated | SSR needs to read for routing |
| `arc_{slug}` (published) | Public | Authenticated | Published content |
| `arc_{slug}_drafts` | Authenticated | Authenticated | Draft content |
| `Tags_{slug}` | Public | Authenticated | Content tags |
| `WaitlistUserTags_{id}` | Admin | Admin | Internal admin data |
| `media/{id}` | Public | Authenticated | Images on public pages |
| `email_lookup/{hash}` | Public | Authenticated | SHA-256 email hash for signup |
| `Settings/email_status` | Public | Admin | Only `isEnabled` flag |
| `Settings/site-usage` | Public | Admin | Cookie banner config |
| `Settings/misc` | Public | Admin | Misc settings |
| `Settings/cache` | Public | Admin | CDN cache config |
| `Settings/global-message` | Public | Admin | Banner config |
| `Settings/users` | Public | Admin | Signup toggle |
| `Settings/email` | Admin | Admin | Contains SMTP credentials |
| `Settings/integrations` | Admin | Admin | Contains API keys (Unsplash) |
| `users/{id}` | Authenticated | Owner or Admin | User profiles |
| `_publish_queue/{id}` | None (Cloud Functions only) | Authenticated | Processed by Cloud Functions |
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
| `/{allPaths=**}` | Public | Authenticated |

Storage is public-read because images are served on public pages and via SSR. Any authenticated user can upload files.

---

## Known Limitations

1. **No rate limiting on waitlist signup** - An attacker could spam the waitlist create endpoint. Mitigation: migrate waitlist signup to a Cloud Function with rate limiting (planned for v1.1).

2. **No bot detection** - No CAPTCHA or proof-of-work on waitlist signup. Mitigation: add reCAPTCHA verification in Cloud Function (planned for v1.1).

3. **Storage has no file-type or size validation** - Any authenticated user can upload any file type. Mitigation: add Cloud Function validation on upload or restrict via storage rules to specific content types.

4. **All authenticated users can write content** - No role-based write restrictions on content collections beyond authentication. If customer-level users should not create content, restrict with `isAdmin()` checks.
