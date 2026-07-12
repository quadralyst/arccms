# ArcCMS Email & Notification System — Developer Guide

This guide explains how the email & notification system is wired and how a
product built on ArcCMS extends it. It is the practical companion to the build
spec (`docs/email-system-spec.md`).

---

## 1. Architecture in one picture

```
 senders (waitlist / auth / payment / notification / broadcast / drip / event / test)
        │
        ▼
   queueEmail()  ──►  writes ONE EmailLogs doc
   (email-core)       ├─ kill-switch check        (Settings/email.isEnabled)
                      ├─ feature-toggle check      (Settings/email.features[...])
                      ├─ template-active check
                      ├─ consent check             (Contacts.consent.marketing)
                      └─ suppression check         (Suppression/{emailHash})
        │
        ▼  (status: 'pending')
   onEmailLogCreate ──► sendMail()
                      ├─ belt-and-braces kill-switch
                      ├─ quota / rate limit         (deferred if exhausted; skipped for Debug Provider)
                      ├─ provider send (SMTP / Gmail / Resend / Debug Provider)
                      └─ retry w/ backoff (retrying → failed)   ← retryPendingEmails (5m)
```

**Golden rule:** never write to `EmailLogs` directly. The only sanctioned writer
is `queueEmail()` in `functions/src/email-core/queueEmail.ts`. A repo test
(`noDirectEmailLogWrites.spec.ts`) fails the build if any file outside
`email-core/` creates an `EmailLogs` doc.

Every email carries a **category** (`transactional` | `marketing`) and a
**source**. Transactional ignores marketing consent (but respects hard-bounce
suppression); marketing requires `consent.marketing === 'subscribed'` and a
`##UNSUBSCRIBE_LINK##`.

---

## 2. Sending an email from your code

Call `queueEmail` — don't touch `EmailLogs`:

```ts
import { queueEmail } from './email-core/queueEmail.js';

await queueEmail({
  source: 'payment',            // drives the feature-toggle gate
  category: 'transactional',
  toEmail: user.email,
  toName: user.name,
  senderEmail: template.senderEmail,
  senderName: template.senderName,
  subject: template.subject,
  template: template.template,  // raw HTML with ##TAG## tokens
  type: 'payment_succeeded_email',
  templateIsActive: template.isActive !== false,
  data: { PAYMENT_AMOUNT: '...', RENEWAL_DATE: '...' }, // merge-tag values
});
```

The return value tells you what happened: `{ status: 'pending' | 'skipped' |
'suppressed', skipReason? }`. Blocked sends are still written to `EmailLogs`
(auditable) — nothing is silent.

---

## 3. Adding a custom event (the event bus)

Product code emits an event; admin-configurable mappings turn it into a
notification / email / list change. Built-in mappings ship **disabled**.

1. **Emit** from anywhere in functions, *in addition to* your direct behavior:

   ```ts
   import { emitAppEvent } from './email-core/appEvents.js';
   await emitAppEvent('order.shipped', { userId, contactEmail, data: { TRACKING: '...' } });
   ```

2. **Map** it in `Settings/event_mappings` (admin → Email → Announcements →
   Event mappings, or write the doc directly):

   ```jsonc
   {
     "mappings": {
       "order.shipped": {
         "enabled": true,
         "createNotification": { "typeKey": "announcement", "titleTemplate": "Shipped!", "bodyTemplate": "Tracking: ##TRACKING##" },
         "sendEmail": { "templateType": "notification_generic_email", "category": "transactional" },
         "addToLists": [], "removeFromLists": []
       }
     }
   }
   ```

`onAppEventCreate` resolves the mapping, runs the actions, and marks the event
`processed` with per-action results. An unknown event type is marked processed
with `no_mapping` — it never crashes.

---

## 4. Adding a notification type

1. Add it to the registry `Settings/notification_types` (admin → Email →
   Announcements → Notification types, or seed via `ensureNotificationTypes`):

   ```jsonc
   {
     "types": {
       "order_shipped": {
         "label": "Order shipped",
         "description": "Your order is on its way.",
         "category": "transactional",
         "defaultChannels": { "inApp": true, "email": true },
         "userConfigurable": true,
         "enabled": true
       }
     }
   }
   ```

2. Create a notification:

   ```ts
   import { createNotification } from './email-core/notifications.js';
   await createNotification({ userId, type: 'order_shipped', title: 'Shipped!', body: '...', link: '/orders/123' });
   ```

`onNotificationCreate` decides email delivery via the matrix: **type email
channel × user preference × `features.notificationEmails` × master switch**. The
outcome is recorded in `emailDelivery` on the notification.

---

## 5. Adding an email template type

- Add a default in `functions/src/email-core/defaultTemplates.ts`
  (`DEFAULT_TEMPLATES`) — one doc per `type`, keyed by the type as the doc id
  (deterministic, no first-match ambiguity). Marketing templates must include
  `##UNSUBSCRIBE_LINK##`.
- Run the seeder (admin `seedEmailTemplates` callable) — it's idempotent and
  also seeds the notification-type registry, event mappings and system lists.
- Templates are edited in the **block editor** (`/admin/email-composer`), which
  compiles the design → email-safe HTML at save (both `design` and compiled
  `template` are stored). Legacy HTML templates keep working and can be
  "Upgraded to blocks".

---

## 6. Brand kit

`Settings/email_brand` holds the logo, colors, fonts, footer, socials and
address. Set it once at **admin → Email → Brand Kit** (live preview). The block
compiler wraps every block design in the branded shell; the footer supplies
`##UNSUBSCRIBE_LINK##` / `##PREFERENCES_LINK##` by default.

---

## 7. Admin runbook (fresh install)

1. **Provider** — admin → Settings → Email: pick a provider and enable email.
   (Email can't be enabled without a valid provider.) For testing, pick
   **Debug Provider (Log Only)** — it needs no credentials and no connection
   test; every email is composed and recorded in `EmailLogs` but never actually
   sent. Switch to SMTP/Gmail/Resend (and test the connection) before going live.
2. **Seed** — open admin → Email → Announcements once (it runs
   `seedEmailTemplates`), or call the callable, to seed templates + registries +
   system lists.
3. **Brand kit** — admin → Email → Brand Kit: logo, colors, footer.
4. **Backfill contacts** — admin → Audience → Contacts → "Backfill".
5. **Feature toggles** — admin → Settings → Email → Email Features: turn
   individual email types on/off; the master switch gates them all.
6. **Testing** — with **Debug Provider (Log Only)** active, exercise every flow
   and verify the whole pipeline from `EmailLogs` alone. A prominent banner on
   the admin dashboard reminds you it's active so it's never mistaken for a
   live setup.

---

## 8. Scheduled functions

| Function | Cadence | Purpose |
|---|---|---|
| `retryPendingEmails` | 5 min | Re-send `retrying`/`deferred` logs due for another attempt |
| `scanTrialEndings` | daily | Trial-ending reminder |
| `scanUpdatesEnding` | daily | Free-updates-ending reminder (E2) |
| `processScheduledBroadcasts` | 5 min | Activate due scheduled broadcasts; park stale (>24h) |
| `sendAdminDigest` | hourly | Daily admin digest (fires in the configured hour) |
| `processDripQueue` | 15 min | Send the due step of each active drip enrollment |
| `scheduledPurgeEmailLogs` | daily | Auto-purge old `EmailLogs` |

---

## 9. Known limitations / follow-ups

- **Template-delete guard for drips**: deleting an `EmailTemplate` still
  referenced by a non-archived drip campaign is not blocked yet. Archive the
  campaign first.
- **Paragraph rich-text** in the block editor uses a textarea (inline HTML), not
  an embedded tiptap instance.
- **Seeded default templates** are `editorVersion: 'html'` and upgradeable to
  blocks via the composer.
- **Exact unread counter**: the notification bell caps its badge at "9+" and
  counts unread within a recent window rather than a server-maintained total.

See `docs/email-testing-guide.md` for the full pre-launch test plan.
