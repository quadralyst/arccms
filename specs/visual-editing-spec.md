# Visual Editing: Build Spec (VE)

**Status:** SPEC, agreed in discussion 2026-11-17. VE1 and VE2 built 2026-11-18 (live preview window,
`/admin/preview/:type/:id`, and types without pages previewed where their cards show); VE3 to VE5
not built. Notes from the build: the preview window is
opened with `window.open('', name)` then pointed at its address, so an open one is brought forward
without a reload; a browser that blocks the pop-up gets a message in the editor. The Phone toggle
frames the page in a 390 px column; the site's own phone layout still follows the window width.
VE2: a type shown only in the header or footer previews as the header and footer around an empty
body (the cards are what change), not a particular content page.
**Branch:** `feat/visual-editing`, cut from `dev`, in a worktree (`../arccms-visual-editing`), so the
main checkout and its running dev server are never switched.

**The job:** editors who are not technical find content editing convoluted. The body is written
in one place, custom fields are filled in a side panel, and the page is only seen as a whole
after pressing Preview, which opens a copy that does not change until the next save. They want
to see the page in the template and layout the site was designed with, and to change it there.

After this work:
1. **Preview is live**: the preview window updates as the editor types, with nothing saved first.
2. **Types without pages preview where they show**: a testimonial previews on the home page.
3. **Admins can edit on the page**: a strip on the published site leads to an edit screen that
   looks like the page, where text, images and fields are changed in place.
4. **Repeating rows** (FAQ, gallery, info cards and the rest) are edited in place too.
5. **The home page is editable**: its card blocks in place, and fixed text, images and links that
   the developer marks as editable.

**Agreed (2026-11-17):**
1. **The form editor stays, unchanged in what it does.** The edit-on-page screen is an
   alternative view of the same draft. Both read and write exactly the same entry data
   (`IDraftContents`, its `customFields` and its translations). No data migration, ever.
2. **Preview stays in its own window**, not beside the form: on a laptop the form and the page do
   not both fit. On a wide screen the editor places the two windows side by side.
3. **Editors work mainly on desktop.** The edit-on-page screen targets desktop; the form editor
   remains the way to edit on a phone.
4. **Templates do not rely on scripts** today. Home pages may (animation), see VE-D17.
5. **No block or page builder.** Editors change content inside the design; they never arrange
   sections or change the layout.
6. Every phase ends with the docs updated, tests added, `npm run gate` green, and a critical
   review of that phase with its critical, high and medium findings fixed.

**Out of scope:** editing on a phone; editing the header and footer in place (VE-D20); list pages
in place (a list shows entries, each edited on its own page); running template scripts on the
edit screen; the email editors; scheduled publishing; any change to how pages are published,
other than the strip, the page text of VE5 and the entry marker of VE-D11.

---

## 0. Decision log

| # | Decision | Choice |
|---|----------|--------|
| VE-D1 | How the preview window gets the editor's data | **A `BroadcastChannel` named for the editor session** (same origin, so no `postMessage` window reference is needed, and either window can reload). The editor sends its unsaved state about 150 ms after the last change; the preview renders it. Nothing is saved for a preview. |
| VE-D2 | What the editor sends | **The draft exactly as a save would write it**: the output of `buildDraftFormValues()` (default-language base document, `customFields`, layout, author, references, next/previous, tags with colours), plus the language on screen and, when it is a translation, that language's unsaved translation values. One shape for saving and previewing means the preview can never show something a save would not store. |
| VE-D3 | Where the preview renders | **A full-screen route, `/admin/preview/:type/:id`** (`new` as the id before the first save), outside the admin shell: listed explicitly in `app.routes.ts` ahead of the `admin` parent (file-based admin routes render "Content Not Found"). Hosting has no static file at that address, so it always shows the draft. Today's `/{type}/{slug}?preview=true` on the live site is served the published static file first and shows the old version; that address keeps working for old links but the editor no longer opens it. Guard: the same roles as `/admin/contents/:slug/edit/:contentId`. **Although its address starts with `/admin`, the app treats it as a public page**: `SiteStylesService` turns the site sheets on (it keeps them off in the admin because they share class names), and the site header and footer are drawn. No admin chrome is on screen, so nothing clashes. |
| VE-D4 | How the page is drawn | **By the same code the site uses**: the data-building half of `ContentDetailComponent.hydrateAndSetTemplate` becomes a pure function, `detailPageData(...)`, which the detail page and the preview both call, and the preview hosts `ContentDetailComponent` with its data coming from the channel instead of Firestore (a third source beside published and `?preview=true`). The component reads its type, slug and preview flag from the route snapshot today; those move behind an injectable `DetailSource`, whose default reads the route as now. Header, footer, site CSS, layouts, loops, related entries, author box and other types' cards all come along. |
| VE-D5 | One window per entry | **`window.open(url, 'arc-preview-{type}-{id}')`**, so pressing Preview again brings the same window forward. The editor session key travels in the address fragment (`#s=…`), never sent to a server. |
| VE-D6 | When the editor goes away | **The preview keeps the last data it had** and its strip says "Editor closed". Opened on its own (a bookmark, a reload with no editor), it loads the saved draft once, as `?preview=true` does today. When an editor for the entry appears, it asks for the current state and carries on live. Two editors open on the same entry: the last message wins; the existing save conflict check still guards the data. |
| VE-D7 | Field markers | **Preview and edit modes only, the renderer marks every element a value filled**: `data-arc-field="key"` on elements filled by `data-arc-bind`, `[innerHTML]` and `[attr]` (with `data-arc-field-attr="href"` for an attribute); each `{{ key }}` in text becomes `<span data-arc-field="key">…</span>`; loop rows get `data-arc-field="faq" data-arc-row="2"`. A `markFields` option on the app's `TemplateHydrationService`, **off by default**: with it off the output is byte-identical to today's, which a test asserts against the shipped templates. Published pages never carry markers; the functions copy of the service is not changed for this. |
| VE-D8 | Click to field across two windows | **Clicking a marked element in the preview sends `{ focus: key, row? }`**; the editor opens the tab holding that field, scrolls to it, focuses it and flashes it. Browsers do not let a page bring another window forward, so the preview shows a short note, "Price is ready in the editor", and the cursor waits there. **Focusing a field in the editor** sends `{ highlight: key }`; the preview scrolls to it when it is out of view and outlines it for two seconds. |
| VE-D9 | The preview's own behaviour | Scroll position is kept across updates. Links open in a new tab instead of moving the window. Forms (sign-up, contact) are shown but do not submit. A Phone width toggle frames the page at 390 px; otherwise the window's own width is the page's width. A thin strip at the top: "Draft preview, updating live", the language, Phone/Full width, and Connected / Editor closed. |
| VE-D10 | Types without pages (`hasPublicUrl === false`) | **They preview on the page that shows them**: the home page when `home.html` has a card block for the type, else any content page when the header or footer has one (found with the existing `cardBlockTypes`). The page is drawn with the draft in place of the published entry (or inserted where the type's order would put it, for one never published), scrolled to it and outlined. When no page shows the type, the preview is the card row alone, drawn by its `partials.html` with the type's other published entries beside it. |
| VE-D11 | Telling the strip which entry a published page is | **A `<meta name="arc-entry" content="{type}/{id}">`** in the head of content pages, written by the publish pipeline. It names no person and no draft state, and lets the strip link by id. A published entry has the same document id as its draft (the editor relies on this for History), so the id opens the draft. List pages get `content="{type}"`, the home page `content="home"`, static pages `content="p/{name}"`. |
| VE-D12 | How the published site knows an admin is looking | **A flag in `localStorage` (`arc_editor_strip`) set by the admin app** on sign-in for a person the editor's route lets in, and removed on sign-out and when that role is lost. `arc-site.js`, already on every published page, reads it and draws the strip. No Firebase SDK, no network request and no change for visitors. The flag only shows links: the edit screen checks the person's role as every admin page does, so a hand-set flag gets nowhere. |
| VE-D13 | What the strip on a published page offers | **Links only**: Edit this page, Back to admin, and on a list page Add {type}; from VE5, Edit home page. A close button hides it for the tab. Draft status and Publish live on the edit screen's strip (VE-D14), which has the draft loaded: showing them on the static page would mean loading the Firebase SDK for every admin page view. This narrows the 2026-11-17 note "Publish on the strip": Publish is on the strip of the edit screen. Drawn in a shadow root, so site CSS and the strip's CSS never touch. Hidden when printing. |
| VE-D14 | The edit-on-page screen | **`/admin/edit/:type/:id`**, full screen, the page drawn as on the site in a same-origin frame that loads the preview route of VE-D3 in edit mode (so site CSS stays inside the frame and cannot reach the admin's), with a strip on top: draft status (Saved / Saving / Not saved, as the form editor says it), language, Phone/Full width, **Form** (switches to the form editor for the same entry, saving first), Page settings, Publish, Close. |
| VE-D15 | Shared saving | **Before any page editing exists, the form editor's draft logic moves out of `create-content.component.ts`** into an `EntryDraftSession` service: load, auto-save, conflict detection (Reload theirs / Keep mine), translations stash, required-field check on Publish, `[Replace:` check, publish and its status line. The form editor uses it with no change in behaviour (its existing 3,900 lines of specs stay green), then the edit screen uses the same service. Two screens, one set of rules. |
| VE-D16 | What is edited in place, and how | Text fields, title, summary: typed in place as plain text. Body and richtext fields: the existing TipTap editor mounted on the element. Image fields and cover: click for the media picker, with Replace / Remove. Number, date, dropdown, radio, checkbox, boolean, colour, icon, file, references: a small popover on the element. Values in attributes (`href="{{ link }}"`): a popover on the element. Anything not on the page (address, SEO, tags, author, layout, next/previous, fields the template does not place): the Page settings drawer, with "Show all fields" opening the form. |
| VE-D17 | What is shown but not editable | Values the site computes or fetches: published date, reading time, author box, `ref_` copies, related entries, share links, other types' cards (`data-arc-items-src`), site info. Hovering shows where to change it ("Change the author in Page settings"). The header and footer are dimmed. Template and home page scripts do not run on the edit screen; animated sections show in their resting state. |
| VE-D18 | Empty fields | **On the edit screen, an element removed by `data-arc-if` because a field is empty is kept as a faint placeholder** ("Add ticket price"), when the key is a field the editor fills. Keys the site computes (`hasRelated`, `author.name`) behave as on the page. |
| VE-D19 | Template hints | Optional, all defaulted, so every template works unchanged: `data-arc-label="Ticket price"` (placeholder and popover title, else the field's label), `data-arc-placeholder="e.g. 25"`, `data-arc-locked` (shown, never edited in place). Removed from published pages. |
| VE-D20 | Header and footer | **Not edited in place** in this work. They are site-wide files a developer writes; a change there reaches every page and needs a republish of the whole site. A later spec can extend VE5's page text to them. |
| VE-D21 | Home page card blocks | On the home page edit screen a card is edited in place like an entry; it saves that entry's draft. Add creates a draft of that type in the block; Remove unpublishes (never deletes) after asking; reorder is offered only for a type in its own order, and saves as Arrange does. One Publish button publishes every changed card and the page text together, saying how many changes. |
| VE-D22 | Page text (`data-arc-edit`) | **A developer marks a spot in `home.html` or a static page (`/p/{name}`)**: `<h1 data-arc-edit="hero-heading">Lessons for the whole family</h1>`. The text in the file is the default. Kind from the tag: `img` an image, `a` a link (text and address), anything else plain text; `data-arc-edit-kind="rich"` allows bold, italic and links. Stored per page and language in a new `SitePageText/{pageId}` document (`home`, `p-{name}`), written by the people who may edit drafts, read by anyone (the values are on the public page anyway). Filled on publish by `deployHomePage` and `deployStaticPage`, and in the app by the same pure function, `applyPageText`, after `data-arc-t` strings, so an edited value for a language wins over a translation, which wins over the file. As with `content-cards.ts`, the app copy (`src/app/core/utils/page-text.ts`) is the source of truth and `functions/src/shared/page-text.ts` its mirror, with a spec that runs both on the same cases. Text escaped; rich text through an allow-list written for it (`b`, `strong`, `i`, `em`, `br`, `a[href]`, nothing else, no attributes but `href`), since the renderer's `sanitizeHtml` is only basic; images and links limited to `http(s)`, root-relative, `mailto:` and `tel:`. Values for a key the file no longer has are kept and listed in the drawer as unused. |
| VE-D23 | Who may edit page text | **The same people who may edit drafts**, by the same rule. |
| VE-D24 | Feature switch | **Part of the Content feature (`content`).** No new switch: with content off there are no pages to edit, and the strip is not drawn. |
| VE-D25 | Admin language | Every new admin string is a translation key (`npm run i18n:keys`), as the rest of the admin. |

### Non-goals

- A second data model for page editing: there is one draft, edited two ways.
- Inline editing of list pages, the header or the footer.
- Pixel layout control (moving, resizing, restyling elements).

---

## 1. Current state

| Piece | Where | Today |
|-------|-------|-------|
| Editor | `src/app/pages/admin/contents/create-content/create-content.component.ts` (3,670 lines), routes `/admin/contents/:slug/add` and `/admin/contents/:slug/edit/:contentId` | Body in TipTap with the page's look (ES1 to ES3); title, cover, custom fields, SEO in tabs and a side panel. Draft built by `buildDraftFormValues()`, auto-saved, translations stashed per language. |
| Preview | `navigateBySlug()` in the editor | Saves, then opens `/{type}/{slug}?preview=true` in a new tab each time. |
| Detail page | `src/app/pages/page.parts/content-detail.component.ts` | Loads the published entry, or the draft with `?preview=true`; `hydrateAndSetTemplate` builds the data and fills the template. |
| Renderer | `src/app/core/services/template-hydration.service.ts` (app), `functions/src/shared/template-hydration.ts` (publish) | Two copies kept in step by tests. |
| Card blocks | `functions/src/pages/card-blocks.ts` (`cardBlockTypes`), `src/app/pages/page.parts/content-partials.component.ts` | Home page and header/footer cards of a type, from `partials.html`. |
| Home page | `src/custom/site/home.html`, `functions/src/pages/deployHomePage.ts`, `src/app/pages/index.page.ts` | A developer's whole HTML file; editors change only card blocks, by editing entries. |
| Published page script | `public/assets/js/arc-site.js` (45 KB), added by `liveSiteScript` to content, list, home and static pages | Sign-up and contact forms, consent, visitor session. |

---

## 2. Phases

Each phase is its own set of commits on `feat/visual-editing`, merged to `dev` only with the full
suite green and the docs updated. Task codes are VE{phase}.{n}.

### VE1: Live preview window for content pages

The preview window updates as the editor types, and clicking the page finds the field.

| Task | What |
|------|------|
| VE1.1 | `detailPageData(...)`: the pure data-building half of `hydrateAndSetTemplate`, used by `ContentDetailComponent` with no change in output. Spec: the same entry gives the same data before and after. |
| VE1.2 | `markFields` option on the app's `TemplateHydrationService` (VE-D7). Spec: off gives byte-identical output for every shipped template and a fixture of each binding kind; on marks binds, attributes, `{{ }}` text and loop rows. |
| VE1.3 | The channel: `preview-channel.ts`, pure message types (`state`, `hello`, `focus`, `highlight`, `bye`) and a small wrapper. Spec for each message and for an unknown or malformed one being ignored. |
| VE1.4 | Route `/admin/preview/:type/:id` (VE-D3), hosting `ContentDetailComponent` with channel data, markers on, scroll kept, links to a new tab, forms inert, strip (VE-D9). Falls back to the saved draft without an editor (VE-D6). |
| VE1.5 | Editor: Preview opens or focuses the named window (VE-D5), sends state 150 ms after a change and on `hello`, sends `bye` on leaving, handles `focus` (open the tab, scroll, focus, flash), sends `highlight` on field focus. Works for a new entry before its first save. |
| VE1.6 | Docs: `docs/features/content.html` (Preview), `docs/website/templates.html` (preview draws the same template), CHANGELOG. |
| VE1.7 | Browser check on the dev project: type in the title, body, a text field, an image field, a repeating field and a translation; switch layout; click the page to reach a field; close and reopen the editor; preview of a published entry shows the draft. |
| VE1.8 | Critical review of VE1, fixes, `npm run gate`. |

**Done when:** every field's change shows in the preview within half a second without a save, the
published output of every template is unchanged, and the suite is green. Frontend only: nothing to
deploy beyond the hosted admin.

### VE2: Preview for types without pages

| Task | What |
|------|------|
| VE2.1 | App-side `cardBlockTypes` (the app copy beside `content-cards.ts`, the functions one in `card-blocks.ts` its mirror, a spec comparing them) and a `wherePreviewed(type)` answer: home page, any page (header or footer block), or none (VE-D10). |
| VE2.2 | Preview route for such a type: draws the home page (or a content page) with the draft swapped in or inserted by the type's order, scrolls to it and outlines it. When the block's `count` would leave the draft out, it takes the last card's place and the strip says so. |
| VE2.3 | Fallback: the card row alone, from `partials.html`, with the type's other published entries. |
| VE2.4 | For a type with pages that also shows in a card block: the strip offers "Also on: Home page". |
| VE2.5 | Docs: `docs/website/editable-sections.html`, `docs/website/home-page.html`, CHANGELOG. |
| VE2.6 | Browser check with a hero type, a testimonials type, a footer partners type and a type placed nowhere. |
| VE2.7 | Critical review of VE2, fixes, `npm run gate`. |

### VE3: Admin strip and editing on the page

| Task | What |
|------|------|
| VE3.1 | `EntryDraftSession` service (VE-D15); the form editor moved onto it with no change in behaviour. Its existing specs stay green unchanged; new specs for the service itself. This lands and is reviewed on its own before any page editing. |
| VE3.2 | Spike, kept short: TipTap mounted on an element inside the same-origin frame (selection, toolbar, media picker, drop upload). Outcome written into this spec before VE3.5. If it cannot work, the fallback is the site-look scoping of ES-D2 on a page drawn in the admin document. |
| VE3.3 | Publish pipeline: the `arc-entry` meta (VE-D11) in content, list, home and static pages. Functions spec for each. |
| VE3.4 | `arc-site.js`: the strip (VE-D12, VE-D13) in a shadow root; the admin app sets and clears the flag. Specs for the flag's life and for the strip's links per page kind. |
| VE3.5 | Route `/admin/edit/:type/:id` (VE-D14): the frame, the strip, Form and back, Page settings drawer, Publish with the existing checks. |
| VE3.6 | In-place editing (VE-D16): plain text, TipTap for body and richtext, image picker, popovers for the other field types and for attribute values. Tab moves between editable spots in page order; Escape leaves a spot. |
| VE3.7 | Read-only values (VE-D17), placeholders for empty fields (VE-D18), template hints (VE-D19, removed on publish, functions spec). |
| VE3.8 | Languages: the language switch on the strip edits that translation; fields shared by every language are marked "Same in every language". |
| VE3.9 | Docs: `docs/features/content.html` (edit on the page, the strip), `docs/website/templates.html` (hints, what is editable in place), CHANGELOG. |
| VE3.10 | Browser check: strip on a published content page, list page and home page as an admin, absent as a visitor; edit every field kind in place, switch to the form and back, publish, conflict with a second tab. |
| VE3.11 | Critical review of VE3, fixes, `npm run gate`. |

**Deploy:** functions (publish pipeline), then hosting (`arc-site.js`), then Republish website so
every page carries the meta.

**Build note, VE3.1 (2026-11-18):** `EntryDraftSession` is in
`src/app/pages/admin/contents/draft-content-store/entry-draft-session.ts`, provided by the screen
that edits the entry (one per screen). It holds loading, the saved baseline, auto-save, the
conflict checks, the translations stash, the Save and Publish checks, the `[Replace:` question,
publishing with its status line and the live preview channel. A screen gives it an
`EntryDraftView`: how to read the language-varying values (`capture`), put them on screen
(`apply`), read everything else a save writes (`sharedValues`), show a loaded entry (`fill`), and a
few hooks (reveal a missing field, focus a field the preview asked for, the entry's first write).
The form editor implements it over its forms and keeps every member name it had, as accessors
onto the session, so its template and its 307 specs are unchanged. The edit-on-page screen of
VE3.5 implements the same interface over the page.

### VE4: Repeating rows and widths

| Task | What |
|------|------|
| VE4.1 | Rows of infocard, gallery, labelvalue, faq and maplocation edited in place: each row's text typed in place, its image or icon by picker, a hover bar with add below, remove (asks), move up and down. Section headings (`{key}_heading`) in place. |
| VE4.2 | Map rows: the address and pin in a popover with the existing map picker. |
| VE4.3 | Phone/Full width on the edit screen. |
| VE4.4 | Docs: `docs/features/content.html`, CHANGELOG. |
| VE4.5 | Browser check of every repeating type, empty and full, in two languages. |
| VE4.6 | Critical review of VE4, fixes, `npm run gate`. |

### VE5: Home page and static pages

| Task | What |
|------|------|
| VE5.1 | `applyPageText(html, values, lang)`, app copy and functions mirror (VE-D22), used by `deployHomePage`, `deployStaticPage` and the app's home and static page renderers. Specs for each kind, escaping, the link and image address rules, language fallback, a key missing from the file. |
| VE5.2 | `SitePageText/{pageId}` in core `firestore.rules`; rules tests (anyone reads, editors write, nobody else writes, shape checked). |
| VE5.3 | Publish queue: a page-text publish rebuilds that page (home in every language, or the static page). |
| VE5.4 | Edit screen for the home page and static pages (`/admin/edit/home`, `/admin/edit/p/{name}`): page text in place, card blocks in place (VE-D21), one Publish for all changes. |
| VE5.5 | Strip: Edit home page, Edit this page on a static page that has spots. |
| VE5.6 | Docs: `docs/website/home-page.html`, `docs/website/static-pages.html`, `docs/website/templates.html` (`data-arc-edit`), the data model and rules pages for `SitePageText`, CHANGELOG. |
| VE5.7 | Browser check: mark spots in a test `home.html`, edit text, an image and a link in two languages, add, remove and reorder cards, publish, check the published home page. |
| VE5.8 | Critical review of VE5, fixes, `npm run gate` (rules tests included). |

**Deploy:** functions (the targeted ones changed), firestore rules, hosting, then Republish website.

---

## 3. Risks

| Risk | Answer |
|------|--------|
| Markers change published pages | `markFields` is off by default and only the app copy has it; a byte-identical test over every shipped template (VE1.2). |
| Moving the editor's save logic breaks it | VE3.1 lands alone, with the existing editor specs unchanged and a browser pass, before page editing starts. |
| TipTap inside a frame misbehaves | VE3.2 spike before building on it, with a named fallback. |
| A long body makes the preview slow | Full re-render after a 150 ms pause; measured in VE1.7 on a 5,000-word entry. Updating only changed regions is added only if the measure says so. |
| The strip costs visitors | It is a few lines in the already-loaded `arc-site.js`, reading one `localStorage` key; nothing is fetched. |
| The preview route is under `/admin` but must look public | VE1.4 checks the layout's admin test (by address) and the site sheets explicitly, with a spec that the route gets header, footer and site CSS and the admin pages still do not. |
| Page text drifts from `home.html` | Values for keys the file no longer has are kept and listed as unused, never shown on the page. |

---

## 4. Open questions

None at the time of writing. The spike in VE3.2 may add one.
