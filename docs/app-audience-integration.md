# App audience: integration guide

How to connect ArcCMS to another app's users, so ArcCMS can email them, group them into
lists, run sequences for them and react when their data changes, while their data stays in
the other app's own collection.

Written for an AI agent doing the integration (and for the developer checking its work).
Follow the steps in order. Each step says how to confirm it worked before moving on.

Design and decisions: `docs/coexistence-spec.md`, section 5b. This guide is the practical
path through it.

---

## What you are building

- **The host app** is the other app. It keeps its users in one Firestore collection, one
  document per person, and writes to it as it always has. It changes nothing for ArcCMS.
- **ArcCMS** runs in the same Firebase project, in its own named database (usually
  `arccms`). It reads the host collection live, and a trigger on that collection tells it
  about every change.
- **The host app's users are not ArcCMS users.** They never sign in to ArcCMS and get no
  `users` record there. ArcCMS stores only what is its own about them: email consent, drip
  progress and the email log (`AppAudience/{sha256(unique key)}`). No profile data is copied.
- **Only admins sign in to ArcCMS.** The sign-in pool is shared, so ArcCMS runs with
  sign-ups off (admin-only sign-in).

What the admin gets:

| Where | What |
|---|---|
| Audience, App users | Every host user, live, with search and a detail panel (all fields, email status, recent events) |
| Audience, Lists | App users (live) lists: conditions on host fields, no stored members |
| Email, Broadcasts | Send to live lists, alone or with contact lists |
| Email, Drip Campaigns | Sequences on live lists: join when someone starts matching |
| Settings, Automations | Rules on host events: "isPro becomes true" sends the upgrade email |
| Any template | `##APP.<field>##` merge tags, such as `##APP.plan.tier|free##` |

---

## Step 0. Check the host app fits

All of these must be true. If one is not, stop and tell the developer which.

1. **Same Firebase project.** ArcCMS and the host app deploy to the same project. (Across
   projects is not supported.)
2. **One top-level collection of users**, one document per person, such as `users/{id}`. Not a
   subcollection, not a collection group, not several collections.
3. **A unique key per person.** Either the document id, or a field such as `email`, `uid` or
   `phone`. It must not be shared between two people. Ask the developer which one; never
   assume it is the email (apps with phone and OTP sign-in have none).
4. **An email field**, if ArcCMS should email these people. People without an address are
   listed but never emailed.
5. **At most about 2000 users.** Lists, counts and broadcasts read the whole collection
   (capped at 2000, and the admin is told when it is cut). Larger audiences are not supported
   yet.
6. **Blaze plan**, Firebase CLI signed in (`firebase login`), Node as in `package.json`.

## Step 1. Collect the facts

Find these in the host app's code or ask the developer. You need every one before Step 2.

| Fact | Example | Where to look |
|---|---|---|
| Firebase project id and `.firebaserc` alias | `acme-prod`, alias `default` | `.firebaserc`, the host's firebase config |
| Host database id | `(default)` | the host's `getFirestore()` calls; almost always `(default)` |
| Host database location | `asia-south1` | Firebase console, Firestore; or `firebase firestore:databases:list` |
| Host users collection | `users` | the host's writes on sign-up |
| Unique key | document id, or field `uid` | how the host looks a user up |
| Email field, name field, phone field | `email`, `profile.name`, `phone` | a sample user document |
| Fields whose changes matter | `isPro`, `plan.tier`, `premiumStatus` | the host's payment and plan code |
| ArcCMS hosting | its own site, or none | ask; `none` if ArcCMS is only an admin backend |
| ArcCMS storage bucket and upload folder | `acme-prod-arccms`, `arccms/` | ask |

Nested fields are written as dot paths (`plan.tier`). Maps are read three levels deep.

## Step 2. Configure the install

Run `arc:configure` for the project. Flags update `arccms.config.json` and regenerate the
files that need the values.

```bash
npm run arc:configure -- --project=default --profile=backend --database=arccms --site=none --bucket=acme-prod-arccms --prefix=arccms/ --app-users-database='(default)' --app-users-path='users/{id}'
```

- `--app-users-path` is `<collection>/{id}`, exactly. The wildcard name does not matter.
- `--profile=backend` requires its own database, hosting site (or `none`) and bucket, and
  turns on `--admin-only-sign-in=yes`.
- ArcCMS's own `users` collection in its own database is refused as a host collection.
- Add `--dry-run` to see what would change first.

It writes:

| File | Commit it? | Holds |
|---|---|---|
| `arccms.config.json` | no (gitignored) | the choices, per project |
| `src/environments/arc-install.ts` | **yes** | the app's database, bucket, upload folder, admin-only sign-in, per project id |
| `functions/.env.<projectId>` | no (gitignored) | `ARC_DATABASE_ID`, `ARC_HOSTING_SITE`, `ARC_APP_USERS_DATABASE`, `ARC_APP_USERS_PATH` |
| `firebase.<projectId>.json` | no (gitignored) | Firebase CLI config for the named database, bucket and site |

For the backend profile it prints the commands that create the database, hosting site and
bucket. Run them. **Create the ArcCMS database in the same location as the host database**:
the trigger on the host collection runs in the host database's region, and a matching
location keeps everything in one place.

**Confirm:** `functions/.env.<projectId>` contains the four `ARC_` lines with your values.

> **Do not run `firebase deploy --dry-run` against the named-database config** to "check" it.
> The dry run really creates a missing database, in the CLI's default location (`nam5`), which
> cannot be moved afterwards.

## Step 3. Deploy

```bash
npm run deploy -- --only functions,firestore --project default --non-interactive --force
```

The `npm run deploy` wrapper, not plain `firebase deploy`:
- builds the functions first (the CLI uploads whatever is in `functions/lib`);
- picks up `firebase.<projectId>.json`;
- fails if any function it started never reported success (the CLI can skip one after a rate
  limit and still exit 0);
- then checks that every callable is reachable, and fails on a blocked (403) or missing (404)
  one.

A first deploy creates over a hundred functions (all named `arccms-*`, in the `arccms`
codebase, so the host app's functions are untouched). Expect a few to fail on rate limits or
timeouts. Redeploy exactly the ones listed:

```bash
npm run deploy -- --only functions:arccms:arccms.listAppUsers --project default --non-interactive --force
```

A callable reported **blocked (403)** was created without public access (its creation timed
out). Delete it and deploy it again; a fresh create grants access.

Hosting is not deployed here. Deploy it only if ArcCMS has its own site and the developer
asks.

**Confirm:** the wrapper ends with `All callables reachable.` and exit code 0.

## Step 4. First admin and sign-in

`npm run dev` serves the app at `http://localhost:5173` against the **real** project (there is
no emulator), so everything below writes to the deployed databases.

1. Open `http://localhost:5173`. A fresh install opens the onboarding wizard. The developer
   creates the first admin account there.
2. When the wizard finishes, sign-ups turn off (admin-only sign-in, from Step 2): Settings,
   Users, "Enable User Signups" is off. From then on the rules refuse any self-created ArcCMS
   account.
3. More admins: Users, Add user, with a temporary password. If the address is already one of
   the host app's accounts, that account is reused (marked shared) and keeps its own password;
   deleting it from ArcCMS never deletes it from the host app.

**Confirm:** signing in with a host user's password (someone not added in ArcCMS) signs
straight out with "This account doesn't have access to this site".

## Step 5. Tell ArcCMS how to read a user

Settings, App audience. The top shows the database and collection from Step 2 (they can only
change with a new deploy). Then:

1. **Unique key**: the document id, or a field. Use the answer from Step 1.
2. **Email, phone, name**: pick the fields. Fields come from a sample of 20 real documents.
3. **Watched fields**: tick the fields whose changes should become events (Step 7). Leave
   counters and timestamps out; they change constantly and would mean nothing.
4. **Test** with a document id (or the first document) to see the person as ArcCMS reads
   them. Then **Save** (`Settings/app_audience` in the ArcCMS database).

Fields whose names look like credentials are always shown as `(hidden)` and are never put
into an email or an event. A name counts when it contains password, passcode, secret, token,
credential or jwt, when one of its words is otp, pin, pwd, hash, salt, cvv or ssn, or when it
is a key, code or id of a kind such as `apiKey`, `privateKey`, `resetCode` or `sessionId`.
Everything under such a field is hidden too (`credentials.google`), and so is a matching key
inside a list or a deeper map. A yes/no value stays visible (`passwordless: true`). If the host
stores a secret under another name, rename it in the host app or tell the developer.

An email log keeps only the host fields that email's `##APP.*##` tags use, never the person's
whole document.

**Confirm:** Audience, App users lists the host's users with the right names and addresses.

## Step 6. Confirm the live connection

1. Open a person in Audience, App users. The panel shows every host field and "Recent
   activity".
2. In the host app (or the Firebase console, host database), change one of that person's
   watched fields.
3. Within about 20 seconds, Recent activity shows `field: old → new`.

If nothing appears, see Troubleshooting.

## Step 7. Automations: email on an event

Settings, Automations lists the events. With an app connected:

| Event | When |
|---|---|
| `app_user.created` | a new host document appears (not the ones that existed at deploy) |
| `app_user.changed.<field>` | one per watched field, with the old and new value |
| `app_user.deleted` | a host document is deleted |

Each event has an on/off switch and rules. A rule has a name, for field changes an optional
condition ("was" and "becomes": exactly, any of, none of), and an email: a template and a
type (transactional reaches everyone; marketing respects unsubscribes). App-user events send
email only; they never create contacts or change lists.

Values compare as text, ignoring case (as in live lists), and empty, missing and null are all
the same empty value. So
`isPro` becoming `true` is "becomes exactly `true`"; a free plan written as either `""` or
`"free"` is "any of `, free`".

Stored shape (`Settings/event_mappings`), for reference:

```json
"app_user.changed.isPro": { "enabled": true, "rules": [
  { "name": "Upgraded",   "when": { "to": { "equals": "true" } },
    "sendEmail": { "templateType": "app_user_upgraded", "category": "transactional" } },
  { "name": "Downgraded", "when": { "to": { "equals": "false" } },
    "sendEmail": { "templateType": "app_user_downgraded", "category": "transactional" } }
] }
```

`templateType` is an `EmailTemplate` document's `type`. Create the templates first.

**Confirm:** change the field in the host; Recent activity shows the event with "Actions
ran", and Email Logs shows the email (as skipped with `email_disabled` until sending is set
up in Settings, Email).

## Step 8. Lists, broadcasts and sequences

- **Live list**: Audience, Lists, Create list, "App users (live)". Add conditions on host
  fields (is, is not, is any of, contains, greater than, less than, is empty, is not empty;
  all must match). The count updates as you edit. The list's page shows who matches now.
  Note: "isPro is false" does not match a person with no `isPro` field; use "isPro is not
  true" for everyone who is not Pro.
- **Broadcast**: pick the live list in Email, Broadcasts. At send time the host collection is
  read, and each person gets the email with their own `##APP.*##` values. An address on both
  a contact list and a live list gets it once.
- **Sequence**: Email, Drip Campaigns, on a live list. A person joins when a host write makes
  them start matching (day 0 goes out at once), and leaves when a write makes them stop
  matching, when they are deleted, or when they unsubscribe. "Enroll existing" on activation
  enrolls everyone who matches then. A person never enters the same sequence twice.

## Step 9. Templates and merge tags

| Tag | Value |
|---|---|
| `##APP.<path>##` | the host field at send time, such as `##APP.plan.tier##` |
| `##APP.<path>|fallback##` | the same, with a fallback when it is empty or missing |
| `##NAME##` | the name field from Settings, App audience |
| `##FIELD##`, `##FROM##`, `##TO##` | on a field-change automation: the field, old value, new value |
| `##UNSUBSCRIBE_LINK##`, `##PREFERENCES_LINK##` | as for every email |

Credential-like fields are never available as tags.

Values are plain text. In the email body, markup in a value is shown as typed, never rendered,
and a line break becomes a new line. A value that looks like a tag (a name such as
`##COMPANY_NAME##`) is printed as it is, never filled in. Settings tags read only the company
name, sender name and address, reply-to address and site URL, never credentials or secrets.

## Step 10. Unsubscribe and consent

Every app user is subscribed until they unsubscribe. The unsubscribe link and the preferences
page record the choice on the person's `AppAudience` record (never by creating a contact) and
end their sequences. Their status shows in Audience, App users. Suppression by address still
applies to every send.

---

## Standalone: your own users as the audience

A standalone site or an app built on ArcCMS has no host app, but the same tools work over
its own `users` collection: live lists on plan or role, automations when a user's field
changes, and sequences that start when a user starts matching.

```bash
npm run arc:configure -- --project=default --app-users=own
npm run deploy -- --only functions --project default --non-interactive --force
```

`--app-users=own` points the audience at `users/{id}` in the install's own database (and
follows it if the database changes). Then do Steps 5 to 10, with these differences:

- **Unique key**: the `uid` field (or the document id). Email field `email`, name field `name`.
- **These people are also contacts** (every sign-up joins the "All users" list). A broadcast
  to both an ordinary list and a live list emails each address once, and a contact's
  unsubscribe wins.
- **One sign-up fires two events**: `user.signed_up` (every install) and `app_user.created`.
  Put a welcome email on one of them, not both.
- Sign-ups stay as they are: admin-only sign-in is for sharing a project with another app.

## The host app's side of the contract

Tell the developer of the host app:

- Keep writing user documents as you do. Every write runs the ArcCMS trigger once; writes
  that change no watched field and no live-list match end there.
- Keep the email field current: ArcCMS reads it at every send.
- Deleting a user document ends their ArcCMS sequences; their unsubscribe is kept in case the
  address returns.
- Do not write to the ArcCMS database, and do not use collection names under it.
- Do not store secrets in user documents under names that do not look like secrets.
- Plan and payment fields are ordinary fields to ArcCMS: the host app does its own payments.

## Changing things later

| Change | What to do |
|---|---|
| Unique key, email/name/phone field, watched fields | Settings, App audience. No deploy. |
| Host collection or host database | `npm run arc:configure -- --app-users-path=...` (or `--app-users-database=...`), then deploy functions: the trigger is bound at deploy time. |
| The ArcCMS database was deleted and recreated | Existing triggers stay bound to the old database and never fire. **Delete** the `arccms-*` Firestore triggers and deploy them again; an update does not rebind them. |
| The host database was recreated | Same, for `arccms-onAppUserWritten`. |

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| App users page: "internal" | The callables are missing (deployed from an old build) or still starting | `npm run deploy` again (it builds first); reload after a minute |
| A callable fails with 403 in the browser | Created without public access after a timeout | Delete that function, deploy it again |
| Deploy says a function "never reported success" | Rate limit or timeout during deploy | Redeploy exactly the listed functions |
| Deploy fails with "no value for ARC_..." | Non-interactive deploy with a param unset | Run `arc:configure` for that project; the committed `functions/.env` holds the defaults |
| Recent activity stays empty after a host change | Field not watched; trigger bound to another database or path; database recreated | Check Settings, App audience; check `functions/.env.<projectId>`; see "Changing things later" |
| Automation "No rule set up for this event" | No mapping for that event | Add a rule in Settings, Automations |
| Automation ran but no email arrived | Sending is off (`email_disabled`) or the template is inactive | Settings, Email; check Email Logs for the skip reason |
| A host user can sign in to ArcCMS | Sign-ups are on | Settings, Users: turn off "Enable User Signups" |
| A live list matches nobody | Condition on a field most documents lack, or a value in another case or format | Open the list's page; values compare as the admin sees them (booleans as `true`/`false`, dates as ISO) |
| New translation keys show as raw keys in the admin | Dev server started before `npm run i18n:keys` | Restart the dev server |

## Reference

| Thing | Where |
|---|---|
| Design and decisions | `docs/coexistence-spec.md`, section 5b |
| Deploy-time params | `ARC_APP_USERS_DATABASE`, `ARC_APP_USERS_PATH` (`functions/src/app-audience/config.ts`) |
| How a document is read | `Settings/app_audience` (unique key, channels, watched fields) |
| ArcCMS's own state per person | `AppAudience/{sha256(unique key)}`: `consent`, `deleted` |
| Events | `AppEvents/{firestoreEventId}.{suffix}`, with `appUserId` |
| Automation rules | `Settings/event_mappings`; matching in `functions/src/email-core/eventRules.ts` |
| Live lists | `Lists/{id}` with `type: 'app'` and `conditions`; `functions/src/app-audience/appLists.ts` |
| Sequences | `DripEnrollments/{campaignId}_app_{appUserId}`; `functions/src/app-audience/appDrips.ts` |
| Trigger | `arccms-onAppUserWritten` (`functions/src/app-audience/onAppUserWritten.ts`) |
| Admin callables | `arccms-appAudienceStatus`, `-sampleAppUsers`, `-testAppUser`, `-listAppUsers`, `-getAppUser`, `-previewAppList`, `-adminCreateUser` |
| Limits | one top-level collection; 2000 documents per read; maps read three levels deep |
