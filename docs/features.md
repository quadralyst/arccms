# Choosing an app's features

An app built on Arc CMS picks which Arc CMS features it has. A feature that is off
has no menu item, no page, no settings tab, no dashboard card, no Firestore read and
no Cloud Function. Its data stays, and turning it back on brings everything back.

The design and its decisions are in [feature-flags-spec.md](feature-flags-spec.md).
This guide is how to use it.

## The features

| Feature | What goes when it is off | Needs |
|---|---|---|
| `content` | Content types, entries, authors, tags, public content pages, static pages (`/p/...`), publishing | |
| `search` | Search settings, the admin search box and page, the public search box and `/search`, link suggestions in the editor, related items on content pages, every search function | |
| `seo` | Discoverability settings, sitemap, robots.txt, llms.txt, RSS, IndexNow | |
| `forms` | Signup forms (waitlists), their pages, leaderboards, referrals and emails. The markup of a form on your pages stays; nothing reads or submits it | `audience` |
| `audience` | Contacts, lists, tags, fields, app users, App audience settings | |
| `email-marketing` | Broadcasts, drip sequences, announcements | `audience` |
| `sms` | SMS settings, SMS logs, test SMS, and phone sign-in | |
| `payments` | Products, transactions, pricing, checkout, the member's Payments, Account and Premium pages, credits | |
| `data` | The Data menu (import and export) | |
| `pwa` | The installable app: install prompt, install stats. **Off by default** | |

Always there, for every app: sign-in and sign-up (email, Google), users, profile, the
media manager, multilingual pages and the language switcher, the feedback button (it
has its own switch on the Feedback page), notifications, Google Analytics, the email
engine (provider, brand kit, composer, transactional emails, logs, unsubscribe and
preferences), automations, the global message and site-usage banners, the admin and
member dashboards.

## Choosing

In `src/custom/features.ts`:

```ts
// Everything, except the PWA (the file as Arc CMS ships it):
export const CUSTOM_FEATURES: FeatureChoice = {};

// An installable product app with no CMS, no SMS and no signup forms:
export const CUSTOM_FEATURES: FeatureChoice = {
    on: ['pwa'],
    off: ['content', 'sms', 'forms'],
};
```

`off` lists features the app does not have. `on` lists the ones that are off by
default and the app wants, which today is only `pwa` (its name, colours and icon stay
in `src/custom/pwa.ts`).

`npm run dev` and `npm run build` check the file first and stop with a message saying
what to change for:

- a name that is not a feature (a typo must not leave a feature on);
- a feature in both lists;
- a feature whose need is off, such as `off: ['audience']` while `forms` is on:
  turn off `forms` and `email-marketing` too, or keep `audience`.

Saving the file restarts a running `npm run dev` (Vite reads it with `vite.config.ts`).
Each restart used to keep the old server in memory, about 500 MB, until the dev server
stopped with "JavaScript heap out of memory" after a few changes. `vite.config.ts`
now frees it (`releaseClosedServer`). Vite still keeps the very first server, so the
dev server grows once, on the first restart, and then stays level. If it ever stops
out of memory anyway, start it again, or give it more room:

```bash
NODE_OPTIONS=--max-old-space-size=8192 npm run dev
```

## What turning a feature off does

**In the browser**, straight away (a new build, or `npm run dev`):

- Its menu items, settings tabs, dashboard cards and member-area links go.
- Every one of its URLs shows the not-found page, bookmarks and old links included.
- Nothing reads its collections: the menu, dashboard and pages skip those reads.
- Core screens adjust. For example, without SMS the "Email + SMS" menu is "Email" and
  phone sign-in is not offered; without forms and audience the dashboard's Growth &
  Leads shows the users count; without payments members land on a blank dashboard.

**Cloud Functions**, at the next deploy of all the functions:

- The feature's functions are not in the build, so the deploy deletes them from the
  project. `npm run deploy` lists them and asks first; off a terminal it needs `--yes`
  ([deploy.md](deploy.md), "Functions that are deleted").
- Scheduled jobs stop costing money, and the endpoints are closed.
- URLs the outside world holds stop working: a payment webhook registered with Dodo,
  the form links in emails already sent. That is the point of turning it off.
- Code every app keeps skips what belongs to a feature that is off. Without audience,
  for example, an unsubscribe is recorded on the Suppression list only, and email
  still honours it.

**Data, rules and indexes** stay as they are. Turn the feature back on, build and
deploy, and it is all there again.

## An app's own code

- **Menu items** in `src/custom/nav.ts` can set `feature`, and go when it is off.
- **Routes** in `src/custom/routes.ts` can be wrapped: `...whenOn('payments', [...])`
  (from `src/app/core/features/feature-routes.ts`).
- **Components and services** ask `isOn('payments')` (from
  `src/app/core/features/features.ts`).
- **Cloud Functions** in `functions/src/custom/` ask `isFeatureOn('payments')` (from
  `functions/src/feature-flags.ts`).
- **The member dashboard** at `/user/dashboard` is a blank page until the app names its
  own in `src/custom/user-dashboard.ts`.
- **Search**: content is searchable by default; any other collection is named in
  `functions/src/custom/search-sources.ts` and set up in Admin, Settings, Search
  ([search-developer-guide.md](search-developer-guide.md)).

## Adding to Arc CMS itself

Arc CMS keeps every page and function owned by exactly one feature or by core, and
tests fail when something new is not:

| New | Where it is claimed | The test that fails without it |
|---|---|---|
| A page (a route or a `.page.ts`) | `FEATURE_URLS` or `CORE_URLS` in `src/app/core/features/feature-routes.ts`; a route whose URL starts with a parameter goes in `FEATURE_PARAM_ROUTES` and in `whenOn` | `feature-coverage.spec.ts` |
| A menu item | `feature` on the item, matching its page's | `side-navbar.component.spec.ts` |
| A settings tab | `feature` on the tab, matching its page's | `settings.page.spec.ts` |
| A Cloud Function | exported from `functions/src/all.ts` (core) or from `functions/src/features/<id>.ts`; one needing two features goes in `<a>+<b>.ts` | `featureFlags.spec.ts` |
| A feature | `src/app/core/features/feature-registry.ts` and `functions/src/feature-flags.ts` | `featureFlags.spec.ts` checks they agree |

Core code that calls into a feature checks it first, with `isOn` or `isFeatureOn`.

Tests always run with every feature on, whatever an app puts in
`src/custom/features.ts` (the test setup mocks it), so an app that turns features off
can still run the whole suite. A test about a particular choice mocks the file itself.
