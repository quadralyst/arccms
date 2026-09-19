# Arc CMS Search: Developer Guide

How to make any Firestore collection searchable from the same search box,
callable and index that content uses. Read this when you are building a
directory, a catalogue, a member list, or anything else people should be
able to find by typing a few letters.

Companion documents: `docs/search-spec.md` (the design and its decisions) and
`functions/src/search/sources/_template.ts` (a source file to copy).

---

## 1. How search works, in one minute

```
your collection ──▶ SearchSource (config) ──▶ SearchIndex (one small doc per
                                              document per language)
                                                     │
search box ──▶ `search` callable ──▶ Firestore token query ──▶ ranking ──▶ results
```

- The **engine** is generic. It tokenizes text, writes index entries, answers
  queries, ranks candidates and highlights matches. It never changes when a
  collection is added.
- A **source** is a small config object that tells the engine which
  collection to watch, which fields to index, who may search it, and what a
  hit looks like. Content types are the first two sources (`content` and
  `content-drafts`); yours will be the next.
- The index lives in one Firestore collection, `SearchIndex`, which clients
  cannot read. Every query goes through the `search` callable, which enforces
  the source's scope before reading anything.
- Index entries are written three ways: automatically by a wildcard Firestore
  trigger when a document in a registered collection changes, explicitly by
  your own Cloud Function code, and in bulk by the reindex tool in
  Admin, Settings, Search.

What search is good at: short fields such as names, titles, taglines, SKUs,
cities. Type-ahead ("kar" finds "Karun"), any word order, accents and case
ignored, a typo fallback, ranking that puts title hits above summary hits.

What it is not: full-text search over long prose, substring matching in the
middle of words, stemming, synonyms. Keep indexed fields short.

## 2. Adding a source: the whole procedure

Time: under an hour the first time, ten minutes after that.

### Step 1. Write the source file

Copy `functions/src/search/sources/_template.ts` to
`functions/src/search/sources/<your-source>.ts` and fill it in. Here is a
worked example for a `Directory` collection whose documents look like
`{ name, tagline, city, slug, status, createdAt }`:

```ts
// functions/src/search/sources/directory.ts
import type { SearchSource } from '../source.js';

export const directorySource: SearchSource = {
    id: 'directory',
    collection: 'Directory',
    scope: 'public',
    fields: [
        { path: 'name', weight: 3, prefix: true },
        { path: 'tagline', weight: 2, prefix: true },
        { path: 'city', weight: 1 },
    ],
    display: (doc) => ({
        title: String(doc['name'] ?? ''),
        snippet: String(doc['tagline'] ?? ''),
        badge: 'Directory',
        link: `/directory/${String(doc['slug'] ?? '')}`,
        meta: { city: doc['city'] },
        sortAt: doc['createdAt'],
    }),
    include: (doc) => doc['status'] === 'active',
};
```

### Step 2. Register it

Add one import and one array entry in `functions/src/search/registry.ts`:

```ts
import { directorySource } from './sources/directory.js';

export const SEARCH_SOURCES: readonly SearchSource[] = [
    contentSource,
    contentDraftsSource,
    directorySource,
];
```

### Step 3. Give the admin page a label (optional)

`src/shared/models/search.model.ts` has `KNOWN_SEARCH_SOURCES`, which only
supplies labels for Admin, Settings, Search. Add a row and the two
translation keys (`src/assets/i18n/en.json` and `hi.json`, then
`npm run i18n:keys`). A source missing from this list still appears on the
page, labelled by its id.

### Step 4. Deploy and reindex

```bash
cd functions && npm run build && firebase deploy --project default --only functions --non-interactive --force
```

Then open Admin, Settings, Search and press **Rebuild** on your source. From
now on the wildcard trigger keeps it current as documents change.

### Step 5. Put a search box on a page

In any Angular page:

```html
<arc-search-box
    scope="public"
    [sources]="['directory']"
    resultsUrl="/directory/search"
    navigation="router"
    placeholder="Search the directory"
    (picked)="onPicked($event)"></arc-search-box>
```

Import `SearchBoxComponent` from `src/shared/components/search-box/`. The
inputs are documented on the component; the useful ones are:

| Input | Meaning |
|---|---|
| `scope` | `public`, `authenticated` or `admin`. Must be at least the scope of every source named. |
| `sources` | Limit to these source ids. Omit to search everything the scope may read. |
| `lang` | The language being viewed. Omit for language-neutral sources. `all` searches every language and folds a document's variants into one row. |
| `resultsUrl` | Where Enter goes, with `?q=` appended. Omit to disable. |
| `navigation` | `router` for SPA routes, `location` for static pages, `none` to handle `(picked)` yourself. |
| `hotkey` | Cmd+K / Ctrl+K focuses the box. |

To call the function without the component, inject `SearchService` from
`src/app/core/services/search.service.ts` and call
`search({ q, lang, scope, sources, limit })`. It returns
`{ results, tookMs, fallbackUsed? }` where each result has `title`,
`snippet`, `badge`, `link`, `meta`, `score` and `highlights` (character
ranges in `title` and `snippet` to bold).

That is the whole integration.

## 3. The `SearchSource` interface, field by field

Defined in `functions/src/search/source.ts`.

| Field | Required | What it does |
|---|---|---|
| `id` | yes | Stable identifier. Part of every index document ID, so renaming it means a reindex. |
| `collection` | yes | A collection name, or a `RegExp` matching a family of top-level collections such as `/^arc_(.+)_drafts$/`. Subcollections are not supported. |
| `scope` | yes | Who may search this source. See section 5. |
| `fields` | yes | The fields to index, each `{ path, weight, prefix? }`. Or a function `(doc, ctx) => specs` when the fields depend on the document. Dotted paths reach into maps: `address.city`. Arrays of strings are joined. |
| `display` | yes | `(doc, ctx, lang) => { title, snippet?, badge?, link, meta?, sortAt? }`. What a hit shows and where it goes. See section 4. |
| `include` | no | `(doc, ctx) => boolean`. Return false to keep a document out. Default: index everything. |
| `lang` | no | `(doc, ctx) => string`. The document's language when each carries one. Default `*`, meaning language-neutral. |
| `variants` | no | `(doc, ctx) => Promise<{ lang, doc }[]>`. For multilingual sources: one entry per language. Each variant's `doc` is what `fields` and `display` see. The content sources use it to merge translations. |
| `boost` | no | Multiplier on the final score. `1.5` ranks this source above others on equal matches. Default 1. |
| `trigger` | no | Set `false` to keep the wildcard trigger off this source, when your own Cloud Function writes the collection and indexes it explicitly. Default true. |
| `expandCollections` | no | `() => Promise<string[]>`. For a `RegExp` source, the collections to walk during a reindex. Default: list the database and match. |

`ctx` (`SearchContext`) carries `collection`, `docId`, `localization`
(the site's language settings) and `contentTypes` (a map by slug), loaded
once and cached, so a source never fetches settings itself.

### Choosing weights and prefixes

- The field a person is most likely to be typing gets the highest weight
  and `prefix: true`. Names and titles: 3. A one-line description: 2.
  Everything else: 1.
- `prefix: true` is what makes type-ahead work. It costs roughly ten tokens
  per word, so use it on short fields only. A field with `prefix` off still
  matches whole words.
- Weights only matter relative to each other, and across sources: a
  directory name at weight 3 and an article title at weight 3 tie when both
  match a whole word. Use `boost` to break that tie deliberately.

Limits: 600 tokens per entry (title fields are tokenized first, so the cap
trims later fields), 80 words per field, prefixes from 2 to 12 characters,
10 query tokens, 5 sources per call, 50 candidates per query before ranking.

## 4. The `display` mapping

`display` returns everything a hit shows. The rule that matters:

> **The client sees all of it.** `title`, `snippet`, `badge`, `link` and
> `meta` are sent to whoever ran the search. Never put a private field in
> `meta` because it seemed handy. A public source's `display` must be safe
> to show a stranger; an admin source's must be safe to show any admin.

- `title`: the line people click. Plain text; HTML is stripped.
- `snippet`: one line under the title, trimmed to 200 characters.
- `badge`: a short label beside the title. Content uses the type name; a
  catalogue might use the price.
- `link`: where the click goes. Root-relative (`/directory/acme`). For
  content it carries the language prefix (`/hi/articles/slug`).
- `meta`: anything else the client may want, such as an id or a category.
- `sortAt`: a Date or Firestore Timestamp. Candidates are read newest first
  and ties in the ranking break on it. Falls back to the time of indexing.

`display` is called once per language variant with that language's `doc`,
so a translated title comes out translated.

## 5. Scopes

Each source declares who may search it, and the callable enforces it
before reading anything:

| Source scope | Reachable by request scope |
|---|---|
| `public` | `public`, `authenticated`, `admin` |
| `authenticated` | `authenticated` (any signed-in user), `admin` |
| `admin` | `admin` (signed in with the admin role) |

A request that names a source outside its scope is refused with
`permission-denied`, not silently trimmed, so a misconfigured search box
fails loudly. A request with no `sources` searches every source its scope
may read.

Two sources may watch the same collection under different ids, for example
a `public` one indexing two fields and an `admin` one indexing six. Their
entries never collide because the source id is part of the entry id.

## 6. Keeping the index current

**Automatic.** `onAnyDocumentWritten` fires for every top-level document
write in the database. It looks the collection up in the registry and
returns at once for anything unregistered. For a registered collection it
rebuilds that document's entries: creates and updates upsert, deletes
remove, and a document that `include` now rejects is removed too.
Translation subcollections (`{collection}/{id}/translations/{lang}`)
re-index their parent.

**Explicit.** When your own Cloud Function writes the data, index it in the
same operation so a failure is logged beside the write:

```ts
import { buildSearchContext } from '../search/context.js';
import { indexDocument, removeSearchEntries } from '../search/writer.js';
import { directorySource } from '../search/sources/directory.js';

const ctx = await buildSearchContext('Directory', docId);
await indexDocument(directorySource, docData, ctx);      // upsert every language entry
await removeSearchEntries('directory', 'Directory', docId); // on delete
```

Set `trigger: false` on the source if you do this, or the trigger will
index the same write a second time (harmless, but wasted).

**Reindex.** Admin, Settings, Search rebuilds one source or all of them:
every entry is rewritten and every entry whose document is gone is deleted.
Run it after adding a source, after changing its `fields` or `display`, and
whenever results look wrong. The `reindexSearch` callable takes
`{ source?, collection? }`; the content type editor calls it with a
collection when an admin changes a type's searchable fields.

## 7. Languages

- A source whose documents are language-neutral (most of them) leaves
  `lang` and `variants` alone. Its entries carry `lang: '*'` and appear in
  every language's results.
- A source whose documents each carry a language sets `lang: doc =>
  doc.lang`. Its entries only appear when that language is searched.
- A source with per-language variants of one document sets `variants`.
  See `contentVariants` in `sources/content-fields.ts` for the pattern:
  the default language from the base document, then each translation
  merged over it so untranslated fields index the fallback text.
- The callable takes `lang` from the request: the language being viewed on
  the public site, or `all` in the admin, which searches every language
  and shows each document once.

## 8. Ranking, so you can predict results

For each query token, the best match across the entry's fields counts:
a whole word scores 1.0 times the field weight, a prefix 0.6 times. Then:

1. A constant bonus when every query token matched.
2. A phrase bonus when the whole normalized query appears in the title.
3. A small coverage term, matched tokens over title words, so a short
   fully matched title beats a long partly matched one.
4. Multiply by the source's `boost`. Ties break on `sortAt`, newest first.

When nothing matches, the shortest query token of four or more characters
is shortened by one character and the search retried, twice at most. The
response says so in `fallbackUsed` and the UI shows "Showing results for".

The tokenizer lowercases, folds Latin accents only (Devanagari and other
scripts keep their marks), removes apostrophes rather than splitting on
them, turns other punctuation into spaces, and drops a short English stop
list. It is the same code on both sides, in
`functions/src/search/tokenizer.ts`.

## 9. Checklist before you ship a source

- [ ] `display` returns nothing private.
- [ ] `include` keeps out documents that have no page to link to.
- [ ] `link` is root-relative and correct for every language the source has.
- [ ] Fields are short; nothing rich-text or paragraph-length is indexed.
- [ ] The source is registered and deployed, and a reindex has run.
- [ ] A search box or `SearchService` call names the source with a scope
      that can reach it.
- [ ] Tests: a source is plain data, so a spec can call `buildEntries`
      from `functions/src/search/writer.ts` with a fixture document and
      assert on the tokens and display. See `searchWriter.spec.ts`.

## 10. The worked example in this repository

`functions/src/search/sources/products.ts` indexes the `Products`
collection (name, description, features) for the public site, links to
`/pricing`, shows the price as the badge and leaves inactive products out.
It was added by following this guide verbatim and is the shortest real
source to read after the template.
