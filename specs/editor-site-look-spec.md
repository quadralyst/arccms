# The Editor Looks Like the Live Page: Build Spec (ES)

**Status:** BUILT 2026-10-17 (ES1 to ES3), browser-checked on the xlm dev project. Agreed 2026-10-17, with the four assumptions in section 7 confirmed.
Option B of the 2026-10-17 discussion, with the six changes from its review (section 2).
**Branch:** `feat/editor-site-look`, cut from `dev` (60920714), worktree `../arccms-editor-site-look`.

**The job:** an admin writing an article sees one look in the editor (admin fonts, Bootstrap
headings, the full pane width) and another on the live page (the template's fonts, sizes,
spacing and column). After this work the body in the editor uses exactly the CSS the live
page uses for it, so what is written is what readers see.

**Agreed (2026-10-17):**
1. **Exact match**: font, size, line height, spacing, colours and column width.
2. **Each content type follows its own template**, and an entry follows its chosen layout
   (`detail-{name}.html`, SS8).
3. **The app's brand shows too**: `main.css` and the app's `site.css` apply, as on the page.
4. **Backwards compatible**: no change to any template, to `main.css` or to an app's
   `site.css`. Apps get the new look on update with nothing to do.

**Out of scope:** the title box, cover image, date and other page parts outside the body
(they stay admin controls); running template scripts in the editor; the email editors
(emails have their own look); option A (one shared prose stylesheet), which can come later
as a cleanup.

---

## 1. Decision log

| # | Decision | Choice |
|---|----------|--------|
| ES-D1 | How the editor gets the page's CSS | **It loads the same three sources the page uses, in the same order:** `main.css`, the app's `site.css` (both with their `?v=` hash from the site manifest), then the `<style>` blocks of the entry's detail template. The template is chosen exactly as `ContentDetailComponent` chooses it: the entry's layout, else the folder's `detail.html`, else the default's, skipping a file that is not a template (`isTemplateFragment`). The order of those candidates becomes one shared pure function, `detailTemplateCandidates(folder, layout)` in `site.ts`, which both use, so the page and the editor cannot drift. The page keeps its own fetching (transfer state, one request at a time). |
| ES-D2 | Keeping the CSS inside the editor | **Every style rule is wrapped in `@scope (.arc-site-look) to (.arc-editor-ui)`**, so it styles only the editor's body and never the admin around it. This is the same reason `SiteStylesService` keeps the site sheets off in the admin today (they share class names such as `.navbar`). The `to (.arc-editor-ui)` limit keeps the site CSS off editor controls that sit inside the body (ES-D9). |
| ES-D3 | Finding where the body sits in the template | **By its binding, not its class.** The element with `[innerHTML]="content"` (`.article-content` in articles and default, `.arc-page-body` in info, `.docs-content` in manuals, anything in an app's own template) and its ancestors up to the template's root are rebuilt around the editor as empty elements with the same tag, `class` and `id`. Only layout tags keep their tag (`div`, `article`, `section`, `main`, `aside`, `header`, `footer`, `figure`, `span`, `nav`); any other, including links, buttons, forms and custom elements such as `<arc-header>`, becomes a `div`, so nothing interactive or Angular-rendered is created in the admin. Interpolated attributes, `data-arc-*`, `[...]` bindings and `arc-skeleton` are dropped. The ProseMirror element itself takes the bound element's classes. |
| ES-D4 | Rules that name the page itself | **`html`, `body` and `:root` at the start of a selector become `:scope`** (the look's root), so `body { font-family }`, `:root { --brand: ... }` and `body > footer` work as on the page. Inside `:is()`, `:where()` and `:not()` they are left alone. |
| ES-D5 | Rules that cannot sit inside `@scope` | **`@font-face`, `@keyframes`, `@property`, `@counter-style`, `@font-feature-values`, `@font-palette-values` and `@layer` order statements are moved out** ahead of the scoped rules. Keyframes get a per-look prefix, and so do the names in `animation` and `animation-name` that point at them, so a site animation never replaces an admin one of the same name. **`@import`s are returned for the service to fetch and scope as well** (left in, an imported sheet's rules would style the admin). `@media`, `@supports`, `@container`, `@layer` and `@starting-style` blocks stay, each with its rules scoped inside; the site's own `@scope` nests inside the look's. `@page`, `@namespace` and unknown at-rules are left out. |
| ES-D6 | Relative `url()` | **Resolved where the page resolves it**, because the rules now live in a `<style>` in the admin page: against the sheet's own address for `main.css`, `site.css` and their imports, and against the entry's page address (`/{type}/{slug}`) for a template's inline styles, which on the page sit in the page's document. `data:`, root-relative and absolute URLs are untouched. |
| ES-D6a | The page frame | **Rules that land on the look's root alone keep only what styles text and colour**: `margin`, `padding`, sizes, `overflow`, position, `display`, `float`, `transform` and `zoom` are dropped from them, since `body { padding-top: 70px; overflow-x: hidden }` frames the whole page and on the editor's root would only add gaps. A root rule holding nested rules is kept whole. |
| ES-D7 | What the page's `<body>` gives that the admin's does not | **The look's root first gets Bootstrap's body defaults** (`--bs-body-font-family`, `-font-size`, `-font-weight`, `-line-height`, `-color`, `-bg`, `text-align`), because Bootstrap's own `body` rule does not reach inside the editor. Then the site's rules apply on top, so anything the admin pane passes down by inheritance is replaced. |
| ES-D8 | Language | **The look's root carries `lang` for the language being edited** (the default or a translation), the same value the page puts on `<html>`, so `:lang()` rules and fonts chosen per script behave as on that language's page. No `dir`: the website sets none today, so the editor sets none either. |
| ES-D9 | The editor's own styles | **When the site look is on, the editor drops its own text styling**: `.ProseMirror`'s colour, padding and margin (including the `!important` ones), `img { display: block }`, the `.custom_tip_tap_editor` padding, and in the version preview the `.version-preview-body` and `.version-preview-content` text and padding rules. **Editing aids stay**: placeholders, the selected image and node outlines, table cell selection, the structured block label, the file card, the drop cursor. Controls drawn inside the body (node view buttons, handles) carry `.arc-editor-ui`. |
| ES-D10 | Where it applies | **The body editor, rich text custom fields (ES-D11), the fullscreen field editor and the version preview.** It is an input of `TiptapEditorComponent` (`siteLook`, default none), so the email editors and any other caller keep today's look. |
| ES-D11 | Rich text custom fields | **Found the same way, by their key**: a field placed by `[innerHTML]="fieldKey"` gets the look of where it sits. A field the template does not place keeps today's editor look. |
| ES-D12 | Loading and failure | **The editor opens at once with today's look and switches when the CSS is ready** (usually within the first paint, as the files are small and cached for the visit). A template that cannot be loaded, or has no `[innerHTML]` binding for the field, keeps today's look, with one console warning and no message to the admin. |
| ES-D13 | One style element per template | **One `<style id="arc-site-look-{n}">` per template in use**, with its own scope class (`.arc-site-look.arc-site-look-{n}`), added when the first editor using it opens and removed when the last one closes (counted, as in `SiteStylesService`). Two editors on one screen with the same template share it. |
| ES-D14 | Rules, functions, indexes | **None change.** Frontend only: nothing to deploy beyond the hosted admin, tested at localhost:5173. |

---

## 2. Changes from the first sketch (the six from the review)

The first sketch said: copy the template's `<style>` into the editor under `@scope` and give
the editor the class `article-content`. The review found six gaps, all now in the decisions:

1. **Not every template uses `.article-content`**: info uses `.arc-page-body`, manuals
   `.docs-content`, and an app's own template can use anything. The body is found by its
   `[innerHTML]` binding and its ancestors are rebuilt (ES-D3).
2. **`@scope` silently drops some rules**: `body`, `html` and `:root` never match inside it
   (`main.css` sets the site font on `body`; brand variables usually sit on `:root`), and
   `@font-face`, `@keyframes` and `@import` are not allowed in it (`main.css` has a
   `@keyframes`). Selectors are rewritten and those rules moved out (ES-D4, ES-D5). Relative
   `url()` would also break once moved (ES-D6).
3. **Bootstrap's `body` defaults are missing inside the editor** while the page has them; the
   root gets them (ES-D7).
4. **The editor's own CSS would win in places**: `padding: 10px !important` and `margin: 0
   !important` on `.ProseMirror`, `img { display: block }`, and the pane's padding. These are
   turned off when the look is on, while editing aids stay (ES-D9).
5. **Language matters**: per-language fonts need `lang` on the root (ES-D8).
6. **There is more than one editor**: rich text fields, the fullscreen field editor and the
   version preview get the look too, and the email editors must not (ES-D10, ES-D11).

---

## 3. What is true today

- **Public page** (`src/app/pages/page.parts/content-detail.component.ts`):
  `loadCustomTemplate` fetches `siteLayoutUrl(folder, content.layout)` with fallbacks
  (`templateUrlFor`, `rejectedLayoutUrl`, `rejectedTemplateFolder`, `isTemplateFragment`),
  then `TemplateHydrationService` puts `data.content` into the `[innerHTML]` element
  unchanged (template-hydration.service.ts, the `[innerHTML]` branch). Custom fields are
  spread into the same data, so `[innerHTML]="fieldKey"` places a rich text field.
- **Site sheets** (`src/app/core/site/site-styles.ts`): `main.css` and `site.css` are links
  switched on only while a website page is shown. `siteManifest().files` holds their hashes.
- **Templates** (`public/_site/templates/{default,articles,info,manuals}/detail.html`,
  `info/detail-contact.html`): each has one `<style>` block, body rules on the bound element's
  class, `@media (max-width: 768px)` blocks, no `body` or `:root` rules. All shipped ones put
  the body in block layout (no flex row beside it).
- **`main.css`**: a `body` rule (font, colour, background, line height), header and footer
  rules, one `@keyframes`. Core `site.css` is empty; an app's comes from
  `src/custom/site/site.css` (scripts/arc-site.mjs).
- **Bootstrap 5.3** is loaded on every page (index.html), admin and website alike.
- **Editor** (`src/shared/components/tiptap-editor/`): `.ProseMirror` gets `color: #000`,
  `padding: 10px !important`, `margin: 0 !important`, image rules, placeholder, table,
  structured block and file card rules; the root class is `custom_tip_tap_editor`.
  Used by the content editor (body and rich text fields), the fullscreen field editor
  (`fullscreen-editor-dialog`), and the two email editors.
- **Content editor** (`create-content.component.*`): knows the content type
  (`currentContentType()`, its `templateFolder`), the chosen layout (`layoutOptions`, the
  `layout` field) and the language being edited; the version preview renders into
  `.version-preview-body`.

---

## 4. Phases

Each phase ends with the whole suite through the test-runner agent, a browser test at
localhost:5173 (the worktree's own dev server), the docs it affects (`npm run docs:affected`),
and a critical review whose critical, high and medium findings are fixed in that phase.

### ES1. The site look engine (no visible change)

What it gives: for any template and field, the rebuilt wrapper and the scoped CSS, tested
on its own.

1. `src/app/core/site/site-look.ts`, pure functions:
   - `bodyChain(templateHtml, key)`: the bound element and its ancestors (ES-D3), or `null`.
   - `templateStyles(templateHtml)`: the text of its `<style>` blocks.
   - `scopeCss(css, { scope, limit, baseUrl })`: ES-D2, ES-D4, ES-D5, ES-D6. A small
     brace-matching splitter that respects strings and comments (no CSSOM, so it runs in
     tests and handles `@import`), recursing into `@media`, `@supports` and `@layer`.
   - `rootDefaults(scope)`: ES-D7.
2. `detailTemplateCandidates(folder, layout)` in `src/app/core/site/site.ts`: the layout's
   URL, the folder's `detail.html`, the default's, without repeats (ES-D1).
   `ContentDetailComponent.templateUrlFor` and its fallbacks use it, with no change in
   behaviour.
3. Tests (`site-look.spec.ts`, `site.spec.ts`):
   - `bodyChain` on every shipped detail template read from disk: articles, default, info,
     info contact, manuals, each ending at the expected class; a missing binding gives
     `null`; dropped attributes; a link, a button and `<arc-header>` ancestor become `div`.
   - `detailTemplateCandidates`: layout set and not, folder missing, default folder, no
     repeats.
   - `scopeCss`: `body`, `html`, `:root`, `body > footer`, `html[dir="rtl"] .x`, comma
     lists, `:is(body, .x)` untouched; `@media` and `@supports` wrapping; nested
     `@layer`; `@font-face`, `@keyframes`, `@import` moved out with `@import` first;
     `url()` relative, root-relative, absolute, `data:`, quoted and unquoted; braces
     inside strings and comments; `!important` kept.
   - A guard: every shipped detail template has exactly one `[innerHTML]="content"`.
   - `ContentDetailComponent` specs unchanged and green (template choice moved, not changed).
4. Docs: none yet (nothing visible). Critical review of ES1.

### ES2. The body editor shows the site look

What it gives: the main body in the content editor matches the live page.

1. `SiteLookService` (root): `forField(contentType, layout, key, lang)` returns
   `{ chain, scopeClass, lang } | null`. Fetches and caches each file for the visit,
   builds and counts the style elements (ES-D13), applies ES-D12. Browser only
   (`isPlatformBrowser`); on the server it returns `null`. Template HTML is read with
   `DOMParser`, which runs no script.
2. `TiptapEditorComponent`: input `siteLook`. When set, it builds the chain around its mount
   element with `Renderer2`, adds the bound classes to ProseMirror (through `editorProps`),
   sets `lang` on the root (ES-D8), and adds `arc-site-look-on`, under which the editor's
   text styling is off (ES-D9). Node view controls get `.arc-editor-ui`. When unset, the DOM
   and classes are exactly as today.
3. `CreateContentComponent`: passes the look for the body (`key: 'content'`), recomputed
   when the content type, the layout or the edited language changes. The pane's own padding
   is off while the look is on.
4. Tests: tiptap editor spec (unset: unchanged DOM; set: chain, classes, `lang`, chain
   rebuilt when the look changes, controls carry `.arc-editor-ui`); service spec (fallbacks
   as ES-D1, cache, style element added once and removed with the last editor, failure and
   server give `null`); create-content spec (look for the type and layout, recomputed on a
   layout or language change); email editor specs unchanged.
5. Browser test, the measure of "exact": for each shipped template, and for a translation,
   open the same entry in the editor and in Preview at the same window width, and compare `getComputedStyle` of the root, a
   paragraph, each heading level, a list, a quote, an image and a table (font family, size,
   weight, line height, colour, margins, and the body's width) with a small script in the
   browser. Any difference is a bug unless it is an editing aid (ES-D9). Screenshots of
   editor and page side by side.
6. Docs: docs/features/content.html (the editor shows the page's look; what stays admin
   style); docs/website/templates.html (how the editor finds the body: the `[innerHTML]`
   element and its ancestors, the template's `<style>`, `main.css`, `site.css`; what does not
   carry over, section 6). Retake the content editor screenshots.
7. Critical review of ES2.

### ES3. Rich text fields, fullscreen editor and version preview

What it gives: the rest of the content editor follows.

1. Rich text custom fields pass `forField(..., field.key, ...)` (ES-D11); a field the
   template does not place keeps today's look.
2. The fullscreen field editor receives and passes the same look.
3. The version preview renders inside the same chain (read-only, no editing aids).
4. Tests: create-content spec (a placed field gets a look, an unplaced one none), fullscreen
   dialog spec, version preview spec.
5. Browser test: a content type with a rich text field placed in its template and one not
   placed; the fullscreen editor; a version preview. Computed-style check as in ES2.
6. Docs: docs/features/content.html (rich text fields, fullscreen, version preview);
   docs/website/templates.html (placing a rich text field with `[innerHTML]` gives it the
   look in the editor). Screenshots.
7. `npm run docs:affected`, `npm run check:docs`, whole suite through the test-runner.
8. Critical review of ES3 and of the whole feature against this spec.

---

## 5. Tests and checks summary

- Unit: `site-look.spec.ts`, `site.spec.ts`, the service, tiptap editor, create-content,
  fullscreen dialog, content detail (unchanged behaviour), email editors (unchanged look).
- No rules, functions or indexes change, so `test:rules` is not needed.
- Browser: the computed-style comparison for every shipped template, at desktop and phone
  width.

## 6. Limits (said in the docs)

- **Screen-width rules follow the window, not the pane.** A template's `@media (max-width:
  768px)` applies when the admin window is that narrow, as it would for a reader with that
  window, even if the editor pane is narrower than the page would be.
- **A pane narrower than the page's column shows a narrower column.** The column keeps the
  page's maximum width (720px for articles) but cannot be wider than the pane; the editor's
  sidebar can be resized to make room.
- **`rem` follows the admin's root size.** Both use Bootstrap's 16px; an app whose
  `site.css` changes the `html` font size sees `rem` sizes differ in the editor.
- **Only the body's ancestors are rebuilt, not what sits beside it.** A template that puts
  the body in a flex row with a sidebar can show a wider body in the editor. None of the
  shipped templates does.
- **Tables** are wrapped by the editor for editing, so a column can be a pixel or two wider
  or narrower than on the page.
- **Classes a script puts on the page's `<html>` or `<body>`** (a theme switch such as
  `html.dark`) are not on the editor's root, so rules that need them do not apply there.
- **Template scripts do not run in the editor.** A template that changes the body with a
  script shows the change only on the page.
- **Page parts outside the body** (title, cover, date, tags) are not shown in the editor.

## 7. Assumptions to confirm

1. The title box keeps the admin look (it is a form field, not the page's heading).
2. The editor opens with today's look and switches once the CSS is loaded (a short flash on
   the first open of a visit), rather than waiting with an empty editor.
3. The template's page wrappers (padding, background, the centred column) show in the
   editor, since they decide the body's width and spacing on the page.
4. Rich text fields that the template does not place keep today's look.

## 8. Changes made while building

**ES1 (2026-10-17):**
- `@import`s are returned for the service to fetch and scope, not hoisted (ES-D5): hoisted
  unscoped, an imported sheet would style the admin. ES2's service fetches each one (a
  sheet of its own, placed before the sheet that imports it) and leaves out one it cannot
  fetch.
- A template's inline styles resolve relative `url()`s against the entry's page address,
  where the page's browser resolves them, not against the template file (ES-D6).
- The page frame is dropped from root rules (ES-D6a, new).
- Keyframes get a per-look prefix, found during the review: hoisted as they were, a site
  `@keyframes` named like an admin one replaced it while the editor was open (ES-D5).
- The page's template choice now remembers each file that was not a template, rather than
  one layout and one folder: an entry whose layout is fine is no longer sent to the default
  because another file of its folder was broken. Otherwise unchanged.
- For ES2: an id copied into the rebuilt wrapper is left off when the admin page already
  has an element with that id, so the admin's own `getElementById` keeps working.

**ES2 (2026-10-17):**
- The body is found by `data-arc-bind="key"` as well as `[innerHTML]="key"` (ES-D3), on any
  element that takes the value as content (not an image, link, frame, form field or `<time>`).
- The innermost template element's classes go on the `<tiptap-editor>` element, and the
  filled element's on the editable one, so `.wrapper > .body` and `.body > p` both match.
- Found in the browser check against Preview: the admin's link colour rule and the Bootstrap
  variables it sets on `.arc-admin` (`--bs-primary`, link colours, focus ring) reached the
  editor's body. Links in `.arc-site-look` are left out of the admin rule, and the look's
  root gets the page's values of those variables, read from `<html>`
  (`ADMIN_BOOTSTRAP_VARIABLES`, kept in step with admin-theme.css by a test).
- The editor's own table and structured block spacing are off under the look; the block is
  marked by an outline and its label instead, and table cell selection stays.
- The body editor runs to the editor card's edges (its padding kept in `--editor-area-pad`),
  since the template brings its own spacing.
- The editor's toolbar follows the page's width, not the window's (a container query): on a
  page under 820px wide, Close, Preview, Save as draft and the Live site differs notice show
  only their icons, named on hover and for screen readers. Reported during the browser check:
  with the side menu open, a window just over the phone size wrapped every label.
- Result of the browser check (xlm dev project, 1440px and 375px windows): every measured
  property of the body, paragraphs, headings, lists, links, tables and structured blocks
  matched Preview for the default template and both info layouts (121, 44 and 22 values).
  Left: TipTap's table view wraps a table and gives it a minimum width, so a column can
  differ by a pixel or two, and on a phone the column is a few pixels narrower because the
  editor card keeps a small margin. Typing, focus and switching the layout work; with the
  look's stylesheet on and off, 271 of 272 admin elements outside the editor were unchanged
  (the editor's own container changed height).

**ES3 (2026-10-17):**
- A custom field is looked for by its key, then by its name without the type slug
  (`events-agenda`, then `agenda`), as the page's data aliases it; never `content`, which
  is the body's (`fieldNames`).
- The wrappers are built by one function (`buildLookWrappers`, site-look-view.ts) for the
  editor and for `arc-site-look-view`, the read-only view the version preview uses. The
  preview uses the layout the entry has now.
- Found in the browser check: at a small window the version preview squeezed the version
  into a column about 130px wide beside its details (true before this work too). Under 720px
  of preview width the details now go under the version (a container query), and the
  preview's header buttons keep their words on one line.
- A rich text field's box is taller with the look (360px instead of 200px), since the
  template's own spacing takes room in it; Expand still opens it full screen.
- Browser check: the version preview matched Preview on 110 values (width left out: the
  preview column sits beside the details), and the fullscreen editor, opened in the dialog
  layer with a field given the body's look in memory, on 121 (the same table cell 2px).
  The dev project has no type with a rich text field and no shipped template places one
  outside a loop, so a field's own box was checked by the unit tests only.

**Review of the whole feature (2026-10-17, asked for before merging):**
- The editor's selection menu (ngx-tiptap's bubble menu) is put by TipTap beside the
  editable element, which is inside the look: it took the site's font, and a site rule on
  `button` or `div` could restyle it. The editor now tells it (TipTap's `updateOptions`
  meta, `appendTo`) to show in the editor's own wrapper, outside the look. The `/`, emoji
  and mention menus already go to `document.body`.
- A browser without `@scope` would drop every rule of the look and leave the editor with
  neither the site's styles nor its own: the service now gives no look there
  (`supportsScope`).
- The page-frame filter dropped `overflow-wrap` with `overflow`; it now drops only the
  frame properties themselves.
- The docs said every rule stays inside the editor; fonts, `@property` and `@layer` order
  are page-wide, and say so now.
