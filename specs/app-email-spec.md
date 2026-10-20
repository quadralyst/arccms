# App Email: Build Spec (AE, brief F27)

**Status:** BUILT 2026-10-20 on `dev`.
**Brief:** F27, "An app sends its own email: templates in its languages, attachments, and
the outcome back", written for every app on Arc CMS (the example is a shop's daily closing
email with two CSV files).

**Scope:**
1. `sendAppEmail`, a documented function in the app kit for an app's own Cloud Functions,
   running through `queueEmail` (gates, log, retries, dedupe).
2. App templates shipped from a new starter file, seeded into the admin's template list.
3. A version per language for app templates and for core's account emails.
4. Attachments kept in Storage beside the log.
5. Several recipients, one log each.
6. The outcome back to the app as `AppEvents`.
7. A feature toggle, App emails.
8. Test installs: the Simulated (Debug) provider shows the email and its files in Email Logs.
9. Docs (`docs/app/app-email.html`) and a capture helper for an app's unit tests.

**Out of scope:** marketing email from app code (lists and consent own that); admins editing
app templates (AE-D3); a language version for core emails other than the account emails;
checking the email webhook's signature (a separate follow-up, see AE-D9); SMS.

---

## 1. Decision log

| # | Decision | Choice |
|---|----------|--------|
| AE-D1 | Where the function lives | `sendAppEmail` in `functions/src/email-core/appEmail.ts`, exported from the app kit `functions/src/app-kit/index.ts`, the one module apps import from. It calls `queueEmail` once per address; `queueEmail` stays core's chokepoint and gains source `app`. |
| AE-D2 | The starter file | `functions/src/custom/email-templates.ts`, shipped empty with two exports: `APP_EMAIL_TEMPLATES: AppEmailTemplate[]` (the app's own templates) and `ACCOUNT_EMAIL_LANGUAGES: AccountEmailLanguages` (the app's wording of core's account emails in the languages it adds). Recorded in `scripts/custom-starters.mjs` (F24). A mistake in it (a bad key, a key twice, a language without subject or body, an English account email) stops the functions from loading, with a message naming the file. |
| AE-D3 | Can admins edit app templates? | **No.** App templates are the app's code: they are filled with the feature's data, and an edit in one language would drift from the others. The admin sees them in Email, Composer, marked App, with a preview per language filled with the template's sample data; the wording changes in the file and ships with a deploy. So there is nothing to survive a deploy and no reset. Core's account emails stay editable in English as today; their other languages come from the app's file. |
| AE-D4 | Language choice | A send asks for a language (`de`, `de-CH` finds `de`). App template: that language, else the site's default language (Settings, Languages), else English, else the first language the template has. Account email: that language, else the site's default, else the template in Settings (English). English, or a language with no version, is always the template in Settings, so an admin's edits keep working. |
| AE-D5 | Which language core's account emails use | The member's: the sign-in page sends its language with `requestSignupOtp`, `requestPasswordReset` and `requestEmailLinkOtp`. Arc CMS has no emailed sign-in code; "sign-in code" in the brief is the code for adding an email to an account, which uses the sign-up template. |
| AE-D6 | Tag data | `data` fills `##TAG##` at send time, HTML-escaped like every merge value. A value `{ html: '...' }` goes in as written, for a table the app builds (it escapes what it puts inside, with `escapeEmailHtml`). The data rides on the log under `appData`, never spread over the log's own fields. |
| AE-D7 | Layout and brand | The template's body (or the app's own `html`) is wrapped at queue time in the site's email layout, built from Settings, Email, Brand Kit (logo, colours, font, company name, address). The log keeps the wrapped HTML, so a retry sends the same email. |
| AE-D8 | Attachments | Up to 10 files and **5 MB in all** per email (after decoding). Each log keeps its own copy in Storage at `{storagePrefix}email-logs/{logId}/{n}-{name}`, uploaded before the log is written (so the send never runs ahead of its files), listed on the log as `attachments` (name, type, size, path). `sendMail` reads them on every attempt, a retry included. The purge (manual and scheduled) deletes a log's files with it. Storage rules: admins read, nobody writes from a browser, never public. A blocked send lists the files but stores none. |
| AE-D9 | Bounces | The email webhook now writes `Suppression` (`bounce` for a hard bounce or a bounce that names no type, `complaint` for a complaint), so the next send to that address is `suppressed`. Only for a log matched by the provider's message id: the fallback match by address and time could be faked by anyone who can reach the webhook. Resend's event names (`email.bounced`, ...) are read too. Checking the webhook's signature is a follow-up. |
| AE-D10 | Recipients | 1 to 50 addresses per call; each gets its own log, with its own gates, suppression, status and outcome. With a `dedupeKey`, each address's log id is derived from the key and the address's hash. |
| AE-D11 | Event names | `email.sent`, `email.failed`, `email.bounced`, written to `AppEvents` only for logs whose source is `app`, once per log (the id is the event and the log id). `data`: `logId`, `ref`, `to`, `template`, and `reason` on a failure (the skip reason, `send_failed`, or the provider's error). A send blocked at once (toggle off, suppressed) returns its status and also writes `email.failed`, so one trigger can handle every outcome. With the Simulated provider, `email.sent` carries `simulated: true`. |
| AE-D12 | The toggle | `features.appEmails` under Settings, Email, Features, labelled "App emails", on unless switched off. Off writes a `skipped` log with `feature_disabled`. The kill switch still stops everything. |
| AE-D13 | Seeding the admin's list | App templates are written to `EmailTemplate` as `app.{key}` (owner `app`, read-only, with `languages` and `sample`) when missing or changed, and removed when gone from the file, by a new admin callable `syncAppEmailTemplates` that the composer calls when it opens, and by `seedEmailTemplates`. Each send reads its template from the code, never from Firestore. Account emails get the app's languages written onto their template too, for the preview. App templates are never offered to Automations rules. |
| AE-D14 | Test helper | `captureAppEmails({ defaultLanguage })` from the app kit: while it runs, `sendAppEmail` checks its input exactly as for real and records each email (recipients, template, language asked and used, subject, body, data, attachments, reply-to, dedupe key, reference) instead of touching Firestore, Storage or a provider. `stop()` ends it. |
| AE-D15 | Reply-to and sender | `replyTo` per send, kept on the log and used by every provider; the sender is Settings, Email's sender name and address. Always transactional. |

---

## 2. What is true before this (Arc `dev` at 9105155c)

- `queueEmail` (functions/src/email-core/queueEmail.ts) is the only writer of `EmailLogs`,
  with the kill switch, feature toggle, template active, contact disabled, consent and
  suppression gates, `dedupeKey` and `sendNow`. `EmailSource` is closed.
- `emitAppEvent` writes `AppEvents`; admins map events to templates in Automations.
- `EmailTemplate` docs have one subject and body. Account emails (`signup_otp_email`,
  `password_reset_otp_email`) stay English.
- `sendMail` sends no attachments. The webhook marks a bounce on the log but writes no
  `Suppression`, so a bounced address keeps getting mail.

## 3. The API

```ts
import { sendAppEmail } from '../app-kit/index.js';

const result = await sendAppEmail({
  to: ['owner@example.com', 'books@example.com'],   // 1 to 50
  template: 'daily_closing',                          // a key in APP_EMAIL_TEMPLATES
  data: { DATE: '20 Oct 2026', TOTALS: { html: tableHtml } },
  // or, instead of template and data: subject: '...', html: '...', text?: '...'
  language: 'de',
  attachments: [{ name: 'sales.csv', contentType: 'text/csv', content: csvText }],
  replyTo: 'owner@example.com',
  dedupeKey: 'closing-c9',
  ref: 'businesses/b1/closings/c9',
});
// result.logs: [{ to, id, status: 'pending' | 'skipped' | 'suppressed', skipReason?, duplicate? }]
```

Starter file shape:

```ts
import type { AppEmailTemplate, AccountEmailLanguages } from '../app-kit/index.js';

export const APP_EMAIL_TEMPLATES: AppEmailTemplate[] = [];
export const ACCOUNT_EMAIL_LANGUAGES: AccountEmailLanguages = {};
```

```ts
interface AppEmailTemplate {
  key: string;                       // a-z, 0-9 and _, such as 'daily_closing'
  title: string;                     // its name in the admin's list
  languages: Record<string, { subject: string; body: string; previewText?: string }>;
  sample?: Record<string, string>;   // tag data for the admin's preview
}
type AccountEmailLanguages = Partial<Record<'signup_otp_email' | 'password_reset_otp_email',
  Record<string, { subject: string; body: string; previewText?: string }>>>;
```

## 4. Tests

The brief's list, each a spec: an app template in two languages sends the language asked
for and falls back to the default; an attachment survives a retry and is gone after the
purge; two recipients make two logs; a bounced address is suppressed on the next send; the
same `dedupeKey` sends once; with the toggle off, a skipped log is written; `email.failed`
reaches `AppEvents` with the app's reference; a German member gets core's sign-up code
email in German. Plus: the starter file's checks, the capture helper, Storage rules for
`email-logs/`, and the admin's toggle list.
