# Visual Editing: Build Spec (VE)

**Status:** SPEC, agreed in discussion 2026-11-17. VE1 and VE2 built 2026-11-18 (live preview window,
`/admin/preview/:type/:id`, and types without pages previewed where their cards show). VE3.1
(the shared `EntryDraftSession`) built and the VE3.2 spike done 2026-11-18, see the build notes
under VE3; VE3.3 to VE3.10 built 2026-11-18 and 19, VE3.11 review done 2026-11-19 (VE3 complete, deploy pending); VE4 planned 2026-11-19 (VE-D30 to VE-D36, on `feat/visual-editing-ve4`, worktree `../arccms-visual-editing-ve4`); VE4 and VE5 not built. Notes from the build: the preview window is
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
| VE-D13 | What the strip on a published page offers | **Links only**: Edit this page, Back to admin, and on a list page Add {type}; from VE5, Edit home page. A close button hides it until the page is loaded again (changed 2026-11-18 from "for the tab": there was no way to get it back). Draft status and Publish live on the edit screen's strip (VE-D14), which has the draft loaded: showing them on the static page would mean loading the Firebase SDK for every admin page view. This narrows the 2026-11-17 note "Publish on the strip": Publish is on the strip of the edit screen. Drawn in a shadow root, so site CSS and the strip's CSS never touch. Hidden when printing. **Where (changed 2026-11-18):** a 40 px bar across the top, like the edit screen's strip, so going from the site to the editor feels like one place: it pushes the page down (`html` margin), moves elements pinned to the top of the window (fixed or sticky, top 0) below it, read again as the page scrolls, and sets `--arc-strip-height` for a template's own header. Shown only on a page with the `arc-entry` meta. The app's own site pages draw it too: `setArcEntry` loads `arc-site.js` with `data-parts="strip"` for an editor and calls `arcSite.drawEditorStrip()` as the page changes. |
| VE-D14 | The edit-on-page screen | **`/admin/edit/:type/:id`**, full screen, the page drawn as on the site in a same-origin frame that loads the preview route of VE-D3 in edit mode (so site CSS stays inside the frame and cannot reach the admin's), with a strip on top: draft status (Saved / Saving / Not saved, as the form editor says it), language, Phone/Full width, **Form** (switches to the form editor for the same entry, saving first), **Page settings** (opens the panel of VE-D26), Publish, Close. **Nothing of the admin around it** (agreed 2026-11-18): no side menu, no admin header, so the editor feels they are editing the page itself. Below the one-line strip the frame takes the whole window, edge to edge, so the page is seen exactly as in the preview; only the panel's handle (VE-D26) sits over the page's right edge. |
| VE-D15 | Shared saving | **Before any page editing exists, the form editor's draft logic moves out of `create-content.component.ts`** into an `EntryDraftSession` service: load, auto-save, conflict detection (Reload theirs / Keep mine), translations stash, required-field check on Publish, `[Replace:` check, publish and its status line. The form editor uses it with no change in behaviour (its existing 3,900 lines of specs stay green), then the edit screen uses the same service. Two screens, one set of rules. |
| VE-D16 | What is edited in place, and how | Text fields, title, summary: typed in place as plain text. Body and richtext fields: the existing TipTap editor mounted on the element, laid out as the page lays it out (2026-11-18: an empty line takes no room unless the cursor is in it, the page's own wrapping instead of TipTap's `break-spaces`; the caret goes on the clicked text; leaving puts the page back). Image fields and cover: click for the media picker, with Replace / Remove. Number, date, dropdown, radio, checkbox, boolean, colour, icon, file, references: a small popover on the element. Values in attributes (`href="{{ link }}"`): a popover on the element. Anything not on the page (address, SEO, tags, author, layout, next/previous, fields the template does not place): the Page settings panel (VE-D26), which holds every field. |
| VE-D17 | What is shown but not editable | Values the site computes or fetches: published date, reading time, author box, `ref_` copies, related entries, share links, other types' cards (`data-arc-items-src`), site info. Hovering shows where to change it ("Change the author in Page settings"). The header and footer are dimmed. Template and home page scripts do not run on the edit screen; animated sections show in their resting state. |
| VE-D18 | Empty fields | **On the edit screen, an element removed by `data-arc-if` because a field is empty is kept as a faint placeholder** ("Add ticket price"), when the key is a field the editor fills. Keys the site computes (`hasRelated`, `author.name`) behave as on the page. |
| VE-D19 | Template hints | Optional, all defaulted, so every template works unchanged: `data-arc-label="Ticket price"` (placeholder and popover title, else the field's label), `data-arc-placeholder="e.g. 25"`, `data-arc-locked` (shown, never edited in place). Removed from published pages. |
| VE-D20 | Header and footer | **Not edited in place** in this work. They are site-wide files a developer writes; a change there reaches every page and needs a republish of the whole site. A later spec can extend VE5's page text to them. |
| VE-D21 | Home page card blocks | On the home page edit screen a card is edited in place like an entry; it saves that entry's draft. Add creates a draft of that type in the block; Remove unpublishes (never deletes) after asking; reorder is offered only for a type in its own order, and saves as Arrange does. One Publish button publishes every changed card and the page text together, saying how many changes. |
| VE-D22 | Page text (`data-arc-edit`) | **A developer marks a spot in `home.html` or a static page (`/p/{name}`)**: `<h1 data-arc-edit="hero-heading">Lessons for the whole family</h1>`. The text in the file is the default. Kind from the tag: `img` an image, `a` a link (text and address), anything else plain text; `data-arc-edit-kind="rich"` allows bold, italic and links. Stored per page and language in a new `SitePageText/{pageId}` document (`home`, `p-{name}`), written by the people who may edit drafts, read by anyone (the values are on the public page anyway). Filled on publish by `deployHomePage` and `deployStaticPage`, and in the app by the same pure function, `applyPageText`, after `data-arc-t` strings, so an edited value for a language wins over a translation, which wins over the file. As with `content-cards.ts`, the app copy (`src/app/core/utils/page-text.ts`) is the source of truth and `functions/src/shared/page-text.ts` its mirror, with a spec that runs both on the same cases. Text escaped; rich text through an allow-list written for it (`b`, `strong`, `i`, `em`, `br`, `a[href]`, nothing else, no attributes but `href`), since the renderer's `sanitizeHtml` is only basic; images and links limited to `http(s)`, root-relative, `mailto:` and `tel:`. Values for a key the file no longer has are kept and listed in the drawer as unused. |
| VE-D23 | Who may edit page text | **The same people who may edit drafts**, by the same rule. |
| VE-D24 | Feature switch | **Part of the Content feature (`content`).** No new switch: with content off there are no pages to edit, and the strip is not drawn. |
| VE-D25 | Admin language | Every new admin string is a translation key (`npm run i18n:keys`), as the rest of the admin. |
| VE-D26 | The Page settings panel on the edit screen (agreed 2026-11-18) | **The form editor's own side panel, whole**: the Basic, SEO, Checks and History tabs with the same fields, wording and checks, on the same `EntryDraftSession` (VE-D15), so a change there shows on the page at once and there is one panel to maintain. **It slides over the page from the right and never pushes it aside**, so the page keeps the width a visitor sees; no grey cover, the uncovered page stays usable. It opens and closes from the strip's **Page settings** button, the handle, and Escape (closes), one state for all three; a click on the page does not close it. It keeps the width it was dragged to, as the form editor's panel does. **Closed when the screen opens; once the page is drawn with the draft in place, it peeks** every time the screen opens: about half a second later it slides out about 48 px, holds about a second, and slides back, skipped if the editor has already clicked or typed in the page, and no motion (the handle simply shows) when the computer asks for reduced motion. **The handle**: an arrow alone (‹ closed, › on the panel's left edge when open), drawn as a small raised button (about 24 by 48 px, halfway down, light shadow, a grip look) that sits over the page's right edge, just inside the frame's scrollbar so the scrollbar stays usable. Click toggles the panel; dragging it left pulls the panel out with the pointer, and on release it opens when pulled past a third of its width, else slides back; dragging the open panel's handle right closes it the same way. A real button for the keyboard and screen readers (expanded or not, controls the panel), with "Page settings" as its accessible name and tooltip. |
| VE-D27 | The selection menu (agreed 2026-11-19) | **One selection menu for both editors**: `SelectionMenuComponent` (`src/shared/components/tiptap-editor/selection-menu/`) holds the buttons the form editor showed in TipTap's bubble menu (text style, marks, quote, blocks and tables, lists, alignment, link, code, undo, redo; with a picture selected, Replace, Remove and alt text). The form editor shows it in the bubble menu as before; the Visual Editor shows it in a box in the admin document placed from the selection's coordinates plus the frame's position, above the text or below it when above would go under the strip, for a non-empty text selection only (a picture keeps its box, a placed field its card). The strip keeps its own buttons for when nothing is selected. Full width and Phone on the strip are a screen and a phone icon, named by their tooltip and accessible name. The strip's **Form** button (VE-D14) is named **Classic editor** (chosen 2026-11-19). |
| VE-D28 | Custom fields placed in the text (agreed 2026-11-19) | **A field's content stays in the field; the body holds a marker** `<div data-arc-place="{field key}"></div>` where an editor typed `/` and chose **Field: {name}**. Offered for `faq`, `gallery`, `infocard`, `labelvalue`, `maplocation`, `image`, `file` and `richtext`, in the body only, in the form editor and on the Visual Editor. One marker per field: placing it again moves it. In the editor the marker is a card: a **Field** tag, the field's name, **Edit** (opens the field: the form's jump, or Page settings on the Visual Editor), and what the field holds (a few lines in the form; on the Visual Editor the field as the page drew it). On the page, `field-places.ts` (app source, functions mirror, one spec for both) tags the template's block for the field before the template is filled (its outermost `data-arc-if`, else its loop, else its bind, by stored or short key; a plain block in the default template's classes when the template has none) and moves it into the marker after, so the field shows once, in the template's markup. **The FAQ text block goes**: the FAQ is the FAQ field, so a page sends one FAQPage, from the field; `/faq` finds the field, and on a type without one says an admin can add it under Content types. Old bodies with an FAQ block are ignored (they read as plain headings and paragraphs, no FAQPage); the Checks tab's Blocks rule counts FAQ field rows or a Key takeaways block. |
| VE-D29 | The panel scrolls (2026-11-19) | The form editor fills the Page settings panel's height, so its own list scrolls, and the panel's body clips (`overflow: clip`) so a jump to a field can never scroll it and push the tabs out of sight. A jump to a field (from the page, a card's Edit, the preview) scrolls the box that takes the cursor into view, not the middle of the field, so a tall field's first box shows. |
| VE-D30 | Marks inside rows (agreed 2026-11-19) | **On the edit screen only, each value inside a row of a repeating field is marked** with its field, its row's id and its sub-field (`data-arc-field="faq" data-arc-row-id="{row id}" data-arc-sub="question"`), beside the row's own mark of VE-D7, which also gains `data-arc-row-id`. Rows are found by id, never by place, so a translation (whose rows are matched by id) and a reorder can never edit the wrong row. Values the site works out from a row point back to what is stored: `answer_html` to `answer`; `map_embed`, `map_directions` to the location; `video_thumb`, `video_embed` to the gallery's media. A file field's rows stay a panel spot. `{key}_heading` is its own plain text spot writing `customFields["{key}_heading"]`, not the repeating field. With `markFields` off the output is byte-identical to today's (the VE1.2 test is extended to rows). |
| VE-D31 | Row text and pictures in place (agreed 2026-11-19) | **Every text sub-field is typed in place**: headline, info, caption, label, value, name, question, and section headings (an empty heading shows its schema placeholder, such as "Frequently asked questions"). The FAQ answer is typed in place as plain text over several lines, a blank line between paragraphs, as it is stored today (no rich text, no data change); while it is typed the element shows the stored text, and the page draws `answer_html` again when it is left. On the edit screen every FAQ `<details>` is open and a click on its `summary` does not fold it. **Pictures**: an info card's picture or icon opens the picker with images and icons (Replace, Remove); a gallery item's photo opens a small box: Replace photo, Use a YouTube video (a link box with the form's YouTube check), Remove. One visual per row, as `setMedia` keeps it. |
| VE-D32 | The row bar (agreed 2026-11-19) | **Hovering a row, or a spot in it having the focus, shows a small bar at the row's top right**: Add after, Move (two arrows), Remove. Drawn in the admin document from the row's position plus the frame's (as VE-D27), so site CSS never reaches it, and it follows the page as it scrolls. **Add after** inserts a blank row after this one and opens its first text spot with the cursor; on a gallery it opens the picker with several photos allowed and adds one item per photo, after this one. **Move** arrows point up and down when the rows stack, left and right when the next row sits beside this one (read from their positions), and move the row one place; the first row has no "before", the last no "after". **Remove** takes the row away at once and shows "{Row} removed" with **Undo** for about eight seconds; a row with nothing in it goes with no note. Order is written as the form editor writes it: positions renumbered 1 to n, row ids kept. A row whose outer element has no box of its own (`display: contents`) is placed by the union of its children's boxes. |
| VE-D33 | Empty lists and new blank rows (agreed 2026-11-19) | **An empty repeating field the template places shows "Add the first {row}"** ("Add the first question"), in the admin's language: on the edit screen the renderer keeps an emptied loop container as `data-arc-empty-loop="{key}"` (as `keepEmpty` does for `data-arc-if`), and inside a kept empty section the same line shows. A click adds the first row (on a gallery, opens the picker). **A blank row is drawn on the edit screen** with its placeholders, so Add after shows something to type in, but saving still drops fully blank rows (`prepareRepeaterRowsForSave`), so an abandoned one never publishes. A field the template does not place stays in Page settings only. |
| VE-D34 | Map rows (agreed 2026-11-19) | **The name is typed in place; a click on the map or the address opens a box with the existing map picker** (`MapPickerComponent`: search, drag the pin), which writes the address, latitude, longitude and zoom together, as the form does, and Remove clears them. The directions link is worked out and only points back to the location. |
| VE-D35 | Rows in a translation (agreed 2026-11-19) | **Rows are added, removed and arranged in the default language only**, as the form editor locks them. In a translation the bar is hidden and a hover on a row says "Add and arrange rows in {default language}". Translatable text (every text sub-field, the heading and the map address text) is typed in place into that language's row, matched by row id; empty, it shows the default language's text faintly. Pictures, icons, videos and the map pin are marked "Same in every language" (VE3.8). |
| VE-D36 | Rows over a template's limit, and placed fields | A loop with `data-limit` shows only its first rows; the others are reached in Page settings, and Add after on the last shown row still adds after it. Rows of a field placed in the text (VE-D28) are edited in place the same way while the body is not being typed in; while it is, the field's card and its Edit button stand for it. |

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
| VE3.5 | Route `/admin/edit/:type/:id` (VE-D14) outside the admin shell, listed in `app.routes.ts` like the preview route: the full-window frame, the strip, Form and back, the Page settings panel with its peek and handle (VE-D26), Publish with the existing checks. Specs for the panel's state (button, handle click and drag, Escape), the peek's skip and reduced-motion cases. |
| VE3.6 | In-place editing (VE-D16): plain text, TipTap for body and richtext, image picker, popovers for the other field types and for attribute values. Tab moves between editable spots in page order; Escape leaves a spot. |
| VE3.7 | Read-only values (VE-D17), placeholders for empty fields (VE-D18), template hints (VE-D19, removed on publish, functions spec). **Built 2026-11-18:** the app renderer's `keepEmpty` keeps a `data-arc-if` element as `data-arc-empty` on the Visual Editor only (the frame's `?edit=1`, `DetailSource.editing`), for keys `resolvePreviewField` knows; `in-place.ts` gives empty spots `data-arc-ph` ("Add {label}"), makes a kept element with nothing to click its field's spot, titles values the site works out by kind, honours the three hints, and the frame dims `arc-header`/`arc-footer`. Both renderers drop the hints from every other page. |
| VE3.8 | Languages: the language switch on the strip edits that translation; fields shared by every language are marked "Same in every language". **Built 2026-11-18:** the strip's language buttons call the form editor's `switchLanguage` (one session, VE-D15), the frame redraws in that language; `InPlaceHost.shared` locks what `isTranslatableField` / `TRANSLATABLE_BUILTIN_FIELDS` leave out (rows still open the panel, which locks what it must); `strip_*` strings reach `arc-site.js` with the panels' strings. |
| VE3.9 | Docs: `docs/features/content.html` (edit on the page, the strip), `docs/website/templates.html` (hints, what is editable in place), CHANGELOG. |
| VE3.10 | Browser check: strip on a published content page, list page and home page as an admin, absent as a visitor; edit every field kind in place, switch to the form and back, publish, conflict with a second tab. |
| VE3.11 | Critical review of VE3, fixes, `npm run gate`. **Done 2026-11-19:** four reviews (publish and site, draft session, Visual Editor, TipTap); the high and medium findings fixed (see CHANGELOG, Fixed); the low ones listed in the build note below. |

**Deploy:** functions (publish pipeline), then hosting (`arc-site.js`), then Republish website so
every page carries the meta.

**Build note, VE3.11 (2026-11-19), low items left:** the strip on pages the app draws shows English when no site strings are loaded; a content type slugged `home` or `p` confuses the strip's links; the strip's pinned-header check reads every element's style while scrolling; a selected field card can be replaced by Insert block or table (undo brings it back); a pasted or copy-dragged card can give a field two markers (published once); a map in a card loads its frame again on a redraw; a marker can be pasted into a rich text field outside the body; switching language twice quickly can apply the first; work that finishes after the screen closes still refreshes it; the field box does not follow the page as it scrolls; Publish and Close can scroll off the strip on a phone.

**Build note, after VE3.10 (2026-11-19):** the panel scroll fix (VE-D29), the shared selection
menu (VE-D27) and fields placed in the text (VE-D28) on `feat/field-markers`. The publish side
changes (`deployContentPage` uses `field-places.ts`; `content-blocks.ts` no longer reads FAQ
blocks), so the end-of-VE3 functions deploy includes `processPublishQueue` and every function that
builds a content page.

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

**Build note, VE3.4 to VE3.6 (2026-11-18):** the strip is `drawEditorStrip` in `arc-site.js`; the
admin app writes `arc_editor_strip` from the auth store (`rememberEditorStrip`, for
`ENTRY_EDITOR_ROLES` with Content on) and the route uses the same roles. A list page's link reads
**Add new**: the page names only the type's slug, not its name. The edit screen
(`src/app/pages/admin/edit/entry-edit.page.ts`) hosts the form editor in page mode as the Page
settings panel (`pageMode`, `pageHooks`), so that editor owns the `EntryDraftSession` and the panel
is literally the form editor's; it loads the content types itself, being outside the admin shell.
The panel's state is `PagePanel`. In place (`in-place.ts`): `spotInfo` decides what a marked element
edits, `InPlaceEditing` runs on the frame's document; while a spot is typed in the session holds
the preview (`holdPreview`), so the page is redrawn only when the spot is left. A box for a field
moves the form editor's own `#req-{key}` control onto the page and back, so every field type has
its own wording and checks there. Spike fixes: TipTap's style is copied into the frame; caret menus
are offset by the frame (`caret-rect.ts`); the extension list is `editorExtensions` with per-editor
pickers (`ArcPickers`); the strip's buttons read the editor's state from its `transaction` event.
The app's fade-in on content components is off in the edit frame, which redraws often.

**Build note, VE3.3 (2026-11-18):** one place writes the meta: `arcEntry` and
`arcEntryMetaTag` in `functions/src/shared/html-document.ts`. Content and list pages pass
`PageMeta.entry` to `buildHtmlDocument`; the home page and static pages, which keep their own head,
call `setArcEntryMeta`, which replaces one the file brought. Static pages are published in the
default language only, so they carry one. The app's own renderers set head tags too, so the
detail, list, home and static page components set the same meta through
`src/app/core/site/arc-entry.ts` (the same values, compared by a spec) and remove it when the page
is left; inside the live preview (VE-D3) it is not set. Pages already published get it at the next
Republish website, after the functions deploy.

**Build note, VE3.2 spike (2026-11-18): TipTap in the frame works; the ES-D2 fallback is not
needed.** Run in the browser on the dev project, against the form editor page, with no code kept:
the preview route of VE-D3 loaded in a same-origin `iframe`, and a second TipTap `Editor` (the
body editor's own class and configured extensions, so the same upload handler) created in the
admin document with `element` set to the frame's `[data-arc-field="content"]` element.
- **Works as it is.** ProseMirror reads selection and events from the element's own document
  (`view.root` is the frame's document), so typing, mouse selection, undo and the keymaps work,
  drawn with the site's CSS. Buttons in the admin document (Bold, Heading) act on the frame's
  selection and give focus back to it, as long as they keep focus off themselves
  (`mousedown` → `preventDefault`). The media picker opens in the admin document and inserts at
  the frame's cursor. Drop and paste upload work with files from the frame's own realm (a real
  drop into a frame gives such a `File`, which fails `instanceof File` in the admin document):
  nothing on the upload path checks the realm, Firebase Storage included; the placeholder shows
  while uploading and the image goes in with its library URL.
- **To build in VE3.6.** (1) TipTap adds its base CSS (`style[data-tiptap-style]`, with
  `white-space: pre-wrap` for `.ProseMirror`) to the admin document only: add it to the frame's
  head too, or the frame collapses spaces. (2) Menus placed at the caret by `tippy` in
  `document.body` (slash commands, emoji, the selection bubble menu) open in the admin document
  at the frame's coordinates, off by the frame's position: give them a reference rect offset by
  the frame's `getBoundingClientRect()`, or keep the formatting buttons on the strip and draw the
  slash and emoji menus inside the frame. (3) The editor's extension list lives inside
  `TiptapEditorComponent.initializeEditor()`, and the component sets `window.uploadImage` and
  `window.attachFile` for its own editor: factor the list into a function both use, and give
  Insert image and Attach file the editor they act on, so two editors on one screen never mix.
  (4) The selection reaches the editor's state on the frame's `selectionchange`, a tick after the
  mouse: read the state from editor events, not straight after a click.

### VE4: Repeating rows

The rows of infocard, gallery, labelvalue, faq and maplocation fields are edited on the page
(VE-D30 to VE-D36). Planned 2026-11-19. Phone and Full width on the edit screen, first listed
here, were built in VE3 (the strip's icons, VE-D27); VE4.7 checks them. Frontend only: nothing
to deploy beyond the hosted admin.

| Task | What |
|------|------|
| VE4.1 | Marks inside rows (VE-D30): row id and sub-field on each value, site-made row values pointed at what is stored, `{key}_heading` as its own spot, `data-arc-empty-loop` for an emptied loop and blank rows drawn on the edit screen (VE-D33). Specs: `markFields` off byte-identical with rows; on, every repeating type's values marked; `spotInfo` for each sub-field and heading. |
| VE4.2 | Row text in place (VE-D31): every text sub-field and heading, the FAQ answer over several lines with its `<details>` open, writing the row by id in the default language and in a translation (VE-D35). Specs for each type and for the translation's row being written. |
| VE4.3 | Row pictures (VE-D31): info card picture or icon by the picker, gallery photo or YouTube video in a small box, Remove; "Same in every language" in a translation. |
| VE4.4 | The row bar (VE-D32): Add after, Move with arrows that follow the layout, Remove with Undo, gallery Add after by the picker, "Add the first {row}" (VE-D33), hidden with its hint in a translation (VE-D35). Specs for order and positions after each action, row ids kept, Undo, the arrows' direction, a blank row not saved. |
| VE4.5 | Map rows (VE-D34): the map picker in a box on the map or address, the pin shared in a translation. |
| VE4.6 | Docs: `docs/features/content.html` (rows on the page), `docs/website/templates.html` (what a row needs to be edited in place: one outer element per row), CHANGELOG. |
| VE4.7 | Browser check on the dev project: every repeating type, empty and full, in two languages; add, move, remove and Undo; a placed field's rows; Phone and Full width. |
| VE4.8 | Critical review of VE4, fixes, `npm run gate`. |

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
| A row edits the wrong row (VE4) | Rows are found by id, not by place (VE-D30), so a reorder or a translation's sparse rows never shift the target; specs move a row and type in a translation. |
| Templates whose rows are not one clean element (VE4) | The loop repeats its first child, so a row is always one element; one with no box is placed by its children (VE-D32); a value shown twice in a row edits the same value; the docs say what a row needs. |
| A new row vanishes from the page (VE4) | The page is drawn from the save shape, which drops blank rows: the edit screen draws them, saving still drops them (VE-D33). |
| Row order or data changes for existing entries (VE4) | Order is written exactly as the form editor writes it (positions 1 to n, ids kept); no new field, no migration. |

---

## 4. Open questions

None. The VE3.2 spike (2026-11-18) added none: TipTap works in the frame, see its build note under VE3.
