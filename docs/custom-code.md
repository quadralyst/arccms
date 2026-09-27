# Custom code: building an app on a copy of Arc CMS

An app built on Arc CMS starts as a copy (clone) of this repository. Arc CMS stays
generic: it is the base for many apps and holds nothing specific to any of them.
The app's own code lives in a **custom space** that Arc CMS never touches, so the
app can pull Arc CMS updates at any time without merge conflicts.

**The one rule: never edit an Arc CMS (core) file in an app.** If the app needs
something core does not offer, build it in Arc CMS as a general feature (or a new
plug point), then pull it. `npm run check:core` catches accidental edits.

## 1. The two spaces

**Core:** everything Arc CMS ships. The app receives it by pulling updates.

**Custom:** files Arc CMS ships once, empty, and never changes again:

| File | For |
|---|---|
| `src/custom/routes.ts` | the app's pages as Angular routes (`CUSTOM_ROUTES`) |
| `src/custom/pages/` | the app's pages found by file name, like `src/app/pages` (`learn.page.ts` is `/learn`) |
| `src/custom/nav.ts` | the app's items in the admin menu (`CUSTOM_NAV`), shown before Profile |
| `src/custom/i18n/{lang}.json` | the app's translations, laid over the core ones |
| `src/custom/styles.css` | the app's global styles, loaded after every core stylesheet |
| `functions/src/custom/index.ts` | the app's Cloud Functions and triggers |
| `functions/src/custom/public-callables.txt` | the app's callables, checked after every deploy |
| `firestore.app.rules`, `storage.app.rules`, `firestore.app.indexes.json` | the app's security rules and indexes ([app-rules.md](app-rules.md)) |
| `tests/rules/custom/`, `docs/custom/` | the app's rules tests and docs |

Install settings (`src/environments/environment*.ts`, `arc-install.ts`) differ per
install too; `check:core` accepts them.

## 2. The plug points (how core reads the custom space)

| Plug point | Core file | Behaviour |
|---|---|---|
| Routes | `src/app/app.routes.ts` | `CUSTOM_ROUTES` come after every core route (an app page cannot replace a core page by accident) and before the file-based pages |
| Pages | `vite.config.ts` | `additionalPagesDirs: ['/src/custom/pages']` |
| Admin menu | `side-navbar.component.ts` | `CUSTOM_NAV` inserted before Profile |
| Translations | `translation.loader.ts` | `src/custom/i18n/{lang}.json` merged over the core file, key by key: new keys, and rewording of core ones |
| Styles | `index.html` | `src/custom/styles.css` is the last stylesheet |
| Functions | `functions/src/all.ts` | `export * as custom from './custom/index.js'` |

### Examples

```ts
// src/custom/routes.ts
export const CUSTOM_ROUTES: Routes = [
  { path: 'learn', loadComponent: () => import('./pages/learn.page').then((m) => m.default) },
];
```

```ts
// src/custom/nav.ts
export const CUSTOM_NAV: MenuItem[] = [
  { label: 'Lessons', labelKey: 'custom.nav.lessons', route: '/admin/lessons', icon: 'fa-solid fa-book-open',
    allowRoles: ['admin'] },
];
```

```json
// src/custom/i18n/en.json (hi.json needs the same keys; a test checks)
{ "custom": { "nav": { "lessons": "Lessons" } }, "admin": { "nav": { "users": "Parents" } } }
```

```ts
// functions/src/custom/index.ts
export * from './awardStar.js';
```

```ts
// functions/src/custom/awardStar.ts
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { db } from '../init.js';
import { arcDocument } from '../arc-config.js';

export const onLessonDone = onDocumentCreated(
  arcDocument('users/{userDocId}/children/{childId}/progress/{lessonId}'),
  async (event) => { /* ... */ },
);
```

It deploys as `arccms-custom-onLessonDone`. Deploy one function with
`npm run deploy -- --only functions:arccms:arccms.custom.onLessonDone --project <alias>`.
A browser calls an app callable with `arcCallable(functions, 'custom-<name>')`; list
it in `public-callables.txt` so the post-deploy check covers it.

The same checks hold custom code to core's standards: every Firestore trigger uses
`arcDocument()`, nothing opens its own database connection (use `db` from `init.ts`).

## 3. Where each kind of change goes

| The app needs | Use |
|---|---|
| Its own pages, menu items, words, styles | the custom files above |
| Its own functions and triggers | `functions/src/custom/` |
| Its own data per person | under `users/{userDocId}/...` ([account-contract.md](account-contract.md)) |
| Rules and indexes for its data | `*.app.rules`, `firestore.app.indexes.json` ([app-rules.md](app-rules.md)) |
| To react when someone signs up, is deleted, pays | core events (below) |
| To react to its own collections | its own triggers |
| To react to a core collection | its own trigger, following the four rules below |
| To change what core does or shows | a core setting or plug point, built in Arc CMS and pulled |

### Core events: the preferred hook for a person's lifecycle

Core writes an `AppEvents` document when something happens to a person, once its
own work is done: `user.signed_up`, `user.deleted`, payment events, and `app_user.*`.
An app reacts with its own trigger on `AppEvents/{id}`, checking `type`:

```ts
export const onSignedUp = onDocumentCreated(arcDocument('AppEvents/{id}'), async (event) => {
  const e = event.data?.data();
  if (e?.['type'] !== 'user.signed_up') return;
  // create the new parent's starter data under users/{userDocId}/...
});
```

### A second trigger on a core collection: four rules

Firebase runs every function watching a path, so an app trigger on, say,
`users/{id}` runs next to core's. It is safe when:

1. **It assumes no order.** Core's trigger on the same write may not have finished
   (claims, welcome email). If the app needs core's result, react to that result or
   to a core event instead.
2. **It writes only its own fields**, better its own subcollections. Two triggers
   editing the same fields can fight or loop. Never write core fields.
3. **It can run twice.** Firebase may deliver an event more than once; make the work
   safe to repeat.
4. **It returns at once when the change does not concern it**, since every write
   now runs both.

A second trigger cannot change or stop what core's trigger does (for example, "no
welcome email in this app"). That needs a core setting or plug point.

## 4. Pulling Arc CMS updates

Once, in the app's repository:

```bash
git remote add upstream git@github.com:quadralyst/arccms.git
git fetch upstream
```

Then, whenever Arc CMS has updates:

```bash
npm run check:core
git fetch upstream
git merge upstream/main
npm install && npm install --prefix functions
npm run test
```

`npm run check:core` lists every core file the app changed compared with the Arc CMS
version it is based on (`--against upstream/dev` to compare with another branch). It
exits with 1 when there are any, so it can run in CI. Dependency lists
(`package.json`, `functions/package.json`) are reported for a look but allowed.
