# ArcCMS Discoverability: Build Spec (Google + LLM citation)

**Status:** D1 to D3 built 2026-09-21 with unit coverage; D1/D2 verified in the browser against
the dev project, D3's Hosting output awaits a functions deploy (see section 5). D4 to D6 planned. Discussion completed 2026-09-20. Phases are
built one at a time; each ends with a report, a deploy to the dev project and a browser check
before the next starts.
**Branch:** `feat/discoverability` (cut from `feat/search`, which is a superset of `dev`; D6 uses
the search index and D1 emits the `SearchAction` that points at the search results page).
**Scope:** everything ArcCMS itself can do to make published content rank on Google and get
retrieved, quoted and recommended by LLM assistants (ChatGPT search, Perplexity, Gemini, Claude
with web search). Two mechanisms are served at once: training-data inclusion (crawlable, stable,
allowed) and retrieval-time citation (rankable plus quotable: answer-first structure, entities,
freshness, structured data).

**Out of scope, permanently:** meta keywords and keyword-density tooling; "AI content detection"
scores; bulk generation of filler content with an LLM; any feature that fabricates reviews,
ratings or dates. **Out of scope for this spec:** off-site work (Reddit, listings, backlinks),
which the CMS cannot do for the site owner; and per-request crawler logs, because Firebase
Hosting serves static files without request logging (see D-D14).

---

## 0. Decision log

| # | Decision | Choice |
|---|----------|--------|
| D-D1 | Where structured data is built | One pure module, `functions/src/shared/structured-data.ts`, that turns plain inputs (content, type, site, author, language) into JSON-LD objects. `buildHtmlDocument` gains a `jsonLd?: object[]` field on `PageMeta` and serialises each object into its own `<script type="application/ld+json">`. Builders never touch Firestore, so they are unit-testable and reusable by the SPA twin. |
| D-D2 | Which schema types by default | Detail pages: `Article` (`BlogPosting` is a subtype; `Article` is what Google documents and what retrieval pipelines look for). List pages: `CollectionPage` with `ItemList`. Home page and every page: `WebSite` (with `SearchAction` when search is enabled) and `Organization` as `publisher`. Every detail and list page: `BreadcrumbList`. Per-type override arrives in D5. |
| D-D3 | `dateModified` is an editorial field, not `modifiedAt` | `modifiedAt` changes on every save, including a typo fix, so using it would tell Google and LLMs the page is fresher than it is and would be noticed. New optional content field **`updatedOn`** (date), set by the author from the SEO panel ("Mark as updated today"). `dateModified = updatedOn ?? publishedOn`. Sitemap `lastmod` uses the same rule. The default detail template shows "Updated {date}" only when `updatedOn` is later than `publishedOn`. |
| D-D4 | Organisation identity extends `Settings/about` | `about` already carries name, finalUrl and address and is public-safe. It gains `logoUrl`, `description`, `sameAs: string[]` (social and profile URLs), `contactEmail` (public, optional) and `organizationType` (`Organization` or `Person` for a personal site). No new settings document for identity. |
| D-D5a | The admin is the first author, automatically | On a site with no authors, the first admin visit to Content → Authors or to the editor seeds `Authors/admin-{uid}` from the signed-in admin (name, photo, bio "Admin of {site name}.") and makes it the default. Idempotent by id, runs only while the collection is empty, and everything the admin edits afterwards sticks. The first article gets a real byline without any setup. |
| D-D5 | Authors are a first-class collection, not users and not a content type | `Authors/{id}`: `name`, `slug`, `bio`, `photoUrl`, `jobTitle`, `url`, `sameAs[]`. Not on the user document: guest and past authors are not users, and user documents carry private fields. Not a user-defined content type: JSON-LD cannot depend on a type the admin may rename or delete. Content gains `authorId` and a denormalised `authorName` for lists. `Settings/discoverability.defaultAuthorId` fills new content. Authors are public-read (no private fields exist on them) so the SPA fallback can render the author box. |
| D-D6 | AI crawler policy is a per-site setting with citation-friendly defaults | `Settings/discoverability.crawlers` holds one allow/deny per known agent, grouped as *search and answer bots* (`OAI-SearchBot`, `Claude-SearchBot`, `PerplexityBot`, `Googlebot`, `Bingbot`; default allow, these are what produce citations) and *training bots* (`GPTBot`, `ClaudeBot`, `Google-Extended`, `Applebot-Extended`, `CCBot`, `Bytespider`, `meta-externalagent`; default allow, owner may deny). `generateRobotsTxt.ts` renders the groups. The list of agents lives in one constant so it can be updated without a schema change. |
| D-D7 | `llms.txt` is a cheap bet, labelled as such | Generated at `/llms.txt` (site name, description, one line per content type, then one line per published page with its summary, most recent first, capped at 500 links) and `/llms-full.txt` (concatenated Markdown twins, capped at 2 MB). No major provider has confirmed consuming either file; the cost is one generator on the sitemap pattern, so it ships, and the settings page says plainly that adoption is unconfirmed. |
| D-D8 | Every published page gets a Markdown twin | `/{type}/{slug}.md` (language-prefixed like the HTML) rendered from the same hydrated content: title, byline, dates, summary, then body converted HTML to Markdown, then FAQ and sources. Advertised from the HTML with `<link rel="alternate" type="text/markdown">`. Hosting cannot negotiate `Accept`, so the twin is a separate path, not a header switch. Agents fetch it at a fraction of the tokens of the HTML. |
| D-D9 | IndexNow on publish, nothing for Google | `processPublishQueue` pings `api.indexnow.org` with every URL the batch deployed or removed. Bing powers ChatGPT search and its own Copilot, so this is the one push channel that reaches an LLM index. The key file is deployed to hosting once at `/{key}.txt`; the key is generated on first use and stored in `Settings/discoverability`. Google offers no equivalent for ordinary pages; sitemap `lastmod` is the signal there. Pings are fire-and-forget and never fail a publish. |
| D-D10 | Structured blocks are Tiptap nodes that render to plain HTML with `data-arc-block` | FAQ, key takeaways, how-to steps and definition blocks are editor nodes whose HTML output is ordinary semantic markup (`<section data-arc-block="faq"><h3>Q</h3><p>A</p>…`). The publish pipeline parses the body with cheerio and emits `FAQPage`, `HowTo` and the `abstract` field from what it finds. The schema is derived from the page, so the two can never disagree, and a template author needs no new bindings. |
| D-D11 | Sources are a content field, rendered and emitted | `references: { title, url }[]` on content, edited in the SEO panel, rendered as a "Sources" list at the end of the body by the default template and emitted as `citation` on the `Article`. Outbound links carry `rel="noopener"` only; no `nofollow`, because citing sources is the point. |
| D-D12 | Content types map to a schema type once, in the type editor | `ContentType.schema?: { type: 'Article' \| 'NewsArticle' \| 'BlogPosting' \| 'Product' \| 'Service' \| 'Event' \| 'Person' \| 'Recipe' \| 'HowTo'; fields: Record<string, string> }`, where `fields` maps schema properties (`price`, `priceCurrency`, `availability`, `brand`, `sku`, `startDate`, `location`…) to custom field keys. The builder reads the mapping; a missing mapping falls back to `Article`. Kept declarative so a Products type can emit `Product` + `Offer` without code. |
| D-D13 | The checklist advises, it does not block | The editor's discoverability panel scores the draft against rules (answer-first opening, question-form headings, list or table present, meta description length, FAQ present, author set, cover image alt text, at least three internal links, updatedOn within twelve months, sources present). It shows a score and the failing rules. Publish is never blocked; authors ignore blockers by working around them, and a low score on a deliberately short page is fine. |
| D-D14 | Crawler hits cannot be counted; referrers can | Firebase Hosting serves static files with no request log the project can read, so "which AI bots fetched which page" is not buildable without fronting Hosting with a proxy, which this spec rejects. What can be measured is arrivals: GA4 `sessionSource` grouped into an "AI assistants" bucket (chatgpt.com, perplexity.ai, gemini.google.com, claude.ai, copilot.microsoft.com, you.com, and the search bots' referrer domains) on the analytics dashboard. Owners verify crawling in Search Console and Bing Webmaster Tools, which the settings page links to. |
| D-D15 | Related content is served from the search index, at publish time | The static page gets a "Related" block of up to four items chosen by running the item's title and tags through the same ranking `search` uses, at publish time, so the page stays static. The SPA twin calls the callable at render time. Same source of truth as the header search (S-D7). |
| D-D16 | Internal-link suggestions reuse the admin search callable | The editor shows "Content you have not linked to" by searching the draft's title and tags with `lang: 'all'` and removing items already linked in the body. No new index, no new function. |

### Explicit non-goals (deferred or permanently out)
Topic hubs / pillar collections (a `collection` content type; revisit after D6) · category
landing pages · Google Search Console API integration (submission and reports) · per-request
crawler logs (D-D14) · automatic translation for discoverability · schema types beyond the D-D12
list · `Review` / `AggregateRating` markup unless the site actually collects ratings (fabricated
ratings are a Google penalty) · AMP · a separate "AI summary" field generated by a model.

---

## 1. Current architecture (what this builds on)

```
PUBLISH PIPELINE (functions)
processPublishQueue.ts  →  deployContentPage.ts (per language: hydrate template, inject
                            partials, build PageMeta, buildHtmlDocument)
                        →  deployContentListPage.ts, generateSitemap.ts, generateRssFeed.ts
                        →  deployBatchToHosting: one Hosting version per publish
html-document.ts        emits title, description, canonical, OG/Twitter, og:locale,
                        hreflang, robots meta, RSS link. No JSON-LD today.
generateRobotsTxt.ts    "User-agent: * / Allow: /" plus the sitemap. No per-bot policy.
deploySeoFile.ts        deploys a standalone file (robots, sitemap, feeds) to Hosting.

CONTENT MODEL (published-contents.model.ts)
title, content (HTML from Tiptap), urlSlug, type, coverImage, tags, categories,
seoTitle, metaDescription, canonicalUrl, publishedOn, readTime, summary,
next/previous. No author, no updatedOn, no references, no schema hints.

IDENTITY (Settings/about)          SEARCH (feat/search)
name, finalUrl, address only.      SearchIndex + `search` callable; header widget on
                                   every public page; results at /search?q=.

SPA FALLBACK                       ANALYTICS
page.parts/content-detail sets     GA4 data pulled by refreshAnalyticsData into
title + meta tags via Angular      Firestore; dashboard reads that.
Meta service; no JSON-LD.
```

Key facts the plan exploits:
- One function (`buildHtmlDocument`) writes every `<head>`, so JSON-LD lands everywhere at once.
- The publish batch is the one place deployed URLs are known, so IndexNow and the Markdown twin
  ride the same batch.
- Body HTML is parsed by cheerio already (`replaceArcComponents`), so block detection is cheap.
- The search callable already ranks by title and tags, which is exactly what "related" needs.

---

## 2. Phases

Each phase: build with unit tests → run `npm run test` → report → deploy to the dev project
(functions, then hosting, then rules if changed) → verify in the browser and with external
validators → next phase.

### D1. Structured data foundation
**Goal:** every published page carries correct JSON-LD, and freshness is truthful.

- `structured-data.ts` with builders: `organization`, `webSite` (+ `SearchAction` when the search
  widget is enabled), `breadcrumbList`, `article`, `collectionPage`. Pure functions, full tests.
- `PageMeta.jsonLd?: object[]`; `buildHtmlDocument` serialises each with `</script` escaped.
- `deployContentPage.ts`: `Article` (headline, description, image, datePublished, dateModified,
  inLanguage, mainEntityOfPage, publisher, keywords from tags, articleSection from category,
  wordCount) + `BreadcrumbList` + `WebSite`.
- `deployContentListPage.ts`: `CollectionPage` + `ItemList` + `BreadcrumbList` + `WebSite`.
- Home page: `WebSite` + `Organization`, injected client-side by `home-base.component.ts`. The
  home page is the prerendered Angular shell, not a generated file, so nothing server-side can
  bake the nodes in; Googlebot renders JavaScript and sees them, and every content page carries
  the same `Organization` statically for crawlers that do not.
- `Settings/about` gains `logoUrl`, `description`, `sameAs[]`, `contactEmail`,
  `organizationType`; About settings page gets the fields; `AboutConfig` in
  `site-settings.ts` reads them.
- Content gains `updatedOn`; SEO panel gets a date field and a "Mark as updated today" button;
  publish copies it; sitemap `lastmod` and `dateModified` use `updatedOn ?? publishedOn`; the
  default detail template shows "Updated …" when later than the publish date.
- SPA twin: `content-detail.component.ts` injects the same four nodes via the mirrored builders
  in `src/shared/utils/structured-data.ts` (same mirroring convention as `content-type-names`),
  reading identity through `SiteIdentityService`. `Settings/about` becomes public-read for this;
  it holds only the identity the static pages already publish.

**Verify:** view-source of a deployed detail page shows the three JSON-LD blocks; paste the URL
into Google's Rich Results Test and validator.schema.org with zero errors; sitemap `lastmod`
moves when `updatedOn` is set; Hindi variant carries `inLanguage: "hi"`.

### D2. Authors and publisher identity
**Goal:** every page names a real person and a real organisation, on the page and in the data.

- `Authors` collection, rules (public read, admin write), admin page at Content → Authors
  (`/admin/authors`: list, create, edit, delete; deleting keeps the denormalised name on content).
- `Settings/discoverability` created with `defaultAuthorId`.
- Content gains `authorId` + `authorName`; editor gets an author picker defaulting to the
  default author; bulk import accepts `authorName` and matches or creates.
- Default detail template: author box (photo, name, job title, bio, links) bound via
  `data-arc-bind="author.*"`; list template shows the byline.
- `Article.author` becomes a `Person` with `sameAs`; `publisher` uses `Organization` from D1.
- Search: `authorName` added as an indexed field on the `content` source (weight low).

**Verify:** author box on a deployed page; Rich Results Test shows `author` as Person with
URL; changing the default author changes new drafts only.

### D3. Crawler policy, machine-readable twins, IndexNow
**Goal:** the site consciously admits AI crawlers, hands them a compact form, and tells Bing when
something changed.

- `Settings/discoverability.crawlers` + settings page "Discoverability" (crawler toggles by group
  with a one-line explanation of each, llms.txt on/off, IndexNow on/off, links to Search Console
  and Bing Webmaster Tools).
- `generateRobotsTxt.ts` renders a `Disallow: /` group per switched-off agent (allowed agents
  need no mention); regenerated on every publish and on demand through the admin callable
  `regenerateSeoFiles` ("Save and apply to site").
- Markdown twin per page and language (`html-to-md.ts`, tested on headings, lists, tables,
  images, links, code, blockquotes); `<link rel="alternate" type="text/markdown">` in the HTML.
- `/llms.txt` and `/llms-full.txt` generators on the sitemap pattern.
- IndexNow: key generation, key file deploy, ping with deployed and removed URLs after each
  successful batch; logged, never thrown.

**Verify:** `curl /robots.txt` reflects toggles; `curl /articles/foo.md` returns Markdown;
`/llms.txt` lists the site; function logs show `IndexNow: 202` after a publish; Bing Webmaster
Tools shows the submission within a day.

### D4. Structured content blocks and sources
**Goal:** authors can produce the shapes LLMs quote, without knowing why.

- Tiptap nodes: FAQ (repeatable Q/A), Key takeaways (bulleted summary block), How-to steps
  (ordered, each with title and body), Definition ("What is X?" with a one-sentence answer).
  Each has a toolbar button, slash-menu entry, and renders to semantic HTML with
  `data-arc-block`.
- Confirm the Tiptap table extension is enabled in the content editor toolbar; if not, enable it.
- `references: {title, url}[]` on content; SEO panel editor; default template renders a
  "Sources" section; `Article.citation` emitted.
- Publish pipeline: `extractBlocks(bodyHtml)` → `FAQPage`, `HowTo`, `Article.abstract` (from key
  takeaways); tests for each block shape and for absence.
- Default template CSS for the four blocks; Markdown twin renders them as headings, lists and
  steps.

**Verify:** insert each block in the editor, publish, Rich Results Test shows FAQ and HowTo
rich results eligible; Markdown twin contains the same Q/A text.

### D5. Schema mapping per content type
**Goal:** non-article types describe themselves correctly.

- `ContentType.schema` (D-D12) and a "Structured data" tab in the content type editor: choose a
  type, map its properties to custom fields with dropdowns filtered by compatible field type.
- Builders for `Product` (+ `Offer`), `Service`, `Event` (+ `Place`), `Person`, `Recipe`,
  `NewsArticle`, `BlogPosting`, `HowTo`; unmapped required properties are omitted, never
  invented.
- The Products admin page (`(products)`) and `/pricing` get `Product` + `Offer` markup from the
  real price data.

**Verify:** a Products or Events type publishes with the chosen schema; validator shows the
correct type; a type with no mapping still emits `Article`.

### D6. Signals and feedback loops
**Goal:** authors see how discoverable a piece is before publishing, pages link to each other,
and owners see AI-driven arrivals.

- Discoverability checklist panel in the editor (D-D13) with score, failing rules and one-line
  fixes; rules are pure functions over the draft, fully tested.
- Internal-link suggestions in the editor (D-D16).
- Related content block on detail pages, static at publish time (D-D15); SPA twin.
- Analytics dashboard: "AI assistants" traffic bucket from GA4 `sessionSource`, with a per-source
  table and a 30-day trend.
- `docs/discoverability-developer-guide.md`: how to add a schema builder, a block, a crawler
  agent, a referrer domain; and `docs/discoverability-content-guide.md` for authors (answer
  first, question headings, facts, freshness, sources).

**Verify:** the panel score changes as the draft changes; related items appear on a deployed
page and are relevant; the analytics bucket shows a session after visiting via a
`?utm_source=chatgpt.com` style referrer test.

---

## 3. Data changes summary

| Where | Field | Phase |
|-------|-------|-------|
| `arc_{slug}` / drafts | `updatedOn?: Date` | D1 |
| `Settings/about` | `logoUrl`, `description`, `sameAs[]`, `contactEmail`, `organizationType` | D1 |
| `Authors/{id}` (new) | `name, slug, bio, photoUrl, jobTitle, url, sameAs[]` | D2 |
| `arc_{slug}` / drafts | `authorId`, `authorName` | D2 |
| `Settings/discoverability` (new) | `defaultAuthorId` | D2 |
| `Settings/discoverability` | `crawlers`, `llmsTxt`, `indexNow: { enabled, key }` | D3 |
| `arc_{slug}` / drafts | `references: {title,url}[]` | D4 |
| `ContentTypes` | `schema?: { type, fields }` | D5 |

Rules: `Settings/about` public read (D1, identity only); `Authors` public read / admin write (D2);
`Settings/discoverability` admin read+write (D2), public read is not needed because functions
bake everything into static files.

---

## 4. Risks and how they are handled

- **Wrong structured data is worse than none.** Builders omit any property they cannot fill
  truthfully; nothing is defaulted to a made-up value (no placeholder ratings, no fake authors).
  Tests assert omission.
- **Template authors override the default template.** Custom templates get the JSON-LD anyway
  (it is in `<head>`), but author box, sources and blocks need bindings; the developer guide
  lists them and the fallback template includes them.
- **Blocking training bots while expecting recommendations.** The settings page states the
  trade-off next to the toggles.
- **IndexNow abuse.** Only URLs the batch actually deployed are pinged; the key is per site.
- **Markdown twins double the Hosting file count.** Hosting versions tolerate it; the twin is
  skipped for types with `hasPublicUrl: false`.

---

## 5. Phase log

### D1 (built 2026-09-21)

Files: `functions/src/shared/structured-data.ts` (builders), `site-jsonld.ts` (site nodes),
`content-dates.ts` (`updatedOn` rule), `html-document.ts` (`PageMeta.jsonLd`, `markdownUrl`),
`deployContentPage.ts`, `deployContentListPage.ts`, `generateSitemap.ts`, `site-settings.ts`
(`AboutConfig` identity fields); `src/shared/utils/structured-data.ts` (client mirror),
`core/services/site-identity.service.ts`, `page.parts/content-detail.component.ts`,
`page.parts/home-base.component.ts`; About settings model/service/page; editor SEO tab
(`updatedOn`, "Mark as updated today"); `public/templates/default/detail.html` ("Updated" line),
`public/i18n/hi/strings.json`; `firestore.rules` (`about` public read); `docs/security-rules.md`.

To verify after deploying functions + rules + hosting to the dev project and republishing one
item ("Redeploy all" or edit + publish):
1. `curl -s https://<site>/articles/<slug> | grep -o '<script type="application/ld+json">[^<]*'`
   shows four nodes: Organization, WebSite (with SearchAction), BreadcrumbList, Article.
2. Paste the URL into https://search.google.com/test/rich-results and https://validator.schema.org:
   zero errors; Article shows `datePublished`, `dateModified`, `publisher`.
3. `curl -s https://<site>/sitemap.xml | grep -A1 '<slug>'` shows `<lastmod>` equal to the publish
   date; set "Last updated" in the SEO tab, publish, and it moves to that date while the page shows
   "Updated {date}" in the header.
4. The list page `/articles` carries CollectionPage + ItemList; the Hindi variant `/hi/articles/…`
   carries `inLanguage: "hi"` and a `/hi/search?q=` SearchAction.
5. Settings → About: fill Logo URL, Description, sameAs; republish; Organization gains `logo`,
   `description`, `sameAs`.

### D2 (built 2026-09-21)

Files: `src/shared/models/author.model.ts` (IAuthor, normalisation, name key),
`functions/src/shared/authors.ts` (cached loader, Person input, template bindings),
`firestore.rules` (`Authors` public read / admin write; `Settings/discoverability` admin),
`src/app/pages/admin/(authors)/` (service, page, drawer form, default-author star), route
`/admin/authors` + sidebar link under Content; editor Basic tab author picker with default
pre-fill and denormalised `authorName`; bulk import "Author" column (match or create by name);
`deployContentPage.ts` (Article.author Person, `author.*` + `authorName` bindings),
`deployContentListPage.ts` (`authorName` byline), `content-fields.ts` (search indexes
`authorName`); default templates (header byline, author box, list card byline) + Hindi strings;
SPA twin (`AuthorProfileService`, byline, author box, Person node, custom-template re-hydration).

Also in D2: the app shell's between-routes spinner became a fixed top progress bar
(`nav-progress.component.ts`); the old in-flow spinner pushed the hydrated page down by 60vh on
every admin navigation.

Verified in the browser 2026-09-21 against xlm (rules deployed). To verify:
1. Content → Authors: with no authors, the page seeds the signed-in admin as the first author
   (bio "Admin of {site name}.") and marks it Default. Edit it, add others, toggle default, delete.
2. Open an article: the Basic tab shows the Author picker; a new article pre-selects the default.
   Save; the draft carries `authorId` and `authorName`.
3. Public `/articles/<slug>` (SPA): byline in the header, author box above the share row, and
   the Article JSON-LD in `<head>` has `author` as a Person with url/image/sameAs.
4. `/articles`: cards show the byline.
5. Bulk import a CSV with an "Author" column: names matched case-insensitively to existing
   authors, new ones created once.
After the functions deploy + a republish, the same appears in the static HTML and the search
box finds items by author name.

### D3 (built 2026-09-21)

Files: `functions/src/shared/crawlers.ts` + `src/shared/constants/crawlers.ts` (mirrored
registry, parity test), `functions/src/shared/discoverability-settings.ts` +
`src/shared/models/discoverability.model.ts`, `pages/generateRobotsTxt.ts` (policy rendering),
`shared/html-to-markdown.ts`, `shared/markdown-twin.ts`, `pages/generateLlmsTxt.ts`,
`pages/indexNow.ts`, `pages/regenerateSeoFiles.ts` (callable), `publishQueue/processPublishQueue.ts`
(robots + llms + key file in every release; IndexNow after a successful release),
`pages/seedStaticPages.ts`, `deployContentPage.ts` (`.md` twin beside every `.html`, removed with
it, `<link rel="alternate" type="text/markdown">`), `firebase.json` (cache headers for `.md`/`.txt`),
Settings → Discoverability page, route, hub entry, i18n (en + hi).

Verified in the browser 2026-09-21: the settings page loads, toggles persist to
`Settings/discoverability` (merge; the D2 default author survives), and "Save" reports that
the next publish applies them. "Save and apply" needs the `regenerateSeoFiles` function deployed.

To verify after `firebase deploy --only functions` (no hosting deploy needed; the functions
release the files themselves):
1. Settings → Discoverability → switch off GPTBot → **Save and apply to site**: the message
   reports the files updated; `curl https://<site>/robots.txt` shows `User-agent: GPTBot` /
   `Disallow: /` after the `User-agent: *` group, plus `Sitemap:` and the llms.txt pointer.
2. `curl https://<site>/llms.txt`: H1, blockquote, one section per public content type with
   `- [title](…/slug.md): summary` lines newest first. `curl https://<site>/llms-full.txt`:
   the twins concatenated.
3. Publish (or edit + publish) one article: `curl https://<site>/articles/<slug>.md` returns
   the twin with front matter; `view-source:` of the HTML has the `text/markdown` alternate link.
4. Function logs show `IndexNow: 202, submitted N URL(s)`; the key file at `/{key}.txt` returns
   the key; the key appears on the settings page after a reload. Bing Webmaster Tools →
   IndexNow shows the submission within a day.
5. Switch llms.txt off, publish: `/llms.txt` returns 404 after the release.
