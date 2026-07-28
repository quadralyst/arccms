# Working with languages in ArcCMS

A developer's guide to the two translation systems in this codebase: how each
one works, how to add a language, and how to write new code that fits.

Read the section you need — they are independent.

| | **Public site** | **Admin UI** |
|---|---|---|
| Who reads it | Site visitors | The people running the site |
| What it translates | Content, and the chrome around it | Buttons, labels, menus, messages |
| Language list lives in | Firestore, `Settings/localization` | Code, `ADMIN_LANGUAGES` |
| Chosen by | The visitor, via the URL | The admin, via the picker |
| Mechanism | `data-arc-t` + `strings.json`, plus per-language files | Transloco |
| Emails | **Never translated.** English only, by product decision. | |

These two lists are deliberately independent. A site publishing in Hindi can be
run by someone who reads English, and enabling a content language must not
half-translate the admin.

---

# Part 1 — The public site

## 1.1 The four kinds of text on a public page

A published page is assembled from four sources, and each is translated
differently. Knowing which one you are touching tells you what to do.

| Kind | Example | Lives in | Translated by |
|---|---|---|---|
| **Content** | An article's title and body | Firestore | The author, in the content editor |
| **Content-type text** | "Articles", the list subtitle | Firestore, on the type | The admin, in the content-type editor |
| **Template/partial chrome** | "Read Article", "min read" | `public/templates/`, `public/_partials/` | `data-arc-t` + `strings.json` |
| **Whole prose pages** | The home page | `public/i18n/{lang}/index.html` | A full translated copy |

## 1.2 URLs

The default language keeps every existing URL. Every other language gets a
prefix:

```
/articles/my-post          ← default language
/hi/articles/my-post       ← Hindi
```

The slug is identical across languages. The URL is the only source of truth for
which language a page is in — there is no cookie or stored preference that
changes what a URL serves.

## 1.3 How content translation works

Translations are a **sibling subcollection**, never a change to the document:

```
arc_articles/{id}                      ← the default language, untouched
arc_articles/{id}/translations/hi      ← only the fields that differ
```

Rendering is `{...baseDoc, ...translationDoc}` — anything untranslated falls
back to the default language automatically. That is why a half-translated site
always works.

Only `text` and `richtext` fields are translatable. Numbers, dates, booleans,
images and dropdown *values* are shared: they are the same fact in every
language.

**Untranslated items still appear** in list pages, showing their default-language
card. A half-empty list reads as a broken site.

## 1.4 Static chrome — `data-arc-t`

For short, structural text in `public/templates/**` and `public/_partials/**`,
annotate the element and leave the English inside it:

```html
<span data-arc-t="read_more">Read Article</span>
```

Then add the key to each language file:

```jsonc
// public/i18n/hi/strings.json
{ "read_more": "लेख पढ़ें" }
```

The English inside the element is the fallback. A key that is missing — or set
to an empty string — leaves that English in place, so templates stay readable,
previewable English documents.

Values may contain `{{ }}` interpolations, because strings are applied *before*
the template is hydrated:

```json
{ "back_to": "वापस {{ contentType }} पर" }
```

### The three annotations

All three work everywhere — in `public/templates/**`, in the two shared partials,
on published pages and in the SPA. You do not need to know which renderer will
handle your file.

| Annotation | What it does |
|---|---|
| `data-arc-t="key"` | Replaces the element's text |
| `data-arc-t-attr="placeholder:key"` | Replaces an attribute. Comma-separate for several: `"placeholder:a,title:b"` |
| `data-arc-t-params='{"count": 5}'` | Fills `{{ }}` tokens in the translated string |

In an Angular template, params are a binding rather than JSON:

```html
<span data-arc-t="min_read" [data-arc-t-params]="{ count: readTime }">5 min read</span>
```

The authored English is always the fallback, for attributes as much as text. An
unknown `{{ token }}` is left visible rather than becoming a silent gap, and a
malformed params attribute degrades to the authored English rather than
aborting a publish.

`annotation-parity.spec.ts` holds the three renderers to identical behaviour —
if you extend the annotations, extend that spec too.

> Strings are cached for five minutes per Cloud Function instance, so a freshly
> deployed `strings.json` can take that long to reach newly published pages.

## 1.5 Whole prose pages — the home page

The home page is long prose with inline formatting, where per-key strings cannot
express word order. It is translated as a **whole document** instead:

```
public/index.html            ← default language
public/i18n/hi/index.html    ← the Hindi translation
```

Keep the `<!-- arc-source-version: N -->` marker in step between them. When the
English page's structure changes, bump its version and update each translation;
the mismatch is what makes drift visible instead of silent.

## 1.6 Links must carry the language

The header and footer partials are **one file shared by every language**, so
their links are written root-relative (`/articles`) and are rewritten at render
time. Both sides use the same rule:

- Published pages: `prefixAnchorHrefs` in `functions/src/shared/language-links.ts`
- The SPA: `LangHrefDirective`, imported by `HeaderComponent` and `FooterComponent`

**If you write a new component that links to a public page, add the prefix
yourself** — the directive only covers the shared partials:

```ts
itemUrl(slug: string): string {
    const prefix = this.pageLang() ? `/${this.pageLang()}` : '';
    return `${prefix}/${this.contentTypeSlug()}/${slug}`;
}
```

Content templates already do this via `{{ langPrefix }}` and `{{ url }}`.

## 1.7 The language switcher only offers real pages

`LocalizationService.languageVariants` holds the languages **this page** exists
in — not the ones enabled site-wide. A page declares its own while it is on
screen:

```ts
// A page that exists in a known set of languages
this.localization.languageVariants.set(HOME_PAGE_LANGUAGES);
// ...and clears it on the way out
this.localization.languageVariants.set(null);
```

Set this on any new public page type. Leaving it unset hides the switcher, which
is safe; setting it wrongly offers a link that 404s.

---

## 1.8 Checklist: adding a public language

Say you are adding French (`fr`).

1. **Enable it.** Admin → Settings → Localization → Add a language. This writes
   `Settings/localization` and is all that is needed for *content* translation —
   the editor immediately offers a French tab.
2. **Translate the chrome.** Create `public/i18n/fr/strings.json`. Copy
   `public/i18n/hi/strings.json` as the key list and translate the values. A
   partial file is fine; missing keys stay English.
3. **Translate the content-type names.** Admin → Content types → edit each type
   → the French tab. Name, singular name, description, and custom field labels.
4. **Translate the home page** *(optional — skip and the switcher just will not
   offer French there)*:
   - `public/i18n/fr/index.html` — a full translation of `public/index.html`,
     keeping the `arc-source-version` marker.
   - A component in `src/app/pages/home-i18n/`, copying `home.hi.component.ts`
     and changing `pageLang`, `templateUrl`, `pageTitle`, `pageDescription`.
   - Add `'fr'` to `HOME_PAGE_LANGUAGES` in
     `src/app/pages/page.parts/home-base.component.ts`.
   - Add a route `{ path: 'fr', ... }` in `src/app/app.routes.ts` — **before**
     the `canMatch: [languageRouteGuard]` routes.
   - Add `'/fr'` to `prerender.routes` in `vite.config.ts`.
   - Register the locale in `src/app/core/i18n/admin-locale.provider.ts` if you
     also want it as an admin language (see Part 2).
5. **Translate the content.** Open each item in the editor, pick the French tab,
   fill in what matters. Publish.
6. **Deploy** hosting and functions, then **republish the content** — static
   pages are built at publish time, so existing pages do not gain a French
   variant until they are republished.

Steps 4's last three items are hand-maintained on purpose: the enabled-language
list is runtime data, but prerendering is decided at build time and only a real
file can be prerendered. Enabling a language does not conjure a home page.

## 1.9 Writing a new public page or feature

- **Never concatenate translated fragments.** One key per sentence, with
  `{{ params }}`, so a translator can reorder.
- **Take the language from the route** (`:lang` param) where there is one, or
  from `UiStringsService.activeLang()` where there is not (the home page and
  anything it embeds have no `:lang` param).
- **Prefix every internal link** with the page's language (§1.6).
- **Declare `languageVariants`** if the page can exist in more than one language
  (§1.7).
- **Set `<html lang>`, the title and the description** from the page's language.
  `HomeBaseComponent` shows the pattern, including restoring the shell's value on
  destroy so the next SPA route is not mislabelled.
- **Mirror anything the publish pipeline also needs.** `functions/src/shared/`
  holds server copies of `template-hydration`, `content-translation`,
  `content-type-names` and `language-links`. If you change the rule on one side,
  change it on the other and add it to the mirror test in
  `content-types.model.spec.ts` — a statically published page and its SPA
  fallback are the same page and must render identically.

---

# Part 2 — The admin UI

## 2.1 The mechanism

[Transloco](https://jsverse.github.io/transloco/), configured in
`src/app/app.config.ts`. Translations are JSON:

```
src/assets/i18n/en.json     ← the source language; every key lives here first
src/assets/i18n/hi.json     ← a translation of that file
```

They are **imported, not fetched** (`src/app/core/i18n/translation.loader.ts`),
so the server render has the same strings the browser will — no flash of
untranslated text.

A key missing from a translation silently falls back to English. This is what
makes partial coverage shippable: a half-translated admin reads as
half-translated, not broken.

## 2.2 Key conventions

Documented at the top of `en.json` and repeated here:

```
common.*                 reused everywhere — actions, table chrome, statuses,
                         validation, the paginator
admin.nav.*              the side navigation
admin.<area>.*           one page or feature area, named after its route:
                         admin.settings.*, admin.contents.*, admin.users.*
```

**Keys describe the string's role, not its text.** `common.actions.save`, not
`common.actions.save_changes` — renaming the English should never mean renaming
the key.

Before inventing a key, check whether `common.*` already has it. "Save",
"Cancel", "Delete", "Name", "Status", "Actions", "Loading…" and the "Showing N
to M of T records" footer are all there. Autocomplete helps: `TranslationKey`
lists every key that exists.

### After editing en.json

```bash
npm run i18n:keys
```

This regenerates `src/app/core/i18n/translation-keys.ts` — the `TranslationKey`
union that types `notify.*`, `t()` and `isTranslationKey`. Forgetting to run it
fails `i18n-parity.spec.ts`, which also fails if a translation is missing a key,
has invented one, or if `ADMIN_LANGUAGES` offers a language with no JSON file.

## 2.3 How to translate each kind of string

**In a template** — the pipe:

```html
<h1>{{ 'admin.users.page_title' | transloco }}</h1>
<p>{{ 'admin.users.greeting' | transloco: { name: user.name } }}</p>
<input [placeholder]="'common.actions.search' | transloco">
```

Add `TranslocoPipe` to the component's `imports`.

**In TypeScript** — `this.t()` on `BaseComponent`, whose key is type-checked:

```ts
this.t('admin.contents.types.slug_exists', { slug });
```

Use `this.transloco.translate()` directly only for a key computed at runtime —
one built from a record's id, say — where a type cannot help.

**A toast** — `NotifyService`, provided by `BaseComponent` as `this.notify`:

```ts
this.notify.success('admin.contents.list.deleted');
this.notify.error('admin.contents.list.delete_failed', { title: item.title });
this.notify.raw(serverMessage, 'error');   // text that is not ours to translate
```

Do not call `toastService` directly for our own messages — it takes a finished
string, which is how every call site ended up with a hardcoded English sentence.

**A confirmation dialog** — pass `titleKey` alongside the existing `dialogType`:

```ts
this.dialog.open(ConfirmationPopupComponent, {
    data: {
        dialogType: 'Delete',                 // discriminator, stays English
        titleKey: 'common.dialog.delete',     // what the heading shows
        dialogMessage: this.sanitizer.bypassSecurityTrustHtml(
            this.transloco.translate('common.actions.delete_confirm', { name }),
        ),
        btnText: this.transloco.translate('common.actions.delete'),
        panelType: 'warn',
    },
});
```

**Form validation** — nothing to do. `getFormErrors` on `BaseComponent` is
already translated, so every form gets it.

## 2.4 Tables: pass keys, not translations

`GlobalTableComponent` resolves column headings and action labels itself. Give
it the **key**:

```ts
tableColumns: TableColumn[] = [
    { key: 'title',  header: 'admin.contents.list.col_title' },
    { key: 'status', header: 'common.table.status', type: 'badge' },
    { key: 'actions', header: 'common.table.actions', type: 'actions',
      actions: [{ action: 'edit', label: 'common.actions.edit', ... }] },
];
```

**Do not call `translate()` when defining columns.** Column definitions are field
initialisers, which run before the translation file has loaded, so `translate()`
returns the key you handed it and the heading renders as
`ADMIN.CONTENTS.LIST.COL_TITLE`. Passing the key also means a language switch
updates the headings without the page rebuilding its columns.

`header` and `label` accept **either a key or literal text**, because a column
can also come from a content type's custom field, whose label is data. The table
resolves them with `| translatable`, which translates a known key and prints
anything else unchanged — the same rule as `data-arc-t`. Reach for that pipe
anywhere you have a field that could hold either.

For a cell value computed per row, `transformFn` / `textFn` / `titleFn` run at
render time, so `translate()` is correct there:

```ts
transformFn: (row) => this.transloco.translate('admin.x.count', { n: row.n }),
```

## 2.5 CMS data is not UI

Content-type names, signup form names, user names and tag names are **data**.
They are not in `en.json` and never will be.

Content types are the one exception, because the admin already translated them
for the public site. Use the helper, which falls back to the authored name:

```ts
contentTypeName(type, this.adminLang())          // "लेख" or "Articles"
contentTypeSingularName(type, this.adminLang())
contentTypeDescription(type, this.adminLang())
```

Applied in the sidebar and the content list heading. Deliberately **not** in the
content-types management table, whose Name column is the `name` field you edit in
the drawer beside it.

---

## 2.6 Checklist: adding an admin language

1. Create `src/assets/i18n/fr.json`. Copy `en.json`, drop `_conventions`,
   translate the values. Partial is fine.
2. Add it to `ADMIN_LANGUAGES` in `src/app/core/i18n/admin-languages.ts`:
   ```ts
   { code: 'fr', label: 'Français' },
   ```
3. Add the import to `TRANSLATIONS` in `src/app/core/i18n/translation.loader.ts`
   — written out, not built from a template string, because a bundler can only
   follow an import it can see.
4. Register the locale data in `src/app/core/i18n/admin-locale.provider.ts` so
   dates and numbers format correctly:
   ```ts
   import localeFr from '@angular/common/locales/fr';
   registerLocaleData(localeFr, 'fr');
   ```
5. Nothing else. The picker, the preference and the paginator pick it up.

`i18n-parity.spec.ts` enforces the rest: it fails if any translation is missing
a key, if one invents a key with no English source, or if a language in
`ADMIN_LANGUAGES` has no JSON file. Run `npm run i18n:keys` after adding the
file so the generated union includes nothing stale.

## 2.7 Writing a new admin page

1. Add `TranslocoPipe` to the component's `imports`.
2. Put every visible string in `en.json` under `admin.<area>.*`, reusing
   `common.*` wherever it fits, and add the same keys to every translation.
   Then run `npm run i18n:keys`.
3. Table columns and action labels: pass keys (§2.4).
4. Toasts: `this.notify.*` (§2.3).
5. Dialogs: pass `titleKey` (§2.3).
6. If a spec does `overrideComponent(..., { set: { imports: [] } })` to keep
   Angular Material out of the way, **keep `TranslocoPipe` in that array**.
   `NO_ERRORS_SCHEMA` covers an unknown element but not an unknown *pipe* — the
   template will fail to render entirely.

Specs need no other setup: `src/test/setup.ts` gives every TestBed the real
translations. To render a spec in another language:

```ts
imports: [MyComponent, translocoTestingModule({ lang: 'hi' })]
```

---

# Part 3 — Traps

Every one of these cost real debugging time.

**Table headings render as `SCREAMING.KEY.NAMES`.** You called `translate()` in a
field initialiser. Pass the key instead (§2.4).

**"X is not used within the template of Y" at build time.** You edited the wrong
template. Check `templateUrl` — there may be more than one HTML file in the
folder and only one of them is live.

**A translated page linking back to English.** A link that is not in a content
template needs the language prefix added by hand (§1.6).

**A key that renders as `ADMIN.FOO.BAR`.** A typo. In TypeScript, use
`this.t('…')` (or `injectT()` in a class that does not extend `BaseComponent`)
and the compiler catches it; in a template `| transloco` is unchecked, so the
parity spec is the backstop.

**A sweep that looks finished and is not.** Searching for `>text<` misses any
string wrapped across lines, which is most long sentences in this codebase.
Match whitespace-insensitively, and look at the page in the second language
before calling it done.

**A deployed page still in English.** Static pages are built at publish time.
Deploying is not republishing.

**Verify by content, never by HTTP status.** The SPA fallback returns 200 for
any path, including ones whose static page was wiped. `curl | grep` for text you
expect.

**`vitest` does not typecheck, and `tsc --noEmit` does not check templates.** The
three checks are separate:

```bash
npx vitest run                          # behaviour
npx tsc -p tsconfig.app.json --noEmit   # TypeScript
npm run build                           # templates
```

---

# Part 4 — What is not translated yet

Honest state of play, so you know what you are walking into.

**Swept:** the admin shell and navigation, all ten settings pages, the dashboard,
content types (list + add/edit drawers), the content editor, the draft list, users,
Contacts/Lists/Tags/Fields, media, the data wizards, products, transactions, the
shared table, the confirmation dialog, validation messages, the paginator — and the
whole signed-in user area.

**Not swept:** waitlists, the email areas (composer, broadcasts, drips,
announcements, brand kit, logs), and most feature-specific drawers and dialogs.
These read English inside a translated shell, which is the fallback working.

One judgement worth repeating from the dashboard: Google Analytics metric names
(`Sessions`, `Bounce Rate`, …) are left exactly as the API returns them. They are
lookup keys for the icon and colour map, so translating them would break the
lookup — and they are GA's vocabulary, not ours.

**The signed-in user area is swept**, under `user.*` keys. It has its own shell
(`user-shell.component.ts`) with its own nav — it does not use the admin
`arc-side-navbar` — so its strings live beside it rather than under `admin.nav.*`.

One naming wrinkle: the service behind the picker is `AdminLanguageService` and
its constant `ADMIN_LANGUAGES`, but both now serve the user area too. Read them
as "the UI language of whoever is signed in".

**Date and number pipes** follow the admin language from the *next* page load,
not immediately. Angular resolves `LOCALE_ID` once at bootstrap and the built-in
pipes capture it when constructed; the cached preference is what makes that next
load correct. See `admin-locale.provider.ts`.

**The public site does not remember a visitor's language.** Landing on `/` gives
the default language even if they read Hindi yesterday. The switcher writes
`arc-lang` to localStorage and nothing reads it — deliberate, because `/` is
prerendered and a client-side redirect would flash the default language first.

**Emails are English, permanently.** A product decision, not a gap.

---

# Reference

| What | Where |
|---|---|
| Public language registry | `Settings/localization` (Firestore) |
| Public static strings | `public/i18n/{lang}/strings.json` |
| Translated home pages | `public/i18n/{lang}/index.html` + `src/app/pages/home-i18n/` |
| Public switcher | `src/app/pages/page.parts/language-switcher.component.ts` |
| Link prefixing | `src/app/core/utils/language-links.ts` (+ server mirror) |
| Admin language list | `src/app/core/i18n/admin-languages.ts` |
| Admin translations | `src/assets/i18n/{lang}.json` |
| Admin loader | `src/app/core/i18n/translation.loader.ts` |
| Admin preference | `src/app/core/i18n/admin-language.service.ts` |
| Translated toasts | `src/shared/services/notify.service.ts` |
| Spec setup | `src/test/setup.ts`, `src/test/transloco-test-providers.ts` |
| Key generator | `scripts/generate-i18n-keys.mjs` → `npm run i18n:keys` |
| Generated key union | `src/app/core/i18n/translation-keys.ts` |
| Key-or-text pipe | `src/app/core/i18n/translatable.pipe.ts` |
| Drift tests | `src/test/i18n-parity.spec.ts`, `src/app/core/i18n/annotation-parity.spec.ts` |
| Server mirrors | `functions/src/shared/` |
| Design decisions | `docs/multilingual-spec.md` §0 |
