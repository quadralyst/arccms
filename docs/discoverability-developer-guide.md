# ArcCMS Discoverability: Developer Guide

How the discoverability features are built and how to extend them. The decisions behind the
design are in `docs/discoverability-spec.md` (D-D1 to D-D16); this guide is the "where do I
change what" companion. Everything below has unit coverage; run `npm run test` from the repo
root.

## 1. The shape of it

```
PUBLISH (functions)                                   SPA FALLBACK (Angular)
deployContentPage.ts                                  page.parts/content-detail.component.ts
  buildDetailJsonLd()  → structured-data.ts             same nodes via src/shared/utils/*
                         site-jsonld.ts                 (mirrors of the functions modules)
                         schema-mapping.ts
                         content-blocks.ts
                         authors.ts, references.ts
  template data        → author.*, authorName,
                         references, hasReferences,
                         related, hasRelated,
                         updatedOnDisplay
  Markdown twin        → markdown-twin.ts + html-to-markdown.ts
processPublishQueue.ts → robots.txt, llms.txt, IndexNow key, IndexNow ping
```

Two rules run through all of it:

1. **Never invent a value.** A property that cannot be filled truthfully is omitted. Tests assert
   omission; keep it that way.
2. **The functions are the source of truth; the client mirrors them.** Every `src/shared/...`
   twin of a `functions/src/shared/...` module says so in its header. Registries (crawlers,
   schema types) have a parity test that fails when the two drift.

## 2. Adding a schema.org type (D5)

1. Add the type to `functions/src/shared/schema-types.ts`: an id, label, description, and the
   `properties` an admin may map, each with the custom-field types that can fill it. Copy the
   file to `src/shared/constants/schema-types.ts` (only the "mirrored" comment differs);
   `schema-types.spec.ts` fails if they differ.
2. Build it in `buildMappedNode()` in `functions/src/shared/schema-mapping.ts` and its client
   mirror `src/shared/utils/schema-mapping.ts`. Read values through `text()`, `num()`, `date()`;
   set with `setIf()` so an empty value never lands.
3. Add a case to `functions/src/__tests__/schemaMapping.spec.ts` and
   `src/shared/utils/schema-mapping.spec.ts`.

The type editor's Structured data section needs no change: it renders whatever the registry
lists and filters field dropdowns by `fieldTypes`.

## 3. Adding a content block (D4)

1. Add the kind to `ARC_BLOCKS` in
   `src/shared/components/tiptap-editor/service/arc-block-extension.ts`: title, icon,
   description and the seeded HTML. The toolbar menu and the slash menu read that list.
2. Give it a label in the editor (`tiptap-editor.component.scss`, the `[data-arc-block=…]::before`
   rules) and public styling (`public/templates/default/detail.html` and the SPA layout in
   `content-detail.component.ts`, `.arc-block[data-arc-block=…]`).
3. Read its shape in `extractBlocks()` in `functions/src/shared/content-blocks.ts` and the client
   mirror `src/shared/utils/content-blocks.ts`, and emit its node from `blockJsonLd()`.

A block is a plain `<section data-arc-block="kind">` around ordinary headings, paragraphs and
lists. Keep it that way: templates, the Markdown twin and the checklist all treat it as normal
HTML, and the extractor reads the shape rather than anything the editor invented.

## 4. Adding a crawler (D3)

Add a line to `CRAWLERS` in `functions/src/shared/crawlers.ts` and the same line to
`src/shared/constants/crawlers.ts` (parity test). `group: 'search'` for bots that fetch to
answer and cite, `group: 'training'` for bots that collect for training. The settings page
lists it under the right group with its description; `renderRobotsTxt()` emits a
`Disallow: /` group when the owner switches it off. Existing sites get the new agent with the
group default (allowed).

## 5. Adding an AI referrer (D6)

Add a line to `AI_REFERRERS` in `functions/src/shared/ai-referrers.ts`: the substring to match in
GA4's `sessionSource` and the assistant's label. `bucketAiReferrers()` sums sessions per label
for the dashboard's "AI assistants" panel. No client change.

## 6. Adding a checklist rule (D6)

Add a `rule(id, severity, ok, detail)` call in `evaluateDiscoverability()` in
`src/shared/utils/discoverability-checklist.ts`, and the two translation keys
`admin.contents.checklist.<id>` (what it checks) and `admin.contents.checklist.<id>_fix`
(the one thing to do) in `src/assets/i18n/en.json` and `hi.json`, then `npm run i18n:keys`.
Severity weights the score (high 3, medium 2, low 1). Rules never block publishing.

## 7. Template bindings

Bindings the default templates use and a custom template may:

| Binding | Where | Meaning |
|---|---|---|
| `{{ updatedOnDisplay }}` + `data-arc-if="updatedOnDisplay"` | detail | Formatted `updatedOn`, only when later than the publish date |
| `{{ authorName }}`, `{{ author.name }}`, `author.bio`, `author.photoUrl`, `author.jobTitle`, `author.url` | detail, list (`authorName`) | The credited author |
| `data-arc-loop="references"` with `{{ title }}`, `{{ url }}`; `data-arc-if="hasReferences"` | detail | Cited sources |
| `data-arc-loop="related"` with `{{ title }}`, `{{ url }}`, `{{ snippet }}`, `{{ badge }}`; `data-arc-if="hasRelated"` | detail | Related items from the search index |

Public UI strings (`data-arc-t`): `updated_on`, `written_by`, `author_more`, `sources`,
`related_title`, translated in `public/i18n/<lang>/strings.json`.

## 8. Files the pipeline serves

| Path | Generated by | When |
|---|---|---|
| `/{lang}/{type}/{slug}.html` and `.md` | `deployContentPage.ts` | every publish of the item |
| `/robots.txt` | `generateRobotsTxt.ts` | every publish, seed, "Save and apply" |
| `/llms.txt`, `/llms-full.txt` | `generateLlmsTxt.ts` | same, unless switched off |
| `/{key}.txt` | `indexNow.ts` | same, when IndexNow is on |
| `/sitemap.xml` | `generateSitemap.ts` | every publish (`lastmod` = `updatedOn ?? publishedOn`) |

The `regenerateSeoFiles` callable (admin) pushes robots, llms and the key file in one release
without a publish.

## 9. Testing without an emulator

`npm run dev` talks to the real dev project. Functions changes need
`firebase deploy --only functions`; the functions release Hosting files themselves, so no
hosting deploy is needed to see static output. Admin UI and the SPA fallback (drafts via
`?preview=true`) are testable at `localhost:5173` directly. After editing a component `.html`
alone or regenerating translation keys, restart the dev server: the Analog plugin serves a
stale copy otherwise.
