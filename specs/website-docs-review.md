# Website docs review (2026-10-05)

Working checklist from a review of the website documentation against the code
(docs/website/*, docs/features/templates.html, docs/features/content.html and the
pages they lean on). Four passes: content types and fields, templates, the other
website pages, and a newcomer converting an HTML site. Branch:
`fix/website-docs-review`. Decisions (Gunjan, 2026-10-05): fix code bugs 1 to 10
here; 11 to 13 go to the backlog with their current behaviour documented; write a
tutorial with a worked example; keep this list in specs/.

Tick an item when it is fixed in code, docs or both.

A1 to A12 fixed in code (2026-10-05), with tests. Sections C, D and E written 2026-10-05 (three writers plus the tutorial, all facts checked against this branch's code). B items stay open; their current behaviour is documented. A4 also made the app's card rows match published cards (authorName, author, tagsDisplay, contentType, cat, 25-word excerpt); A6 keeps a deleted author's stored name as plain text (byline) in both renderers, the author box stays empty; A9 adds src/shared/utils/url-slug.ts; A3 only helps uploads made after the fix.

## A. Code fixes in this branch

- [x] A1. `seedStaticPages` callable has no auth check (functions/src/pages/seedStaticPages.ts:245-257, TODO in code). Anyone can trigger a full republish. Require an admin.
- [x] A2. Image size bindings are empty when `storagePrefix` is set: the patterns in src/shared/utils/image-sizes.ts:8,11 (mirrored in functions/src/shared/image-sizes.ts) require `/o/mediaImages%2F` at the bucket root; uploads go to `{prefix}mediaImages/` (file-upload.service.ts:261,313). The dev project uses `arccms/`.
- [x] A3. Size bindings point at files that do not exist for images smaller than the maximum: sizes with the same dimensions are uploaded once under the largest suffix (file-upload.service.ts:283-318), while templates swap the suffix blindly (image-sizes.ts:98-100). Comment at :242-243 does not match.
- [x] A4. Custom fields on cards answer only to the stored key: card rows carry no `contentTypeSlug` (functions/src/shared/content-cards.ts:46-65; content-list.component.ts:420-438; content-partials.component.ts:266-280), so `aliasCustomFields` (template-hydration.ts:46-69) never runs inside loops. docs/website/templates.html:60 promises the short key works.
- [x] A5. The app loads at most 10 items of a type, unordered: `getAll(undefined, slug)` in content-list.component.ts:286, content-detail.component.ts:475, content-partials.component.ts:197 takes the store default `limit: 10` (generic-store.service.ts:57,152). Preview lists and cards are wrong; the app's detail fallback says "not found" past 10 items.
- [x] A6. Deleted author: `authorTemplateData(null)` returns `authorName: ''` and is spread after `...content` (functions/src/shared/authors.ts:86; deployContentPage.ts:164), so the published byline disappears on the next publish. The app falls back to `content.authorName` (content-detail.component.ts:519). docs/website/authors-and-tags.html:24 says the name stays.
- [x] A7. Static pages build the search widget with the hosting site id as project id (functions/src/pages/deployStaticPage.ts:52); the home page uses GCLOUD_PROJECT (deployHomePage.ts:268).
- [x] A8. Republish website (`redeploy-all`) skips static pages (processPublishQueue.ts:41-68, :280-300); docs say it republishes the whole site.
- [x] A9. Item URL slugs: no validation (create-content.component.ts:1533); a clash builds `` `${baseSlug} -${count} ` `` with spaces (:1758); `getBaseSlug` regex `(.*)-(\\d+)$` never matches (:1752).
- [x] A10. A `date` field renders `datetime-local` (create-content.component.html:576-580), so it asks for a time and stores `YYYY-MM-DDTHH:mm`.

- [x] A11. Found while converting the example: the template fragment check (src/shared/utils/template-fragment.ts and its functions mirror) rejected a template whose comment or style block mentioned `<head>`, so the app silently used the default template and publishing would fail. It now ignores comments, `<style>` and `<script>` contents.
- [x] A12. The pre-built tag pills (`tagsHtml`) carried the `arc-skeleton` loading class, which nothing removes, so the app showed tag names as blank shimmer. Removed in content-cards.ts and both app components.

## B. Backlog (document current behaviour now)

- [x] B1. Collection reference fields: only `id`, `title`, `urlSlug`, `coverImage` work as display or copied fields (custom fields live under `customFields`, create-content.component.ts:672-745); options include drafts; "kept in sync automatically" (add.page.html:258-259) is never done server side.
  Fixed (B1b decided as recommended: no live sync): the editor offers published entries only, with custom fields flattened so they label and copy (referenceOption); publishing rebuilds `_ref_` copies from the linked entries as published (functions/src/shared/linked-entries.ts, deployContentPage); the form wording now says so. The client CollectionRefSyncService still refreshes stored copies on save, and reads a custom display field now.
- [x] B2. Translated pages: `readingTime` is always English (deployContentPage.ts:156) and the shipped hi.json maps `reading_time` to it; signup panels in arc-site.js are English only; the default "Latest {type}" heading always says "Latest"; `<time data-arc-bind>` formats in en-US (template-hydration.ts:693).
  Fixed: readingTime from min_read (publishing and app); arc-site.js panels through t() with the page's signup_* strings on data-strings; card heading from latest_of_type; <time> dates in data.lang. hi.json has the new keys. Server error messages stay English.
- [x] B3. Admin Template Reference (view.[contentTypeId].page.ts:93-156) lists `summary` and `isFeatured` on cards, `nextContent.url` when published, offers `{{ key }}` for every field type (wrong for richtext, repeating, checkbox, references), and omits `references`, `related`, repeating loops and `langPrefix`.
  Fixed: the reference is built from src/shared/utils/template-reference.ts, by page (detail, loops, list, card block, each item, attributes) with a snippet per field type; template-reference.spec.ts checks every key against the data publishing builds (buildTemplateData, listPageData, partialPageData, cardData) and renders each field type's snippet.
- [x] B4. App preview differences worth closing: partials run no template scripts (content-partials.component.ts); header and footer scripts never run in the app (site-fragment.ts innerHTML); `<arc-search>`/`<arc-language-switcher>` only mount in the header; the app's excerpt is 20 words, published 25; preview dates en-US.
  Fixed: card blocks run their scripts once; header and footer scripts run (inline on each draw, files once); the footer mounts arc-search and arc-language-switcher; the app's cards come from the shared builder src/app/core/utils/content-cards.ts (functions mirror, parity spec), so excerpts, dates and names match; app detail dates in the page's language. A template's own arc-search still does nothing in the app.
- [x] B5. Unsplash size bindings ignore the configured maximum (template-hydration.ts:158).
  Fixed: TemplateHydrationService.setMaxImageSize (both copies); publishing sets it from Settings/misc mediaMaxSize (getMiscSettings), the app from the new MediaSettingsService. Also corrected the stale media.html troubleshooting row about upload folders (A2).
- [x] B7. App preview in another language: list item `url` has no language prefix, list rows' `contentType`/`cat` use the stored name, partial cards are not translated (documented as current behaviour).
  Fixed: list and card block cards from the shared builder (url with the language prefix, translated type name); card blocks load their entries' translations; lang and langPrefix set in the app's detail, list and card block data.
- [x] B6. Live site files are cached 5 minutes per functions instance, misses included (site-files.ts:49-86); "deploy, then publish again" can fail for up to 5 minutes.
  Fixed: files are cached under their build hash from site.json, the manifest for 10 seconds, and a missing folder rereads the manifest before refusing; getPartials and getUiStrings no longer cache on top.

## C. Doc corrections

### docs/website/overview.html
- [x] :27 add "Deploy for the first time" to Before you start (custom template folders need a website deploy first).
- [x] :78 only HTML and strings are served at /_site/; assets at /site/, site.css at /assets/css/site.css, favicon and error pages at the root.
- [x] :79 "no special rules for {, } or @" is true for home, header, footer and static pages, not templates.
- [x] Decide-before-first-publish box: default language, image sizes, authors, type slug.

### docs/website/plan-content.html
- [x] :27 a type with public pages off shows nowhere on the published site (deployHomePage.ts:133-136 removes its cards); only app pages read it.
- [x] :30 built-in fields: list read time, so nobody adds a reading-time field.
- [x] :41 RSS only with the seo feature, default language only.
- [x] :48 slug change hides every entry (collections are `arc_{slug}`), not only links; item URL slug rules.
- [x] :49 reserved slugs: add profile, email-preferences, site, _site, checkout-success, tiptap-test.
- [x] :55 sharing one template folder across types: short keys only on detail pages (until A4).

### docs/website/content-types.html
- [x] :20-23 form order: Generate public pages comes first and hides Slug and Template when off; a new type preselects a folder named after its slug.
- [x] :22 public pages off: same as plan-content :27.
- [x] :28 slug change: same as plan-content :48.
- [x] :36 date and datetime (A10).
- [x] :43 maplocation heading.
- [x] :53 lists use `excerpt` (meta description or start of body), not Summary.
- [x] Field settings: required is checked at Publish only; a field's type can change after saving and values are not converted; deleting a field leaves its values; which fields translate.

### docs/website/templates.html
- [x] :46 the app's fallback has exceptions (partials render nothing; default-folder errors).
- [x] :60 short keys (A4) and the Template Reference caveats (B3).
- [x] :61 placeholder text: loops drop it, an unfilled `data-arc-bind` keeps it.
- [x] :67-68 deploy then publish, and the 5-minute cache (B6).

### docs/features/templates.html
- [x] :61 `<time data-arc-bind>` English date; `datetime` gets the raw value.
- [x] :62 `[innerHTML]` reads top-level keys only.
- [x] :63 any `[attr]` works.
- [x] :67 `data-arc-style-background` also sets `color: #333`.
- [x] :82 language switcher removed when the page exists in fewer than two languages.
- [x] :83 arc-content-partials is filled on the home page; arc-admin-edit-button is a legacy tag, always stripped.
- [x] :128 nextContent/previousContent also carry id and summary.
- [x] :180-187 partials attributes are kebab-case (`content-type`, `count`, `section-title`, `template-folder`); defaults: no default type when published (element removed), count 1 to 50, title "Latest {type}".
- [x] :190 published cards have every list binding; the app's preview lacks authorName, author, tagsDisplay, contentType, cat.
- [x] :196 header and footer: only the header mounts search and switcher in the app; no `{{ }}` bindings in header/footer.
- [x] :199 partials run no scripts in the app.
- [x] :230 template folder names `[a-z0-9][a-z0-9_-]*`.
- [x] :232 fallback exceptions.
- [x] :234 placeholder text rule reversed.

### docs/features/content.html
- [x] :60 public pages off (as plan-content).
- [x] :74 date field (A10).
- [x] :76 collection reference (B1).
- [x] :83 maplocation heading.
- [x] settings table: Icon missing.

### docs/features/languages.html
- [x] :66 contradicts the custom space: public strings and translated home pages belong in src/custom/site/.
- [x] :73 `min_read` example vs the shipped `reading_time` key (B2).
- [x] :53, :141 deploy versus republish wording, consistent with deploy.html.

### docs/website/home-page.html
- [x] :68 dev preview: scripts run after load and in no fixed order; app styles present.
- [x] :72 `lang`, canonical, og:url, og:locale and hreflang are always set (replacing the page's); RTL `dir`; robots when missing.
- [x] :72 onboarding redirect: everyone on a fresh install, signed-in people once setup started.
- [x] :83 Republish website (A8).
- [x] Mention docs/examples/arc-cms-home.hi.html.

### Other website pages
- [x] forms.html:23 slug edits do not change the form id; keep the original.
- [x] forms.html:30 `data-waitlist-id` optional; an unknown id creates an empty form.
- [x] forms.html: no code step when email is off; panels are English; ref codes kept 30 days.
- [x] choose-features.html:51 forms off: visitors see an error.
- [x] launch-checklist.html:75 published pages carry no analytics tag.
- [x] launch-checklist.html:53, static-pages.html:24 cookie banner only on pages the app draws.
- [x] seo.html:36 static pages carry no structured data.
- [x] seo.html:50 title of 70 characters or fewer.
- [x] search.html:21 author names are searched; the body is not.
- [x] languages.html:30, search.html:18 `strings/{lang}.json`, not strings.json.
- [x] static-pages.html:24 recommend /p/ (/pages/ does not exist in dev).
- [x] move-your-site.html:58 home.css only when main.css was not edited.
- [x] move-your-site.html:47-49 the deploy menu seeds after a website deploy; seed:prod always targets production.
- [x] media.html:37 sizes: GIFs give the original at every size; sizes bound the longest side.
- [x] authors-and-tags.html:24 deleted author (A6); tag colours copied at save; author photo is a URL field.

## D. Missing content

- [x] D1. Field types reference: what each of the 16 types stores and gives a template (text, number as string, richtext needs `[innerHTML]`, date/datetime raw, boolean with data-arc-if, options, checkbox array, references `ref_<key>`, image sizes, icon, color, infocard, gallery, labelvalue, maplocation).
- [x] D2. Complete binding tables: detail page and loops, list page and items, partials page and items, with published versus preview notes.
- [x] D3. What publishing puts around a template: title and description sources, no body class, `<style>` to head, `<script>` to end of body, `<link>` kept and versioned, the stylesheets before yours (cssUrls), three ways to add CSS and where each applies.
- [x] D4. Preview versus live differences (scripts timing, header/footer placement, elements in the body, dates, langPrefix, unfilled data-arc-bind shimmer).
- [x] D5. Template syntax edge cases: `{{ }}` grammar and escaping, data-arc-if truthiness and no negation, loop scope, nested loops, same loop twice, data-limit, data-arc-t-params, data-arc-t replaces children, arc-skeleton.
- [x] D6. Strings files: flat JSON, merge rules, default-language file ignored, attributes with data-arc-t-attr.
- [x] D7. Signup form markup: field names, data attributes, counts, terms notice override, install and signed-in hooks.
- [x] D8. Reading a shipped template: `.arc-cms-template`, `arc-skeleton`, empty states, `section.arc-block` body blocks.
- [x] D9. Site file rules: what is ignored, name patterns, what needs a deploy.

## E. Tutorial

- [x] E1. docs/examples/blog/: original `index.html`, `blog.html`, `post.html` with CSS and JS; the finished `src/custom/site/` files.
- [x] E2. docs/website/convert-a-site.html, "Turn an HTML site into an Arc CMS site", after the overview in the nav: sort the pages, create the type and fields, header and footer, home page, list, detail, cards, preview, deploy and publish, second language, common mistakes.
- [x] E3. Convert the example for real in the browser and record what each step shows.
- [x] E4. Move "Move your site into src/custom/site" out of the newcomer path, next to Upgrade Arc CMS.
