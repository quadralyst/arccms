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
| `src/custom/user-dashboard.ts` | the app's own page at `/user/dashboard`, where members land (`CUSTOM_USER_DASHBOARD`); empty shows Arc CMS's blank dashboard |
| `src/custom/i18n/{lang}.json` | the app's translations, laid over the core ones |
| `src/custom/styles.css` | the app's global styles, loaded after every core stylesheet |
| `src/custom/pwa.ts`, `src/custom/pwa-icon.svg` (or `.png`) | the installable app: name, colours, start page, icon ([pwa.md](pwa.md)); it is turned on in `features.ts` |
| `src/custom/features.ts` | the Arc CMS features the app turns off, like `off: ['payments', 'sms']`, or on, like `on: ['pwa']` ([features.md](features.md)) |
| `functions/src/custom/index.ts` | the app's Cloud Functions and triggers |
| `functions/src/custom/public-callables.txt` | the app's callables, checked after every deploy |
| `functions/src/custom/search-sources.ts` | the collections the app makes searchable (`SEARCH_COLLECTIONS`, set up in Admin, Settings, Search) and sources written in code (`CUSTOM_SEARCH_SOURCES`) ([search-developer-guide.md](search-developer-guide.md)) |
| `firestore.app.rules`, `storage.app.rules`, `firestore.app.indexes.json` | the app's security rules and indexes ([app-rules.md](app-rules.md)) |
| `tests/rules/custom/`, `docs/custom/` | the app's rules tests and docs |

Install settings (`src/environments/environment*.ts`, `arc-install.ts`) differ per
install too; `check:core` accepts them.

## 2. The plug points (how core reads the custom space)

| Plug point | Core file | Behaviour |
|---|---|---|
| Routes | `src/app/app.routes.ts` | `CUSTOM_ROUTES` come after every core route (an app page cannot replace a core page by accident) and before the file-based pages |
| Pages | `vite.config.ts` | `additionalPagesDirs: ['/src/custom/pages']` |
| Admin menu | `side-navbar.component.ts` | `CUSTOM_NAV` inserted before Profile; an item with `feature` goes when that feature is off |
| Member dashboard | `app.routes.ts` | `CUSTOM_USER_DASHBOARD` loads at `/user/dashboard` in place of the blank core page |
| Translations | `translation.loader.ts` | `src/custom/i18n/{lang}.json` merged over the core file, key by key: new keys, and rewording of core ones |
| Styles | `index.html` | `src/custom/styles.css` is the last stylesheet |
| PWA | `vite.config.ts`, `pwa.service.ts` | `CUSTOM_PWA` laid over the core defaults at build time; the icon file is found by name |
| Features | `vite.config.ts`, `core/features/features.ts` | `CUSTOM_FEATURES` resolved at build start; a typo or a feature whose need is off stops the build. Every feature is on unless listed in `off`, except the PWA, which is off unless listed in `on` |
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
| Its own pages, menu items, words, styles, app icon | the custom files above |
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

## 4. Core building blocks

The one rule forbids **editing** core files, not using them. App pages import core
components the same way core pages do, and get their look, behaviour, translations
and later fixes for free. These are the ones meant for apps:

| Building block | Import from | For |
|---|---|---|
| `app-global-table` (`GlobalTableComponent`, `TableColumn`) | `src/shared/components/global-table/global-table.component` | any list: columns, sorting, empty and loading states, row actions ([README](../src/shared/components/global-table/README.md)) |
| `arc-row-actions` (`RowActionsComponent`) and `RowAction` | `src/shared/components/row-actions/row-actions.component` and `.../row-actions/row-actions` | the actions of a row in a table or card the app builds itself |
| `arc-page-header` (`PageHeaderComponent`) | `src/shared/components/page-header/page-header.component` | the title row of every admin and user page, with search, language and notifications |

### A list page

`app-global-table` takes the rows and a list of columns. An `actions` column lists
the row's actions and the table lays them out: up to three show as icons; with more,
the first two stay as icons and the rest go into a "more" menu with their labels,
with danger actions (delete, remove, archive, cancel) last. Edit comes first, then
view, open or preview, then the rest in the order given.

```ts
// src/custom/pages/lessons.page.ts
import { Component, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import { GlobalTableComponent, TableColumn } from '../../shared/components/global-table/global-table.component';

@Component({
  standalone: true,
  imports: [PageHeaderComponent, GlobalTableComponent, TranslocoPipe],
  template: `
    <arc-page-header [title]="'custom.lessons.title' | transloco"></arc-page-header>
    <app-global-table [data]="lessons()" [columns]="columns"></app-global-table>
  `,
})
export default class LessonsPage {
  lessons = signal<Lesson[]>([]);
  columns: TableColumn[] = [
    { key: 'title', header: 'custom.lessons.name' },
    {
      key: 'actions', header: 'common.table.actions', type: 'actions',
      actions: [
        { action: 'edit', icon: 'fas fa-pen text-primary', label: 'common.actions.edit', onAction: (l) => this.edit(l) },
        { action: 'preview', icon: 'fas fa-eye', label: 'custom.lessons.preview', onAction: (l) => this.preview(l) },
        { action: 'publish', icon: 'fas fa-upload', label: 'custom.lessons.publish', hide: (l) => l.published, onAction: (l) => this.publish(l) },
        { action: 'delete', icon: 'fas fa-trash text-danger', label: 'common.actions.delete', onAction: (l) => this.remove(l) },
      ],
    },
  ];
  // edit(), preview(), publish(), remove() ...
}
```

Four actions, so Edit and Preview show as icons and Publish and Delete go into the
menu. Headers and labels are translation keys: core ones (`common.actions.*`,
`common.table.*`) work as they are, and the app's own go in
`src/custom/i18n/{lang}.json`. Settings for the rare case the defaults are wrong
(`slot` for actions that never show together, `priority`, `danger`, `placement`,
and `maxInline` on the column) are in the table's README.

### Row actions outside the table

A table or card layout the app builds itself uses `arc-row-actions` for the same
layout. Pass every row on the page as `rows`, so all rows line up:

```html
<arc-row-actions [actions]="rowActions" [row]="lesson" [rows]="lessons()"></arc-row-actions>
```

An action with `onAction` runs it; one without emits `(actionClick)` with
`{ action, row }`.

### When a building block falls short

If the app needs something one of these does not do, it becomes a new option on
the component in Arc CMS, then the app pulls it. Copying the component into the
custom space loses every later fix; editing it in place breaks the next update.

### For Arc CMS: these are a public API

Apps import these components, types and paths directly, so a change to them in Arc
CMS must keep existing apps working: keep the file paths, selectors, exported names
and existing options; add new options as optional ones with defaults that keep
today's behaviour. A change that cannot do that is a breaking change and goes in the
release notes with the steps an app needs to take.

## 5. Pulling Arc CMS updates

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
exits with 1 when there are any, so it can run in CI, and also when there is no
Arc CMS version to compare with (add the `upstream` remote), so it never passes
without checking. A core file moved into the custom space still counts as a core
change. Dependency lists (`package.json`, `functions/package.json`) are reported for
a look but allowed.
