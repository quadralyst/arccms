# Visual Editing: Build Spec (VE)

**Status:** SPEC, agreed in discussion 2026-11-17. VE1 and VE2 built 2026-11-18 (live preview window,
`/admin/preview/:type/:id`, and types without pages previewed where their cards show). VE3.1
(the shared `EntryDraftSession`) built and the VE3.2 spike done 2026-11-18, see the build notes
under VE3; VE3.3 to VE3.10 built 2026-11-18 and 19, VE3.11 review done 2026-11-19 (VE3 complete, deploy pending); VE4 planned 2026-11-19 (VE-D30 to VE-D36, on `feat/visual-editing-ve4`, worktree `../arccms-visual-editing-ve4`); VE4 built 2026-11-19 (groups 1 to 3, VE-D37 Done and Cancel added on the way, the end-of-VE4 review done, `npm run gate` green); not merged or deployed; VE5 planned 2026-11-19 (VE-D38 to VE-D57, on `feat/visual-editing-ve5`, worktree `../arccms-visual-editing-ve5`); VE5 group 1 (VE5.1 to VE5.3) built 2026-11-19 with its review (07b9433b); group 2 (VE5.4, VE5.5) built 2026-11-19 (cd870451); VE5.6 built 2026-11-19 (d15cf1dc); VE5.7 and VE5.8 built 2026-11-20 with the end-of-group-3 review (not committed); not merged or deployed; group 4 not built. Notes from the build: the preview window is
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
5. **The home page and static pages are editable**: areas the developer marks in the file are
   edited in a classic editor of their own (Content, More Pages) and on the page in the Visual
   Editor, and the home page's card blocks are edited in place.

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
in place until VE6 (planned 2026-11-24, VE-D58); running template scripts on the
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
| VE-D21 | Home page card blocks | Replaced 2026-11-19 by VE-D53 (one Publish) and VE-D54 (cards in place). |
| VE-D22 | Page text (`data-arc-edit`) | Replaced 2026-11-19 by VE-D38 to VE-D47: the marking stays as written here (`data-arc-edit="key"` in `home.html` or a static page, the text in the file the default), but values now have a draft and a published copy (VE-D39), are filled in a fixed order per language (VE-D43), and remember the file's text (VE-D45). |
| VE-D23 | Who may edit page text | **The same people who may edit drafts**, by the same rule. |
| VE-D24 | Feature switch | **Part of the Content feature (`content`).** No new switch: with content off there are no pages to edit, and the strip is not drawn. |
| VE-D25 | Admin language | Every new admin string is a translation key (`npm run i18n:keys`), as the rest of the admin. |
| VE-D26 | The Page settings panel on the edit screen (agreed 2026-11-18; Title joins Basic with VE-D68) | **The form editor's own side panel, whole**: the Basic, SEO, Checks and History tabs with the same fields, wording and checks, on the same `EntryDraftSession` (VE-D15), so a change there shows on the page at once and there is one panel to maintain. **It slides over the page from the right and never pushes it aside**, so the page keeps the width a visitor sees; no grey cover, the uncovered page stays usable. It opens and closes from the strip's **Page settings** button, the handle, and Escape (closes), one state for all three; a click on the page does not close it. It keeps the width it was dragged to, as the form editor's panel does. **Closed when the screen opens; once the page is drawn with the draft in place, it peeks** every time the screen opens: about half a second later it slides out about 48 px, holds about a second, and slides back, skipped if the editor has already clicked or typed in the page, and no motion (the handle simply shows) when the computer asks for reduced motion. **The handle**: an arrow alone (‹ closed, › on the panel's left edge when open), drawn as a small raised button (about 24 by 48 px, halfway down, light shadow, a grip look) that sits over the page's right edge, just inside the frame's scrollbar so the scrollbar stays usable. Click toggles the panel; dragging it left pulls the panel out with the pointer, and on release it opens when pulled past a third of its width, else slides back; dragging the open panel's handle right closes it the same way. A real button for the keyboard and screen readers (expanded or not, controls the panel), with "Page settings" as its accessible name and tooltip. |
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
| VE-D37 | Done and Cancel on the value being typed in (agreed 2026-11-19) | **A small Done (✓) and Cancel (↶) pair just outside the bottom right of the value being typed in** (text, rich text, a row's words, a section heading), drawn in the admin document so site CSS never reaches it, following the page as it scrolls; for a value taller than the window (the body) it stays at the window's bottom until the value's end shows. **Done** leaves the value, keeping its change, as a click elsewhere still does (the draft saves itself as it is typed, so the word is Done, not Save). **Cancel** puts back what the value held when it was opened, in the draft and on the page; on a row just added and still blank it takes the row away. **Escape stays Done**, so a reflex press never loses what was typed. Pictures, the map and the other fields keep their own boxes with Done. Also agreed: an empty value being typed in keeps the page's layout (a headline stays on its own line); only a value inside a line of text gets room for the cursor. |
| VE-D38 | How the file and the edited values live together (agreed 2026-11-19) | **The developer's file owns the design and the starting text; the database owns only what editors changed.** The file (`src/custom/site/home.html`, `home.{lang}.html`, `src/custom/site/pages/{name}.html`) stays in the developer's git repository and is deployed to Hosting at `/_site/` as today. Editors' values are saved by key and filled into the file's marked areas every time the page is built. Edits are never written back into the file: the site cannot commit to the developer's repository, and the next deploy from it would wipe them. So a deploy of a new file republishes the page from the new file plus the saved values, and nothing has to be merged. |
| VE-D39 | Where the values are kept (agreed 2026-11-19) | **Firestore, as a draft and a published copy**, like `arc_{slug}_drafts` and `arc_{slug}`: `SitePageTextDrafts/{pageId}` (read and written by the people who may edit drafts, VE-D23) and `SitePageText/{pageId}` (read by anyone, since its values are on the public page; written only by the publish function), with each publish kept in `SitePageText/{pageId}/History/{id}` (Cloud Functions write it, editors read it). *Built (VE5.2, VE5.3):* the published copy keeps each value's `value` only, since anyone reads it; who saved it, when and the texts it was saved against stay in the draft and in History, with `publishedBy`; `draftUpdatedAt` tells a draft changed since. `pageId` is `home` or `p-{name}`. A value is kept per language and key with the file's text when it was saved (VE-D45), the default language's text it was translated from (VE-D44), who and when; the SEO title, description and share image sit beside them. Firestore, not Storage: values are small and saved one by one (VE-D52), rules guard each document, and the publish function and the app read Firestore already. A picture chosen for an area goes to the media library in Storage as today; the value is its address. |
| VE-D40 | What visitors get (agreed 2026-11-19) | **The values are written into the static HTML on publish**; visitors load no database or Firebase code. A publish rewrites `/index.html` and `/{lang}/index.html` (or `/pages/{name}/index.html`), as a card change does today. Each release starts from the live one (`deployToHosting.ts` copies its files and its rewrites, redirects and headers) and replaces only those files, so the app shell (`/__shell.html`), its bundles, the site's CSS and scripts and every other page carry over unchanged; the design is always the last deployed `/_site/` file. Pages the app draws itself (`npm run dev`, the home page or `/p/{name}` opened through the router) read the published document at runtime and fill it the same way. |
| VE-D41 | Kinds of area (agreed 2026-11-19) | **From the tag**: `img` a picture (address and alt text; a new picture drops the element's `srcset` and the `<source>` elements of a `<picture>` around it); `a` a link, its text and address, or only its address when it holds elements (an icon); anything else plain text; `data-arc-edit-kind="rich"` rich text (bold, italic, link); `data-arc-edit-kind="background"` a background picture, written as the element's `background-image`, the address checked and quoted. `data-arc-edit` on an `<arc-content-partials>` edits its section title. `<title data-arc-edit>` and `<meta name="description" data-arc-edit>` are what the SEO tab edits (VE-D51); on the home page the SEO tab works with or without them. `data-arc-label` names an area (and a `<section>`, VE-D50); `data-arc-placeholder` as VE-D19. Not in the header or footer (VE-D20). |
| VE-D42 | Filling the page (agreed 2026-11-19) | **One pure function, `applyPageText`**, run before the `data-arc-t` strings (*changed in the build*: an area whose value wins loses its `data-arc-t`, so the strings cannot write over it, and one left alone keeps it, for the order of VE-D43): app copy `src/app/core/utils/page-text.ts` the source of truth, `functions/src/shared/page-text.ts` its mirror, one spec running both on the same cases. Text escaped; rich text through an allow-list of its own (`b`, `strong`, `i`, `em`, `br`, `a[href]`, no other attribute); picture, link and background addresses limited to `http(s)`, root-relative, `mailto:`, `tel:` and (*added in the build*) a place on the page, `#…`. *Also from the build:* `script`, `style`, `iframe` and other elements whose words are code, or void elements, are never filled; the title and description take the SEO values whether or not they are marked (a mark on them only names them); a failed read of the published values fails the page's build, so no page goes out without its editors' words; a static page without marks reads none. Published pages lose the `data-arc-edit*` attributes, as the hints of VE-D19. **A file with no `data-arc-edit` and no values publishes byte for byte as today** (a spec over the shipped files). |
| VE-D43 | Languages (agreed 2026-11-19) | **Values are kept per language.** A language with its own file (`home.{lang}.html`): its edited value, else its own file's text. Any other language: its edited value, else its `data-arc-t` translation, else the default language's edited value, else the file's text. Pictures, link addresses and backgrounds are the same in every language ("Same in every language", VE3.8); alt text and link text are translated. Static pages exist in the default language only, so their editors have no language switch. |
| VE-D44 | Check translation (agreed 2026-11-19) | **A translated value keeps the default language's text it was made from**; when that text changes, the area shows **Check translation**. With another language chosen, the classic editor shows the default language's text above each field. |
| VE-D45 | The file has new text (agreed 2026-11-19) | **A saved value keeps the file's text of that moment.** When the file's text later differs (a developer changed it), the area shows **The file has new text** with **Use it** and **Keep mine**. |
| VE-D46 | Back to the file's text (agreed 2026-11-19) | **Each edited area has Use the file's text**, which deletes the saved value, so the page shows the snippet from the HTML again. A draft change, published with Publish. |
| VE-D47 | Keys the file no longer has (agreed 2026-11-19) | **Listed at the bottom of the classic editor under No longer on the page**, each with its text and Remove; never shown on the page. No automatic matching of a renamed key; the docs ask developers to keep keys stable. |
| VE-D48 | Content, More Pages (agreed 2026-11-19) | **A new admin item, Content → More Pages**, a list: **Home page** always first (its SEO and card blocks are useful before anything is marked), then every static page that has at least one marked area, so an editor never opens a page with nothing to change. Each row: name, address, status (Published, or Changes not published), last published, and Edit and Visual Editor as on content lists. Under the Content feature (VE-D24); the people of VE-D23. |
| VE-D49 | Addresses (agreed 2026-11-19) | **Classic editor `/admin/more-pages/home` and `/admin/more-pages/p/{name}`; Visual Editor `/admin/edit-page/home` and `/admin/edit-page/p/{name}`**, full screen like `/admin/edit/:type/:id` and listed explicitly in `app.routes.ts`. They can clash neither with that route (where `p/{name}` would read as a type `p`) nor with a static page named `home`. |
| VE-D50 | The classic editor for a page (agreed 2026-11-19) | **Shaped like the entry editor.** Left: one field per marked area in page order (one-line text, a small rich text editor with bold, italic and link, the media picker with alt text, link text and address, background picture), grouped by the `<section>` around it, named by its `data-arc-label`, else its first heading. Each field shows **From the file** (the file's text faint as its placeholder) or **Edited** with Use the file's text (VE-D46), and the notes of VE-D44 and VE-D45. A card block is a short box ("Testimonials: 3 shown, newest first") with **Edit testimonials** (its entries keep their own editors), and its section title when marked. **No longer on the page** last (VE-D47). Top: the language switch (home page), **Live Preview** (the window of VE1, drawing the page with the draft values), and **Visual Editor**; the two editors are two views of one draft. |
| VE-D51 | The page's panel (agreed 2026-11-19; changes with VE-D67 to VE-D69) | **Basic** (status, Publish), **SEO** (title, description, share image, the file's own as defaults, the entry editor's checks) and **History** (every publish kept; **Restore** puts a version into the draft, which then needs Publish). The same panel is the Visual Editor's Page settings for a page. |
| VE-D52 | Two editors at once (agreed 2026-11-19; replaced by VE-D76 when VE6 step B is built) | **Each field saves on its own** (a field-path update of the draft), and others' changes show live in fields not being typed in. The same field changed by two people: the last save wins. No whole-document conflict check. |
| VE-D53 | What Publish covers (agreed 2026-11-19; which cards and the count change with VE-D72 and VE-D73) | **Classic editor: the page's areas and SEO** (cards publish from their own editors). **Visual Editor: one Publish for the areas and SEO and every card shown with unpublished changes** (a draft whose status is `draft`), saying how many ("Publish 4 changes"). The screen draws such a card from its draft and every other card as published, so what is seen is what Publish makes. Everything is checked first (required fields, `[Replace:`); if anything fails, nothing is published and that card opens on the field. |
| VE-D54 | Cards on the Visual Editor (agreed 2026-11-19) | **A card is edited in place like an entry**, saving its own draft; while one is being edited the panel shows that entry's form with **Back to page**. A small bar on the card: **types without pages** (testimonials, a hero): Add (a draft of the type in the block) and Remove (unpublishes after asking, never deletes); **types with pages** (a blog post): **Open** (its own Visual Editor) instead of Remove, since removing would take the post off the site. **Move** only for a type in its own order, saved as Arrange saves. A type shown newest first says so on hover, and a card that a full block would push out on Publish shows faintly with "Leaves the home page when you publish" (VE2's `cardsWithDraft`). Cards in the header and footer are not edited (VE-D20). |
| VE-D55 | Scripts and animation (agreed 2026-11-19) | **The page's scripts do not run on the Visual Editor** (VE-D17); animated sections show at rest. The frame sets `class="arc-editing"` on `<html>` so a developer can show what a script would reveal (`.arc-editing .reveal { opacity: 1 }`). An area the page hides (a closed menu, another slide) is reached in the classic editor. |
| VE-D56 | The strip on the site (agreed 2026-11-19) | **The home page always offers Edit home page; a static page offers Edit this page only when it has marked areas**, told by `data-arc-editable` that publishing adds to its `arc-entry` meta. Both open the Visual Editor (VE-D49). Back to admin goes to More Pages. |
| VE-D57 | Publishing and its cost (agreed 2026-11-19) | **A new publish queue action, `page-text`** (`docId` the `pageId`), lets editors ask for a publish; the function copies the draft into `SitePageText`, keeps the History copy and rebuilds that page. **The home page rebuild is coalesced** like `redeploy-all` and `items-from` (`coalesced-items.ts`), so five cards and the page text published together make one release of the home page in every language. |

### Non-goals

- A second data model for page editing: there is one draft, edited two ways.
- Inline editing of the header or the footer (list pages: see VE6).
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

**Build note, VE3.11 low items fixed (2026-11-19, `fix/ve3-low-items`):** five of the items below.
The strip on pages the app draws takes the page's strings: `UiStringsService.use` hands them to
`setEditorStripStrings` (editor-strip.ts), which passes them to `drawEditorStrip(strings)`; there
they win over the script tag's, English where they have none. A type slugged `home` or `p` is told
apart by the page's address (`stripLinks(entry, path)`): `home` at `/home` is that type's list
page, and `p/{id}` under `/p/` ending in something other than the id is an entry of type `p`.
`EntryDraftSession.switchLanguage` counts its switches: one still loading its translation is not
put on screen once another was asked for, and its copy is kept. Markers pasted or dropped into a
rich text (`pastedMarkersFixed` in field-place.ts) go when the text places no fields or the entry
cannot place that field, and a field brought in again keeps only the new marker. The edit screen
drops late work once closed (the move to the classic editor, the refresh after a language switch,
picker results, the draw wait), and the field's box follows its value on scroll, redraws and width
changes (`placePopover`). Still left: the strip's pinned-header check reads every element's style
while scrolling; a selected field card can be replaced by Insert block or table (undo brings it
back); a map in a card loads its frame again on a redraw; Publish and Close can scroll off the
strip on a phone.

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

**Built in three groups, one after another** (agreed 2026-11-19), each depending on the one before:

| Group | Tasks | Ends with |
|-------|-------|-----------|
| 1. Rows on the page | VE4.1 to VE4.4 | The specs of the files changed, a short browser check of every repeating type empty and full (the marks touch the renderer published pages also use), and a short critical review of the group with its critical, high and medium findings fixed, before group 2 starts. |
| 2. Map rows | VE4.5 | The same: its specs, a browser check of map rows in two languages, a short critical review of the group. |
| 3. Finish | VE4.6 to VE4.8 | Docs, the full browser check, and the critical review of the whole of VE4 with `npm run gate`. |

**Build note, group 1 (2026-11-19):** the renderer's `editRows` option (app copy only, edit frame only) marks rows through `markEditedRow`; `core/preview/row-fields.ts` says which loop is a repeating field, which row value a binding shows, and what is kept empty; `edit/rows.ts` holds the bar's pure row changes. Blank rows reach the edit frame through `EntryDraftSession.drawingPage` and are dropped by `withoutBlankRows` on every other page, the live preview window included. Review lows left: a template box around a value can make both spots on an empty row; the bar goes to the first copy of a row drawn twice; the bar is not reached by the keyboard; an empty gallery item opens the picker with no video choice; Add after on the last row a `data-limit` shows adds a row nobody sees; row names come from the schema in English, as in the classic editor.

**Build note, group 2 (2026-11-19):** a map row's map, address and directions link are `popover` spots that open the map box (the form's `MapPickerComponent`, 440 px, placed to fit the window); in a translation `InPlaceEditing.resolve` makes the address a text spot and the point is shared. A row's map takes no clicks itself (`pointer-events: none`); `frameSpotAt` finds it under a click on what holds it. An empty spot a site sheet hides with `:empty { display: none }` is shown (`data-arc-unhide`, found from the sheet's own `:empty` rules, so a spot hidden on purpose stays hidden). Two fixes in the map picker reach the classic editor too: Leaflet's sheet is loaded under `:host ::ng-deep` (a scoped copy never reached Leaflet's own elements, so tiles were unplaced) inside an isolated canvas, and the pin has its image files (it asked for `marker-icon.png` beside the page). Left as low: the pin's `.leaflet-dragging` cursor rules key on `body` and do not apply; an empty list (`[]`) counts as a value for `data-arc-if`, so a cleared list can leave an empty section on a published page (existing, outside VE4).

**Build note, group 3 (2026-11-19):** docs (`docs/features/content.html` Visual Editor: repeating rows, map locations, Done and Cancel, languages, empty fields; `docs/website/templates.html` and `docs/features/templates.html` on rows edited where drawn) and CHANGELOG. Browser check on a test type with all five repeating fields: every type empty and full, add, move, remove and Undo, Phone width (cards stack, arrows turn up and down), Hindi turned on for the check and off after (words typed into the translation by row id, pictures and pins shared, the bar says where rows are arranged). The end-of-VE4 review found no critical or high items; its medium ones are fixed (Done and Cancel kept inside the window and above the row bar, docs and CHANGELOG wording). Also fixed on the way: the free images Search button kept its height while searching. Low items left: Cancel has no keyboard key (Escape is Done by design; the strip's Undo works in the body); Done and Cancel sit over the last line of a spot that runs past the window's bottom.

### VE5: Home page and static pages

Planned 2026-11-19 (VE-D38 to VE-D57; VE-D21 and VE-D22 replaced). A developer marks areas in
`home.html` or a static page with `data-arc-edit`; editors change them in a classic editor of their
own under Content, More Pages, or on the page in the Visual Editor, where the home page's cards are
edited too. Values are saved in Firestore and written into the static pages on publish. Files with
no marks keep working unchanged.

| Task | What |
|------|------|
| VE5.1 | `applyPageText`, app copy and functions mirror (VE-D41 to VE-D43): every kind of area, the section title of a card block, title and description, escaping, the rich text allow-list, the address rules, `srcset` and `<picture>` dropped for a new picture, the language order with and without a language's own file, `data-arc-edit*` removed. Specs: both copies on the same cases; byte-identical output for a file with no marks. |
| VE5.2 | Data and rules (VE-D39, VE-D57): `SitePageTextDrafts`, `SitePageText` and its `History` in core `firestore.rules`, the `page-text` queue action; the app's page text session (load, a field saved on its own, others' changes live, the file's text and the translation's source kept, Publish through the queue). Rules tests: editors read and write the draft, anyone reads the published copy, nobody else writes, nobody writes the published copy or History from the browser, the queue item's shape. |
| VE5.3 | Publishing (VE-D40, VE-D56, VE-D57): the queue's `page-text` copies the draft, keeps History and rebuilds the page; the home page rebuild coalesced; `deployHomePage`, `deployStaticPage` and the app's home and static page renderers fill the values and SEO; `data-arc-editable` on the `arc-entry` meta. Functions specs for each. |
| VE5.4 | Content, More Pages (VE-D48, VE-D49): the menu item, the list (Home page first, static pages with marked areas, status and last published), the routes in `app.routes.ts`, admin strings as translation keys. |
| VE5.5 | The classic editor for a page (VE-D50, VE-D51, VE-D43 to VE-D47; *notes from the build*: an emptied field is Use the file's text; Check translation offers **It is still right**, saving the words again against the default language's; the SEO tab counts characters against about 60 and 160; Live Preview is a window at `/admin/preview-page/home[/{lang}]` or `/admin/preview-page/p/{name}` that follows the draft in Firestore and draws the page again after each save, since every field saves on its own; the list's and editor's **Visual Editor** button comes with VE5.6): fields grouped by section, From the file and Edited, Use the file's text, The file has new text, Check translation with the default text shown, card block boxes, No longer on the page, the language switch, Live Preview, the Basic, SEO and History panel with Restore. |
| VE5.6 | The Visual Editor for a page (VE-D49, VE-D55; *built*: the frame is the page's Live Preview with `?edit=1`, drawn once with the marks kept and scripts off; after that the screen puts each save on the page itself (its own and others'), never into the area being typed in, so the page never redraws under the cursor; the panel of VE-D51 is one component shared with the classic editor; a section title changed in its box shows on the card block's heading when the page is drawn again; earlier note: `in-place.ts` sets `data-arc-edit-kind` on elements for its own use, so read the author's `data-arc-edit-kind` before it does, or rename the internal one): the frame drawing the page with the draft values and scripts off (`arc-editing`), every kind of area edited in place with the Done and Cancel of VE-D37, the strip, the panel of VE-D51 as Page settings, the switch to the classic editor and back. |
| VE5.7 | Cards on the Visual Editor (VE-D54): a card edited in place on its own draft, the panel showing its form with Back to page, the card bar (Add and Remove, or Open; Move for a type in its own order), the newest-first note and the card leaving a full block. *Built 2026-11-20:* in the frame (`?edit=1` only) `PageCardsSource` (`more-pages/page-cards.ts`, the `PageCardDrafts` of `card-draft.ts`) follows each card type's drafts live and the open card's form over its preview channel; `cardsWithDrafts` draws every changed draft, hides a card taken off the site, applies a Move at once, lets the open card take the last place (VE2) and returns the cards a full block pushes out, drawn last and faint (`data-arc-leaving`). Card blocks mark each card (`data-arc-card-id`, `data-arc-card-type`, `data-arc-changed`) and its values (`data-arc-sub`, through `editRows`); blocks in `arc-header`/`arc-footer` are left as published (VE-D20). A card's title, summary or text field is typed in place, the frame holding redraws meanwhile; anything else opens the form on the field; typing loads the form without sliding the panel over the card. A card inside a marked block is the card's, not the section title's. "A draft of the type in the block" is a draft with `addedOnPage: {pageId}`, so another editor's half-written drafts never appear on the page; it starts with a `[Replace: new {type}]` title. **Add is offered for types without pages only**: a new post needs an address and belongs in its own editor. Remove unpublishes a published card as the entries list does and only clears `addedOnPage` on a new one. Move uses `EntryOrderService` (Arrange). |
| VE5.8 | One Publish on the Visual Editor (VE-D53): changed cards drawn from their drafts, everything checked first, the count, the failing card opened. *Built 2026-11-20:* the strip says "Publish N changes" (the page's words and SEO count as one, then each changed card shown, read from the frame's marks); it runs through the page panel (`beforePublish`, `publishWith`, `extraChanges`): the typing and the open card are saved, each changed draft is read again and checked (`cardProblem`: title, required fields, an address for a type with pages; `[Replace:` asked about as the entry editor asks); a failure publishes nothing and opens that card on the field. Each card is published as the entry editor publishes it (status, `publishedOn` kept, `addedOnPage` removed, a `publish` queue item); the home page rebuild is coalesced (VE-D57). The classic editor's Publish stays page text only. *End-of-group-3 review (2026-11-20), fixed:* a card added on the page counts as a change only while never published (`isPageChange`: no `lastPublishedAt` or `publishedOn`), so an entry unpublished on purpose elsewhere is never republished by the one Publish; a change of the open card is held while words are typed like every other redraw, and the hold's release is cancelled when typing starts again; a changed card on a translated page shows its draft's own translation; the frame follows only drafts whose status is `draft` and reads a type's whole order once after a Move; the `[Replace:` question looks at the page's saved values only, and only when its words are published; a card that fails to publish is named while the others go out; area keys are escaped in selectors; a frame reload stops the earlier wait; the card form fits a narrow window; leaving with a card's form unsaved asks first. Low items left: a card published from the page is the draft as it is at that moment, not compared with the one checked; the card bar is not reached by the keyboard; Add on a type with pages is not offered; the confirm for text to replace uses the entry editor's words ("This page still has..."). |
| VE5.9 | The strip on the site (VE-D56): Edit home page, Edit this page on a static page with marked areas, Back to admin to More Pages. Specs for the links per page kind. *Built 2026-11-20:* `stripLinks(entry, path, editable)` in `public/assets/js/arc-site.js`: `home` gives Edit home page (`strip_edit_home`, Hindi shipped) to `/admin/edit-page/home`; `p/{name}` gives Edit this page to `/admin/edit-page/p/{name}` only when the `arc-entry` meta carries `data-arc-editable` (read with the page, so a page the app draws follows the meta); Back to admin goes to `/admin/more-pages` on the home page and every static page, marked or not. The app side (`setArcEntry` with `editable`) was built in VE5.3. Specs in `scripts/__tests__/arc-site-js.spec.ts`. |
| VE5.10 | Docs: `docs/website/home-page.html` and `docs/website/static-pages.html` (marking areas, the file and the saved values, keys kept stable, `arc-editing`; the static pages advice that a hand-written page with marked areas suits a fixed design with words editors change), `docs/website/templates.html` (`data-arc-edit`), `docs/features/content.html` (More Pages, both editors), the data model and rules pages for the new collections, CHANGELOG. *Built 2026-11-20:* groups 1 to 3 wrote most of it; this filled the strip's links (content, home page, static pages), the `data-arc-edit` row in templates, the page SEO note in the SEO guide, the `strip_edit_home` string, and a CHANGELOG entry; the home page guide no longer puts the strip at the bottom. |
| VE5.11 | Browser check on the dev project: a test `home.html` and a static page with every kind of area; edit in both editors in two languages; Use the file's text; a changed file text and a removed key; History and Restore; cards added, moved, removed and opened; one Publish; the published pages checked as a visitor; a file with no marks unchanged. |
| VE5.12 | Critical review of VE5, fixes, `npm run gate` (rules tests included). *Reviewed 2026-11-20* (functions and rules, the page data and classic editor, the Visual Editor and strip), fixed: a card block's section title set as text, never HTML, by `data-arc-bind` and `[innerHTML]` (both hydration copies); saved rich words through the allow-list in the classic editor and the Visual Editor's comparison; a static page whose rebuild or release fails clears `draftUpdatedAt` on its published copy (`markPageTextUnreleased`), so the admin shows changes not published, and the panel says so; History keyed by the queue item; the panel follows the published copy live (`followPublished`); a field's failed save is kept per field; a card is published in a transaction only when it is still the draft checked and still a change of the page, and put back when the queue cannot take it (Remove too); Add in a type's own order goes right after the card pointed at (`placeAfter`); a changed card's translation is followed live; raw-text tags (`xmp`, `noembed`, `noframes`, `plaintext`) never areas; a file is marked by the attribute only; the editor's SEO words keep their place on a social tag the file translates; an empty area shows its placeholder on the Visual Editor; Back to admin goes to More Pages on every static page; the leaving note says "this page". |

**Built in four groups, one after another**, each ending with the specs of the files changed, a
short browser check and a short critical review with its critical, high and medium findings fixed:

| Group | Tasks | Ends with |
|-------|-------|-----------|
| 1. Data and publishing | VE5.1 to VE5.3 | Functions specs, rules tests, a publish of a marked test page checked on the dev project. |
| 2. The classic editor | VE5.4, VE5.5 | Every field kind and state in two languages, History. |
| 3. The Visual Editor | VE5.6 to VE5.8 | Areas and cards in place, one Publish. |
| 4. Finish | VE5.9 to VE5.12 | The strip, docs, the full browser check, the critical review of the whole of VE5 with `npm run gate`. |

**Deploy, in this order:** functions (`processPublishQueue` and `seedStaticPages`, which build the
home and static pages, and any other function found then to call `generateAndDeployHomePage` or
`generateAndDeployStaticPage`), so the queue knows `page-text` before anyone sends it; then
Firestore rules (the new collections and the queue action), so the admin's writes are allowed;
then hosting (the admin app and `arc-site.js`); then Republish website, so published pages carry
`data-arc-editable`. Never deploy functions from a worktree.

**Review of the whole Visual Editor (2026-11-20 and 21), fixed:** a text field bound to a link (`data-arc-bind` on `a`, `img`, `iframe`, a form field, `time`) is marked with the attribute it fills, and a text spot whose stored value differs from what the page shows (a label, markup, line breaks) opens its box (or Page settings for the summary) instead of typing (`typedAsShown`, in-place.ts); the edit frame draws on a channel of its own screen (`editFrameKey`, `EntryDraftSession.connectFrame`), so another tab never draws its draft in it, and the hold while typing now holds the frame only, the preview window following every keystroke; a new entry starts on the page (`/admin/edit/{type}/new`, Add on the entries and the site strip, a Visual Editor row action, `PageModeHooks.stored` for the address after the first write; the address check saves itself once it answers, `EntryDraftSession.saveSoon`); in a translation a top-level text spot not translated yet starts empty; Tab from a non-spot goes to the nearest spot or out (`nearestSpot`), and spots have a role and name; an address attribute wins the element's mark; `arc-editing` on the entry frame too; Done and Cancel and the row bar take the first place that covers no words (`placement.ts`); a marked page area that holds elements (plain text) or another marked area keeps the file's words and is not offered (`wordsKept`, both page-text copies); the home page's words are marked not live when the rebuild cannot be queued or is given up (`finishCoalesced` says so); the site strip pushes only what is under it, never a box as tall as the window, and puts back a header that unpins. Low items left: the strip on a stale coalesced item recovered by `recoverPublishQueue` does not mark the home page text; an outer area holding another still shows the hover outline on the page Visual Editor; a spot's screen-reader name for a row value is the field's, not the row value's.

**Build note, showing what can be changed (2026-11-21):** `edit/editable-reveal.ts` draws two seconds of moving outlines (SVG rects with an animated `stroke-dashoffset`, on a fixed layer `[data-arc-reveal]` over the frame's page, still under `prefers-reduced-motion`) when the screen first draws the page; the strip's outline button sets `data-arc-show-edit` on the frame's `<html>` for a still 1px outline, remembered in `localStorage` (`arc.visualEditor.showEditable`). A click that opens nothing and finishes no typing reaches the screen through `InPlaceHost.fixedClick` / `PageInPlaceHost.fixedClick`: on words or media it shows a note (a value's hint, else "part of the site design") and outlines again, never restarting while they show. The page editor marks a `data-arc-edit` area with no view as `data-arc-fixed` (no hover outline, a click explains it), which settles the earlier low item. Placeholders: one admin rule in `styles.css` (lighter, italic), `enter_field` is "Add {field}" through `inSentence` (now `core/utils/in-sentence.ts`, every title-case word made small), and an address field shows `https://`. Low items left: a part inside a card block is outlined with its card as well; the address example is chosen by the field's key, not a field setting.

**Build note, low review items (2026-11-21):** ten of the review's low items fixed. The page editor's status says Not saved when the draft cannot be read (`data.session.error()`), and `not_read` / `not_saved_detail` are one sentence with no raw error. A box re-finds its value after a redraw (`InPlaceEditing.find`, by key, attribute, row, row id, sub-field and heading) and closes with its row on Remove; it puts the panel's tab back as it closes (`popReturn.tab`). The picture boxes say Remove picture and the row bar "Remove {row}". After a row is removed, `holdRowsUntilMoved` keeps every row's bar back until the pointer is 8 px from where it was first seen. A focused spot that is not typed in is outlined dashed. A new picture gives `data-src`, `data-lazy-src` and `data-original` its address and drops `data-srcset`, `data-lazy-srcset` and `data-sizes` (`LAZY_PICTURE_SRC` / `LAZY_PICTURE_SIZES`, in the editor and both page-text copies). A row value is named "{part} of {row} {n}" for a screen reader, a heading "{field} heading". The site strip is the body's first child. `inSentence` keeps a title-case label as written and makes only an ordinary first word small. Also settled: Live Preview no longer freezes while a spot is open (H2), and an outer page area no longer shows a hover outline (`data-arc-fixed`). Low items left: the home page strip has no Live Preview; the Classic editor shows empty paragraphs as gaps; the page-text developer edge cases (a `data:` background, marks in `<noscript>` / `<template>`, duplicate keys, rich on `<a>`, `{{ }}` in SVG); the public copy keeps removed keys and disabled languages and names the last saver; the coalesced recovery path does not mark the home page text; absolute headers and `scroll-padding` under the strip; a card and the part inside it both outlined; the address example chosen by key; lazy backgrounds (`data-bg`) are not rewritten.


**Build note, Live Preview on the page strip (2026-11-22):** the page Visual Editor's strip has Live Preview (`openPreview`, window `arc-page-preview-{pageId}`, shared with the classic page editor) at `pageLivePreviewUrl`: the preview route with `?cards=1`. That provides `PageCardsSource` as in the frame, with `PageCardDrafts.editing = false`, so the card blocks draw the changed cards as Publish would but no leaving cards, no field or card marks, and the page's scripts run. The classic editor's Live Preview stays without cards, as its Publish is the words only. Settles the low item "home page strip has no Live Preview".

**Build note, outlines on a settling page (2026-11-23):** `EditableReveal.flash` measured each part once, so outlines drawn while a web font was still loading or an entrance animation was running stood at the old places for the two seconds (seen on a site with a display serif). It now waits for `document.fonts.ready` while the fonts are `loading` (at most `FONT_WAIT_MS`, 1 s), reads the parts once and keeps one SVG per part, placed again on every `requestAnimationFrame` until the fade ends (moved only when its box changed); the parts are read again on scroll, resize or a redraw of the page.
---

### VE6: One Page settings panel, one editor at a time, and list pages

**Status:** PLAN, written 2026-11-24; step A (one panel, VE-D67 to VE-D75) and the changes to
VE-D60, VE-D62 and VE-D63 added the same day after the team's report; step B (one editor at a time,
VE-D76 to VE-D85) added after that, with VE-D72 changed to fit. Agreed in discussion 2026-11-24 that
one person holds a page until its changes are published or discarded, and that another person can
review, publish or take over. Steps A and B and group C (VE6.1, VE6.2) built 2026-11-24 together, see
the build notes below; merged into `dev` and deployed to the dev project 2026-11-24; groups D and E (the list page editors and
the finish, VE6.3 to VE6.7) built the same day after that, not yet checked in a browser (VE6.8) or
reviewed (VE6.9). Built on `feat/visual-editing-ve6`, cut
from `dev`, in a worktree (`../arccms-visual-editing-ve6`), so the main checkout and its running dev
server are never switched. Reverses the earlier non-goal "Inline editing of list pages" (VE-D58).

**The job:** a type's list page (`/{type}`, drawn from its `list.html`) is the one public page an
editor still cannot open in the Visual Editor. The site strip offers only Add new there, and the
heading and intro come from the type's name and description, set under Content types. Editors
should change a list page where they see it, the way they change the home page: its words in
place, its cards in place, the outlines on load showing what can be changed, one Publish.

**The job before it (step A):** the team edits entries and HTML pages side by side and finds two
different panels. An HTML page (the home page, a static page) has a title, a summary and a picture,
but in its SEO tab and under other names; an entry has its cover image and summary in Basic and its
title only on the page. What is live, what the dates mean and what Publish sends also read
differently. Step A gives both one panel; the list page then gets the same one.

**What the team reported (2026-11-24), checked by reading the code, not reproduced:**

| # | Report | Finding | Answered by |
|---|--------|---------|-------------|
| 1 | It is not clear whether the page on screen is the published one | Real gap. "Saved" means the draft is stored. A page says Published only inside Page settings; an entry says nothing, so two dates have to be compared | VE-D70 |
| 2 | History keeps the old dates after Publish until a reload | Bug on entries: `arc-version-history` loads once, and the Published date is set as soon as the publish is queued (`enqueuePublish`). On a page the list reloads when a publish lands, but not for a publish from another tab or one slower than `PUBLISH_WAIT_MS` | VE-D71 |
| 2b | (found with it) | Bug: after a reload an entry's Published date is the **first** publish, because the draft keeps its first `publishedOn`; the last publish is `lastPublishedAt` | VE-D71 |
| 3 | The button always says "Publish 1 change" | As built (VE5.8): all the page's words and SEO count as one. Misleading | VE-D73 |
| 4 | The title is not in the side panel | Left out because it is typed on the page. Bug when the template does not show the title: it cannot be changed in the Visual Editor, and Publish with no title opens the panel on nothing (`req-title` is not drawn in page mode) | VE-D68 |

**Built from what is there.** A list page is treated as one more page with page text (VE5), with
its cards edited as the home page's cards are (VE5.7, VE5.8). Nothing new is invented for the
data, the classic editor, the panel, History or the outlines.

| ID | Decision | Choice |
|----|----------|--------|
| VE-D58 | List pages in place (proposed) | **In scope from VE6.** A list page opens in the Visual Editor at `/admin/edit-page/list/{type}` (the page Visual Editor, `PageEditPage`, with a list page loaded), with the strip, the panel, the outlines on load (`EditableReveal`), the outline button and the note on fixed parts, as on the page Visual Editor. Only for a type with public pages (a type without them has no list page). |
| VE-D59 | Where the list page's words are kept (proposed) | **Page text, with `pageId` `list-{slug}`** in `SitePageTextDrafts` and `SitePageText`, its History included. `isPageTextId` in `firestore.rules` and both page-text copies accept the new id. Draft until Publish, per language, Use the file's text, Check translation: all as for the home page. |
| VE-D60 | The heading and the intro (changed 2026-11-24) | **They are the list page's Title and Summary** (VE-D68), as an entry's title is its heading: marked in the shipped list templates as `<h1 data-arc-edit="title">{{ contentType }}</h1>` and `<p data-arc-edit="intro">{{ contentTypeDescription }}</p>`, stored as the page text keys `title` and `intro`, changed on the page or in Basic (one value, shown in both at once). The file's text is the type's name and description in that language, so an untouched list page looks as today. They are also the browser tab's title and the description for search engines and shares, unless the SEO tab has its own. With no marks in an app's own `list.html`, Basic still changes the browser tab, search and share text, and says the heading on the page is set by the developer. The type itself is not renamed: its name stays in the admin, in menus and in breadcrumbs. |
| VE-D61 | Other words on a list page | **Whatever a developer marks in their own `list.html`** with `data-arc-edit`, every kind of area VE5 supports. The page-text values are filled in after the template's bindings, so a file's text that holds `{{ ... }}` shows the bound value as the file's text (checked in VE6.1). |
| VE-D62 | Cards on the list (changed 2026-11-24) | **As on the home page (VE5.7):** each card is its entry; its title and summary are typed in place on the entry's draft, anything else opens the entry's form in the panel with Back to page; the card bar offers **Open** (the entry's own Visual Editor) and, for a type in its own order, the arrows (Arrange). Which cards show their draft and go out with Publish: VE-D72. **Add new** on the strip starts a new entry at `/admin/edit/{type}/new`, as today. No Remove: an entry with a page is taken off the site from its own editor (as VE5.7 decided for types with pages). The list shows the first 100, as published. Card blocks in the header and footer stay as published (VE-D20). |
| VE-D63 | One Publish | **The list page's words and the cards changed on this page (VE-D72)**, checked as in VE5.8 (`beforePublish`, `publishWith`, `extraChanges`). The page text goes through the queue's `page-text` action with `docId` `list-{slug}`; the list page rebuild is coalesced (a `list-{slug}` coalesced id beside `home` and `items-from`), so a Publish of five cards and the words makes one release of the list page in every language, and the home page when it shows the type. |
| VE-D64 | Publishing fills the words in | **`generateAndDeployContentListPage` and the app's `ContentListComponent` apply the list page's published text** (and its SEO title, description and share picture, which then win over the type's) with the same `applyPageText`, so the published page, the page the app draws, the preview and the Visual Editor agree. A type with no page text gives byte-identical output (a spec over the shipped list templates). |
| VE-D65 | Where it opens from | **Three places:** the site strip on every list page offers **Edit this page** beside Add new (its cards can always be changed, marked areas or not); More Pages lists the list page of every type with public pages, after the home page and before the static pages, with its classic editor (a list with no marked areas still has its SEO there); the type's entries page gets a **Visual Editor** button for its list page. Back to admin on a list page stays the type's entries. |
| VE-D66 | Outlines on load | **The same `EditableReveal` as the page Visual Editor**, over the list's marked areas and its cards, started once the cards are drawn, with the font wait and per-frame placing of 2026-11-23. A list longer than the window outlines only what is in view, as elsewhere. |

**Step A decisions** (one panel; agreed 2026-11-24 unless marked):

| ID | Decision | Choice |
|----|----------|--------|
| VE-D67 | One panel (changes VE-D26, VE-D51) | **Page settings starts the same on an entry, an HTML page and a list page.** Basic, in this order: **Status, Title, Cover image, Summary, Address**; then, on an entry only, Author, Layout, Tags, the type's own fields, Previous and Next. Same labels, width and tab style everywhere. The top part is one shared component (`PageBasics`), shown by `arc-create-content` in page mode and by `arc-page-text-panel`. The tabs stay Basic, SEO, History, with Checks on entries only. |
| VE-D68 | Title, Cover image, Summary | **Title always has a value; the other two are optional**, with one gentle line when empty ("No summary: search engines choose their own words."). **Entry:** its title, cover image and summary, as stored today; the title field is in Basic in page mode (`req-title`), kept in step with the title on the page, so Publish with no title always has a field to open. The classic editor keeps the title above the body and does not repeat it. **HTML page:** the values of today's SEO tab, moved: `seo.{lang}.title`, `shareImage` and `seo.{lang}.description`. Nothing is stored twice, no field is added and no data is moved. Title says "Shown in the browser tab, search engines and shares. Headings are changed on the page." **List page:** VE-D60, with `shareImage` as the cover image. An empty field shows the file's own value as its placeholder, with Use the file's text as today. A cover image on an HTML page or a list page is for shares only, and says so. |
| VE-D69 | The SEO tab | **The same search engine and share preview on all three**, drawn from what will go out. **Entry:** its fields as today (SEO title and description win over Title and Summary, and Basic says so when they are filled in). **List page:** SEO title and description only, empty until wanted. **HTML page:** the preview alone, with a line that the words come from Basic. |
| VE-D70 | One status | **The same words and colours on the strip, on the classic editors' top bars and in Basic: Saving…, Not saved, Saved but not published (amber), Publishing…, Published (green), and Not published yet** for a page or entry that never was. Right when the screen is opened, not only after a publish in this visit. An HTML page keeps its rule (`morePageStatus`; From the file reads Published); an entry uses `deriveContentStatus`, as the entries list does, so the two never disagree. Amber also while a card Publish would take waits (VE-D53 in step A, VE-D72 from step B). The strip names the page or entry being edited instead of "Visual Editor". |
| VE-D71 | Dates and History | **Last published is the last publish that landed**: `lastPublishedAt`, and `publishedOn` only for an entry published before that field existed. It changes when the publish is confirmed, not when it is asked for. **History reloads whenever the published copy changes while it is open**: on an entry when its publish ends, on a page whenever the followed published copy changes, whoever published and however long it took. While a publish runs, History says so. Cards publish into their own History; the page's History says it holds the page's words only. |
| VE-D72 | Which cards Publish takes (changes VE-D53, home page included) | **The cards changed on this page that you hold** (VE-D76). A card typed in place or saved in its form here is marked on its draft (`changedOnPage: {pageId}`, beside `addedOnPage`), so it is still included when the editor comes back tomorrow or publishes from another computer; "this visit" alone would make an editor's saved words disappear from the page. Publishing the entry clears the mark, and so does a save in the entry's own editor, because the draft then holds other work too. **A card whose entry you changed elsewhere** shows as published with a **Has unpublished changes** badge; a click opens its form in the panel, which offers **Publish with this page** (sets the mark) after the editor has seen what is in it. **A card someone else holds** shows as published with **{name} is editing this**; it is not typed on, and a click offers Review changes (VE-D79). While you look at a page someone else holds, the cards they changed on it show as they left them. A card added here (`addedOnPage`) is included as today. The reason: one Publish on a list of 100 entries must never send out a colleague's unfinished draft, and publishing a card publishes its **whole entry**. A card's panel says so once it opens: "You are editing this {type}. It changes everywhere it is shown." Draft cards already waiting when this is deployed show as published with the badge. |
| VE-D73 | The Publish button | **"Publish", with no count**, on every editor. On the strip in the Visual Editor, on the top bar in the classic editors, no longer in the page's Basic tab; a problem with a publish shows beside Status and opens the panel. Greyed out only when the status is Published, nothing is unsaved and the last publish did not fail. Never greyed on an entry without `lastPublishedAt` (changes there cannot be told). A list of what changed is left for later. |
| VE-D74 | Address | **On all three, with Copy** (the Production URL). Changed on an entry, as today; on an HTML page or a list page shown only, with "Set by your developer" or "Set under Content types". |
| VE-D75 | What stays different | **On purpose:** an entry saves its whole draft after a pause, a page saves field by field; author, tags, layout and Checks are for entries; HTML pages keep From the file and Edited. The words an editor reads are the same for each. |

**Step A tasks:**

| Task | What |
|------|------|
| VE6.A1 | `PageBasics`, the shared top of the panel (VE-D67, VE-D68, VE-D74): Status, Title, Cover image, Summary, Address, hints and placeholders, read-only parts; specs for each kind and for a translation (shared and per-language values as today). |
| VE6.A2 | The entry editor in page mode uses it (VE-D68): the title in step with the page both ways, `createSlag` and autosave as when typed on the page, required title revealed when the template shows none; the classic form unchanged. |
| VE6.A3 | The page panel uses it (VE-D67 to VE-D69) in both page editors: SEO values in Basic, saved as they are now; the preview in the SEO tab; Publish moved to the strip and the classic top bar. Specs: the same writes to `SitePageTextDrafts` as before. |
| VE6.A4 | One status (VE-D70) and the Publish button (VE-D73): one function from a state to the words and colours, used by both strips and both classic bars; specs for every state, on opening and after a publish. |
| VE6.A5 | Dates and History (VE-D71): specs that a publish while History is open shows the new version, that a failed publish leaves the date alone, and that reopening an entry shows its last publish. |
| VE6.A6 | Moved to step B (VE6.B6): which cards Publish takes follows who holds them. |
| VE6.A7 | Docs (`docs/features/content.html`, `docs/website/home-page.html`), CHANGELOG, admin strings (English and Hindi); browser check of an entry, the home page and a static page in both editors: each status, title both ways, a publish with History open. |
| VE6.A8 | Critical review of step A, fixes, `npm run gate`. |

**Step B decisions** (one editor at a time; VE-D76 agreed 2026-11-24, the rest to confirm):

| ID | Decision | Choice |
|----|----------|--------|
| VE-D76 | One person holds a page (agreed; replaces VE-D52's two editors at once, and "Someone else changed this entry" in ordinary use) | **Whoever has unpublished changes holds it, until they are published or discarded, or someone takes over.** Opening holds nothing; the first saved change does. Closing the page, or a week away, does not let go. Changing everything back to what is live lets go (compared after each save). A publish that fails keeps the hold; one that lands clears it, unless something was saved since. A site with one person sees no difference. |
| VE-D77 | What is held | **One entry, whole** (every field and language, in the Visual Editor, the classic editor and as a card); **one HTML page** (its words, pictures and SEO in every language); **one list page** (its heading, intro and SEO). A card is its entry, held on its own, whichever page shows it. Two people can hold different cards of one page while a third holds its words. Not held: the order of a type, featured, and links kept in step by the CMS (references, previous and next). A new entry is held by its author until first published; an imported draft is held by nobody until someone changes it. |
| VE-D78 | How it is kept | **`editing: { by, name, since, at }` on the draft** (`arc_{slug}_drafts/{id}`, `SitePageTextDrafts/{pageId}`), written with every save, `at` being the last change; there is no heartbeat, so nothing runs while a page is only open. **Never copied to what the public reads**: the publish function strips `editing` and `changedOnPage` from the published copy and its History. **Firestore rules enforce it**: a write to a draft someone else holds is refused, except a take over (which changes the hold and nothing else, so an old tab's ordinary save can never take one) and the writes not held (VE-D77); translations follow their entry's hold. The hold is cleared by the publish function. A stale tab can still ask the queue to publish a held draft; the app asks first, the rules do not stop it. |
| VE-D79 | Opening a page someone else holds | **View only, following their work live**, with a bar: "{name} has unpublished changes. Last change {time}." and **Review changes**. Clicks on the page show the bar's words, not an editor; the panel is read-only, its tabs open. Live Preview works. Someone who had the page open when another person made the first change goes view-only at their next change, and is told so. |
| VE-D80 | Review changes | **A list of what differs from what is live**, by field, language and area, in page order: old and new text (words added and removed marked), picture thumbnails, the body, rows added, removed and changed, SEO, address. The same parts are outlined in amber on the page, and a click in the list scrolls to its part. An entry or page never published says New. On a page it also lists the cards that person changed on it. It offers **Publish these** (as it is, through the same checks as Publish; the History entry names both people), **Take over** and **Close**. The same list opens from the status ("Saved but not published") on your own changes, with Put back on each. What is live is the published entry, and for a page its newest History version, since the published copy holds bare values (VE-D39). |
| VE-D81 | Take over | **Anyone who can edit can take over** (today every editor is an admin; approval steps are a feature of their own). It asks first, and more strongly when the last change is under five minutes old. The other person's draft is kept (VE-D84) before anything changes hands, in the same write. The taker then edits, with **Put back** on each change in Review and the Publish button as usual. On a page, the review offers the cards changed on it too: the taker chooses which go with it. |
| VE-D82 | The person taken over from | **Their screen turns view-only at once**: "{name} took over. Your changes are kept in History." What they typed and had not saved stays readable with Copy; it is not saved. They get a notification with a link. An HTML page saves field by field, so at most the field being typed in is lost; an entry saves after a pause. |
| VE-D83 | Put back, and Discard changes | **Put back** returns one change to what is live: a field, an area, a picture, a whole body, a row list in one step (not single sentences). **Discard changes** (Page settings, beside History; asked first) returns everything and lets go; on something never published it offers Delete as today. Both keep the draft first (VE-D84). |
| VE-D84 | Nothing is lost | **Before a take over or a Discard, the draft is kept** in `Kept/{id}` under the draft (staff read, created only, never changed; the last ten), and shows in History as "{name}'s draft, {time}", with Restore. Restore puts it into the draft, which then needs Publish and holds it like any change. |
| VE-D85 | Where else it shows | **Entries lists and More Pages** show who holds a row ("{name}, 2 hours ago"). Unpublish, Delete, Publish and Restore from a list, in bulk too, say who holds it and ask first. The dashboard is unchanged. Reading a hold: the name is kept with it, so no account is read. |

**Step B tasks:**

| Task | What |
|------|------|
| VE6.B1 | Compare: one function from a draft and what is live to a list of changes, for entries (fields, translations, body, rows) and for page text (keys, languages, SEO, pictures); unchanged means an empty list, whatever the saved form. Specs. Used by the status of VE-D70, so "Saved but not published" means a real difference. |
| VE6.B2 | The hold (VE-D76 to VE-D78): the field, set and cleared by both sessions (`EntryDraftSession`, `PageTextSession`) and by the publish function; the published copy and History without it; Firestore rules with rules tests for the holder, another person, a take over, an ordinary save that tries to take one, the not-held writes (with `_ref_*` inside `customFields`), translations; draft rows from before the deploy. |
| VE6.B3 | View only (VE-D79) on the entry Visual Editor and classic editor, the page Visual Editor and classic editor, and a card's form. |
| VE6.B4 | Review changes, Publish these, Take over, the kept draft and the notification (VE-D80 to VE-D82, VE-D84). Notifications are written by functions only, so a take over tells a function (its own callable, or a trigger on the hold), settled here. |
| VE6.B5 | Put back and Discard changes (VE-D83), and the kept drafts in History with Restore; History shown for an entry never published that has kept drafts. |
| VE6.B6 | Which cards Publish takes (VE-D72): the mark set, kept and cleared (in place, the panel form, the entry's editor, publish, unpublish, a duplicate and a restored version do not carry it), `isPageChange` and `pageCardsOf` on it and on the hold, the badges, Publish with this page, the line on opening a card. Specs, a colleague's draft left out included. |
| VE6.B7 | Lists and More Pages (VE-D85); docs (`docs/features/content.html`, the data model and security rules pages), CHANGELOG, admin strings (English and Hindi). |
| VE6.B8 | Browser check with two accounts in two browsers: first change wins, view only, Review, Publish these, Take over with the other screen open, Put back, Discard, a card held by someone else, an entry in two languages. |
| VE6.B9 | Critical review of step B, fixes, `npm run gate` (rules tests included). |

**List page tasks:**

| Task | What |
|------|------|
| VE6.1 | Page text for list pages: `list-{slug}` accepted in `isPageTextId` (rules) and both page-text copies; `applyPageText` run on a list page after its bindings, in `deployContentListPage.ts` and `content-list.component.ts`; SEO from page text; the shipped `list.html` files (default and every shipped folder) mark the heading and intro. Specs: both copies on a list page; byte-identical output with no page text over every shipped list template; rules tests for the new id. |
| VE6.2 | Publishing: the `page-text` action for `list-{slug}` copies the draft, keeps History and rebuilds the list page through a new coalesced `list-{slug}` item (and the home page when it shows the type); entry publishes from the queue rebuild the list through the same coalesced item. Functions specs. |
| VE6.3 | More Pages and the classic editor (the panel of step A): list page rows (name from the type, status, last published), the classic editor at `/admin/more-pages/list/{type}`, routes in `app.routes.ts`, Live Preview at `/admin/preview-page/list/{type}`, admin strings as translation keys (English and Hindi). |
| VE6.4 | The Visual Editor for a list page at `/admin/edit-page/list/{type}` (`PageEditPage`, explicit routes in `app.routes.ts`): the frame is the list's preview with `?edit=1`, scripts off, `arc-editing`; areas in place with Done and Cancel; the strip with Live Preview, Page settings, Classic editor, the outline button; the outlines on load (VE-D66). |
| VE6.5 | Cards on the list: `PageCardsSource` and `cardsWithDrafts` follow the type's drafts in the list's `items` loop as they do in a card block; cards marked (`data-arc-card-id`, `data-arc-sub`); title and summary typed in place; the card bar with Open and the arrows; Add new on the strip; one Publish (VE-D63) with the failing card opened; the badge and Publish with this page (VE-D72). |
| VE6.6 | Entry points: the site strip's **Edit this page** on every list page (`stripLinks` in `arc-site.js`), the entries page's Visual Editor button. Specs in `scripts/__tests__/arc-site-js.spec.ts` and the entries page spec. |
| VE6.7 | Docs: `docs/features/content.html` (Visual Editor, More Pages, the strip), `docs/features/templates.html` (marking a `list.html`, the list page bindings with page text), the data model and rules pages for the new id, CHANGELOG. |
| VE6.8 | Browser check on the dev project: a list page in two languages, the outlines on load, heading and intro changed and put back with Use the file's text, a card typed in place, a card moved, Add new, one Publish (without pressing Publish on real content: a test type only), the published list page as a visitor, a type with no page text unchanged. |
| VE6.9 | Critical review of VE6, fixes, `npm run gate` (rules tests included). |

**Built in five groups, in this order** (A and B can each be deployed on its own before the rest is built), each ending with the specs of the files changed, a short browser check
and a short critical review with its critical, high and medium findings fixed:

| Group | Tasks | Ends with |
|-------|-------|-----------|
| A. One panel | VE6.A1 to VE6.A8 | Entries and HTML pages with one panel and one status in both editors; `npm run gate`; ready to merge and deploy. |
| B. One editor at a time | VE6.B1 to VE6.B9 | Two people on one entry and one page, with review and take over, on the dev project; rules tests; `npm run gate`; ready to merge and deploy. |
| C. List page data and publishing | VE6.1, VE6.2 | Functions specs, rules tests, a test type's list page published with page text on the dev project. |
| D. List page editors | VE6.3 to VE6.5 | Both editors on a list page in two languages, cards in place, one Publish. |
| E. Finish | VE6.6 to VE6.9 | The strip, docs, the full browser check, the critical review of VE6 with `npm run gate`. |

**Deploy of step A on its own:** the website only (`npm run deploy`, the Website option). No Republish.

**Deploy of step B, in this order** (changed 2026-11-24, when it was built): functions
(`processPublishQueue`, so the published copy never holds the new fields, `onDraftKept`,
`onContentTypeDeleted`), then the Firestore rules, then the website. The rules come before the website
because the new website writes `editing` on page drafts, which the old rules refuse (their list of
allowed fields), so no page could be saved. A tab from before the deploy goes on working with the new
rules, except on a draft someone else holds. No Republish.

**Deploy of the list pages, in this order:** functions (`processPublishQueue`, `seedStaticPages`, and
any other function that calls `generateAndDeployContentListPage`, found then), then Firestore rules (the new page-text id), then
the website (`npm run deploy`, the Website option), then Republish website, so published list
pages carry the marked heading and intro. Never deploy functions from a worktree.

**Risks:** the list page changes for visitors (answered by the byte-identical spec when there is no
page text); a binding inside a marked area (VE-D61, checked in VE6.1); every card publish already
rebuilds the list page, so many changes at once must coalesce (VE-D63); an app's own `list.html`
has no marks, so its list page opens with only the cards and SEO editable until a developer marks
the heading and intro (said in the docs, with the two lines to add); an editor looking for a card
changed elsewhere before step B finds it as published with the badge (VE-D72, said in the CHANGELOG);
two people used to the old SEO tab look there for a page's title (its preview says the words come
from Basic, VE-D69); rules that tell the held fields from the rest get long (VE6.B2 measures it; if
they cannot say it, the app's own transaction holds the line and the rules keep only the take over
and the hold itself); a reference change bumps `modifiedAt` on an entry nobody edited, which would
read as unpublished work (VE6.B1 compares words, not times); a page held by someone who has left
(anyone takes over, VE-D81).

---

**Build notes, steps A, B and C (2026-11-24, nothing deployed):**

*Step A (VE6.A1 to A5).* The shared pieces are three, not one `PageBasics` component: `EditState`
(`edit-state.ts`, one function from what is known to one of six states), `PageStatus` and
`EditStateComponent` (Status and Last published at the top of Basic, and the badge on the strips and
classic bars) and `SharePreview` (how the page looks in search results and shares). Title, Cover
image, Summary and Address stay in each panel's own form, in the same order and words, since an entry
stores them in its form and a page field by field. A page shown from its file reads Published, so
"Not published yet" is for entries. On an entry the state compares words with the published copy once
it arrives (VE6.B1), so a reference kept in step is not "Saved, not published". The More Pages list
keeps its own three words (From the file, Published, Changes not published).

*Step B (VE6.B1 to B6).* The comparison is `core/editing/compare.ts`, the hold `core/editing/hold.ts`
and `hold.service.ts`, the bar, the review, and the kept drafts are in `pages/admin/hold`.
- **Letting go through unchanged words** is a step of its own, after a save settles, never inside one:
  `EntryDraftSession.settle` waits until nothing is being saved or left to save, compares every field
  and language with what is live, and `HoldService.letGo` checks again inside its write, puts
  `modifiedAt` back to the published one and the status to published, so the entries list says
  Published. A page lets go after each save; one never published when its words are the file's again.
  An entry never published keeps its hold until it is published or deleted.
- **An HTML page's hold counts only while unpublished** (`updatedAt` later than the published copy's
  `draftUpdatedAt`, which is null when the page did not go live), in the app and in the rules, and the
  publish removes `editing` in the same transaction, without moving `updatedAt`; when the release then
  fails, nobody holds the page and its changes wait.
- **The publish function lets go of an entry by its words, not its dates:** the draft and its
  translations, read again in the transaction of the stamp, against what it copied. References kept in
  step (`_ref_*`), order and featured are not words; series links are, by the entry they go to. Other
  words keep the hold and read as edited: `lastPublishedAt` is the time the draft was read, and
  `modifiedAt` moves only when it is not already later. An unpublish marks a draft a save left saying it
  is published.
- **`lostWords`:** a save refused because someone took over, or made the first change, leaves the
  typed words on screen to copy, with no more taken and Show theirs; nothing replaces them until then.
  When the other person lets go, they are saved, or Reload theirs and Keep mine ask.
- **What a take over takes:** from the person shown, else nothing happens and the review opens again
  ("Something changed meanwhile"), as it does when what was reviewed is not what is stored.
- **Not built from VE-D80:** the amber outlines of the changed parts on the page. **Show** in the
  review scrolls to the part and marks it for two seconds instead. Discard changes is in the review,
  not beside History (VE-D83), and the bar of a held entry's page opens the review on a click.
- **VE-D85:** only Unpublish and Delete on the entries list say who holds a row and ask; the list has
  no Publish, and Restore is in the editor, where it is off while someone else holds the entry.
- **The notification** is written by a trigger, `onDraftKept`, on `{collection}/{docId}/Kept/{keptId}`:
  it fires on a kept draft only, never on an ordinary save. Its id is the kept draft's, so an event
  delivered twice tells the person once. It also prunes to ten.
- **Rules** beyond the plan: a take over's `Kept` document must be new in the same write and name the
  actual holder, and is refused unless that write makes the caller the holder and names it, so nobody can
  be told of a take over that did not happen; `keptAt` is the time of the write. A kept draft's languages
  are documents of their own under it, written with it (`Kept/{id}/translations/{lang}`). The reads come last, so batches of 400 drafts (references, Arrange) pass. Deleting a held
  entry is allowed, as agreed (the app asks).
- **"Someone else changed this entry"** stays, for another tab of the same person and for references
  kept in step.

*Group C (VE6.1, VE6.2).* `holdListMarks` puts a list template's marks by before its strings, loops and
bindings, under a name made for that build, and `fillListPage` fills them after (VE-D61), so an
editor's `{{ }}` is never a binding and an entry's own HTML never passes for an area; `listPageWords`
gives the browser title, description, shares and CollectionPage. A type named in a language keeps
that name there over words edited in the default language only (VE-D60).
- **Departure from VE-D63 and VE6.2:** entry publishes keep building the list page in their own
  release, so the list shows the entry at once and a failed coalesced run cannot lose it; only the
  words' publish is the coalesced `list` item. Two guards keep them from overwriting each other: an
  entry's build makes a list rebuild under way run again, and after its release it queues one when the
  words were published meanwhile (`publishedPageTextStamp`).
- `info/list.html` has no description, so only its heading is marked.
- The list renderer already honours `PAGE_TEXT_PREVIEW` (draft values, marks kept, scripts off), for
  group D, whose editors must read the file's text from the page after its bindings.

- **Deleting** an entry removes everything under its draft; the app asks the queue for `purge-draft`
  after deleting one with no live page, since a trigger on every deleted document would run for queue
  items and the rest too. Data import leaves `editing` and `changedOnPage` behind, and writes a refused
  batch of drafts one by one.

*The critical review (2026-11-24, two reviews: one of the app, one of the functions and rules): 9 high
and 15 medium, all fixed.* In short: letting go was part of the save it followed
and could let go of words not stored yet (now `settle`); a publish that ended after an entry was let go to earlier
words, or while a translation was saved, said Published (now compared by words); an auto-save during
an unpublish left the entry saying published; a take over could take from a third person, and a review
acted on work that had changed since; words refused by a take over could still be typed into, or lost
when the other person let go; clearing a translation was no change, so it could not be published;
series links were compared by their copied titles; a kept document carried every language, up to
Firestore's limit, and could be written without its take over; kept drafts of a deleted entry stayed;
a leftover hold on a published page made an old tab's save count as another person's; status and
Publish answered before the published copy was read; an imported draft was held by a person of another
site; the review showed ids and "true" for values, and nothing where only formatting changed; a
summary hint was missing on an entry.

*Checked:* app and functions specs, the rules tests (164) and the byte-identical spec over every
shipped list template. The gate is green on the final code (2026-11-24: 12,069 tests, 164 rules tests, docs, types).
Browser checks (VE6.A7, VE6.B8) were made the same day with two accounts against local Auth and
Firestore emulators with the new rules, a stand-in script writing what `processPublishQueue` writes:
every status, title both ways, a publish with History open, view only, Review, an out of date review,
Take over of an entry and of the home page with its card, unsaved words kept, Put back, Discard, kept
drafts, letting go on undo, the two card badges and Publish with this page, the classic page editor.
Deployed to the dev project 2026-11-24 and checked live: an entry's publish with History open, the home
page's first save, its publish, letting go, Discard and Restore. Found there and fixed: reads after a
write came from the browser's own copy (an entry was shown one step behind after Discard and Restore),
so `HoldService.read` and `PageCardActions.read` read inside a transaction (`getDocFromServer` joins an
open listener on the document and answers from its copy, so it was not enough); a page said Published about 30 seconds before it was live, so
the published copy keeps `liveAt` (`markPageTextLive`, matched by the words' `publishedAt`).
Not checked in a browser on the emulators: the functions themselves, the notification, a static page, two languages,
list pages with words, Restore of a kept draft, Publish these.

*Low items left:*
- History does not name both people on Publish these (VE-D80): a queue item has four keys and no name.
  Looked at again with group E and left: the queue has no safe place for the publisher without a rules
  change, and the draft's holder alone would name only the one who changed it.
- A hold and a kept draft keep a person's name after their account is deleted (said in the account
  contract).
- The media usage check does not look inside `Kept` (left with group E: it needs a collection group
  read in `mediaUsage`, a third function to deploy).
- ~~A restored kept draft's address is not checked for a clash.~~ Done with group E.
- Staff can write a `Kept` document of a discard by hand; it shows in History and changes nothing.
- The pages' editors never use the "took over" wording: their bar always says who has unpublished
  changes.
- Each page editor listens to the published copy twice (the panel and the screen).
- Focus is lost when the area it is in turns inert.
- The editor offers no Delete on an entry never published (VE-D83); the entries list does.
- The amber outlines of VE-D80 are not built (above).
- ~~The entry's form inside a page's card panel is narrower than the panel (from VE5.7).~~ Done with group E.
- A tab from before the deploy writes no `editing`, so on a held entry it can still change
  `customFields` alone (the `modifiedAt` check remains).
- If the stamp after a publish fails after its retries, the entry stays held until its next publish or a
  take over; and a stale tab can ask the queue to publish a held draft (VE-D78).
- When the stamp moves `modifiedAt` of an entry open in an editor whose clock is behind the server's, its
  next save may ask Reload theirs or Keep mine.
- Republish website skips a type with no published entries, so its list page words go out only with
  their own publish; `recoverPublishQueue` does not mark words as not live when a crashed run is given
  up, for the home page as for a list page; "Changes not published" stays on a page whose given-up
  rebuild a later entry publish repaired, until Publish; words holding a literal `<b>` lose the tag in
  the browser title and description only; a home page rebuild and a whole-site republish can still
  cross, as before.

*Groups D and E (VE6.3 to VE6.7).* A page of the page editors is a `PageRef` (`page-ref.ts`: home,
static, list), which gives its id, its editors and its preview. No rules changed; functions only for
  the review's `richTextWords` (`processPublishQueue`, `seedStaticPages`).
- **The file's text is read from the bound page** (`core/site/list-page-file.ts`): the template through
  `holdListMarks`, the language's strings, the site's details, an empty loop, the type's bindings and
  `fillListPage` with no values, then `readPageFile`. The strings' keys are read from the template, since
  the fill removes them. The parser is loaded only when a list page opens. `areaView` knows a list page:
  an area with a translation, or Title or Summary of a type named in the language, falls back to that
  text, not to the default language's saved words.
- **Title and Summary** (`listBasics`) are areas with the keys `title` and `intro`, made up from the
  type's words when the file marks none, so Basic always edits the same keys and nothing is stored twice.
  They are never "No longer on the page". The panel takes them as `basics`; without it, it is as before.
- **The areas and the cards of a list page are one template**, so drawing the cards draws the areas.
  `ContentListComponent` draws with the draft's words as they are then, waits while words are typed on
  the page (`data-arc-editing`), and the screen puts the areas' values back after each draw (`redrawn`).
- **Cards:** `markPageCards` moved to `card-draft.ts` and is shared with the card block. The template's
  `data-limit` (at most 100) is the list's count there; the Visual Editor cuts the cards itself, so a card
  Publish pushes out shows after the others.
- **`data-arc-if` on a marked area is dropped on the Visual Editor** (`showEveryArea`, the app only), so an
  intro of a type with no description can be typed in; the published page is as before.
- **Outlines on load** start when the list's cards are marked, or after five seconds, or at once with none
  (`listDrawn`, VE-D66).
- **Close** goes to the type's entries when opened from there (history state), else as before. The Visual
  Editor button on the entries page is in the header; the strip's Add names the type ("Add article").
- **Published list pages need no new mark:** their `arc-entry` already names the type; `stripLinks` adds
  the link, so the site has it once the website is deployed (`arc-site.js`).
- **The critical review's fixes:** whether Title or Summary is HTML is decided by the area's kind
  (`listRichAreas` on the template, given to `listPageWords` as `rich`), never guessed from the value, so a
  plain value is never decoded and a rich one always is (`richTextWords`, both copies); Basic shows
  formatted words read only. The page compares rich words as an element reads them back (`asDrawn`), and
  the areas are put back only when the list's own nodes were replaced (`listReplaced`), the page is drawn
  and the frame is at this language; words on their way or refused by a failure stay as typed
  (`unsavedWords`). The type's name is resolved in the default language too, as published. Live Preview
  runs the template's scripts after each draw of the cards, so a script that declares a name at its top
  level (`const x`) runs on the first draw only. Close survives a detour through the classic editor
  (router state, not stored).
- **Not changed:** the list row's status says From the file until something is edited. Edit this page on
  the bar opens the default language, as on the home page.

---

**Browser check of D and E (2026-11-24),** two accounts and two languages on the emulators with the
real rules: heading and intro in place and in Basic, `&`, `'` and `<b>` as words, a language of its
own, More Pages, the classic editor, Discard, a card typed and moved, a card's form at the panel's
width, view only, Review with the card, Publish these of words and card together, the entries page
button, a type without pages, the site strip. Not checked: a formatted (rich) heading, leaving cards,
Live Preview, a template with no marks, the functions themselves. Known: Review drops a literal tag
from plain words (it shows them as words everywhere else).

**Live check of D and E (2026-11-24),** dev a4484b39 on the live test site: More Pages, the strip, the
entries button, heading and intro both ways, special characters through a real publish, a card typed
and published with the words, the card marked as changed elsewhere, Put back, Discard, Live Preview and
the classic editor all pass. Fixed after it (the seven points found, agreed the same day, and two more):
- **An entry keeps its first publish date (agreed: "Keep the date").** The publish function stamped
  `publishedOn` with the time of every publish, so an edited entry moved to the top of its lists and
  changed its public date, while the editor drew its card with the draft's older date. Now the live
  copy's date stays (an entry taken off the site keeps the one it had; one never live gets the publish's
  time), unpublishing writes the live date on the draft,
  `lastPublishedAt` on the copy says when it last went out and is what an open editor follows
  (VE-D71), a History version keeps its own publish's time in `publishedOn`, and the draft follows the
  live date. Dates changed before stay as they are.
- A card drawn from its draft takes its live copy's date (`withLiveDate`), so it stays in its place.
- Review of your own page lists the cards Publish sends (VE-D80 named them for someone else's only),
  read after what is typed is saved; Review shows when only a card changed.
- A card published from the page stays drawn from its draft (`PageCardsSource.followPublishing`), after it
  lands too, since a block reads published translations once; a publish that never lands shows what is
  live after 10 minutes. Switching the language within those seconds still shows the old words (low).
- The strip says Saving, or Not saved, for the open card's form, and Publishing until each card sent has
  ended its publish (`cardsGoing`, the wait an entry's own editor has).
- **Found while checking these on two languages (high, since VE5.7):** a card's form could start from the
  entry opened before it, still the store's `currentItem`; on a translated page the language switch then
  kept that entry's words as the base of this one, and saved them into its draft. `isNewStoredItem` now
  takes only this entry, `switchLanguage` takes the base again once the translation has loaded, and
  `cardEditorFor` waits for `entryRead` instead of a title, which a translation not written yet lacks.
- No "Last published: Never" on a page live from its file; "1 changed card"; Review in the page's order.

Not checked live: moving a card, a second admin, two languages, a formatted heading, a static page.

### VE7: Fixes from use (2026-11-26)

Six faults an editor found on an app's own site, agreed to fix all six.

| ID | Decision | Choice |
|----|----------|--------|
| VE-D86 | Close | **Close stays on the page being edited**, in both Visual Editors: back to the site page the editor was opened from (the strip's Edit this page or Add new, the referrer when the admin app opened on the screen), else the page's own address on the site in the language on screen (`site-address.ts`: an entry's `/{lang}/{type}/{live slug}`, the home page, `/{lang}/{type}` for a list page, `/p/{name}`). It saves first and loads the whole page. An entry with no live page goes back to its type's entries as before. The classic editors' Close is unchanged. |
| VE-D87 | The dimmed header and footer | **Dimmed by opacity alone.** A `filter` on `arc-header` made it the containing block of the site's fixed parts, so an app's phone menu (`position: fixed; inset: 0`) was squeezed into the header's 80 px and the page showed through it. While the header holds an open control (`aria-expanded="true"`) or focus, it shows at full strength. |
| VE-D88 | Publish | **Greyed out while a publish is on its way**: an entry while `deployStatus` is pending (it ends in a failure after the wait), a page while its words or cards are going live, until the wait gives up and says so. A second Publish in that time does nothing (`EntryDraftSession.publishing()`). The page Visual Editor's Publish no longer opens the panel first: it opens only on a failed save or publish; a card that fails its checks opens its own form, as before. |
| VE-D89 | The classic editor's width with the site look | **The rebuilt elements and the body take the whole row of a grid** (`data-arc-look-part`, `grid-column: 1 / -1`). They are rebuilt without the parts beside them on the page, so a template with a side column put the body in the side column's slot (about 250 px). Their own widths still apply. A press on the look's own boxes beside or below the text puts the cursor at its nearest point. Same rule in the version preview's frame. |

## 3. Risks

| Risk | Answer |
|------|--------|
| Markers change published pages | `markFields` is off by default and only the app copy has it; a byte-identical test over every shipped template (VE1.2). |
| Moving the editor's save logic breaks it | VE3.1 lands alone, with the existing editor specs unchanged and a browser pass, before page editing starts. |
| TipTap inside a frame misbehaves | VE3.2 spike before building on it, with a named fallback. |
| A long body makes the preview slow | Full re-render after a 150 ms pause; measured in VE1.7 on a 5,000-word entry. Updating only changed regions is added only if the measure says so. |
| The strip costs visitors | It is a few lines in the already-loaded `arc-site.js`, reading one `localStorage` key; nothing is fetched. |
| The preview route is under `/admin` but must look public | VE1.4 checks the layout's admin test (by address) and the site sheets explicitly, with a spec that the route gets header, footer and site CSS and the admin pages still do not. |
| Page text drifts from `home.html` | Values for keys the file no longer has are listed under No longer on the page, never shown (VE-D47); a changed file text is flagged (VE-D45); the docs ask for stable keys. |
| Page text reaches visitors unpublished, or is forged (VE5) | Drafts are readable by editors only; the published copy and History are written only by the publish function (VE-D39); rules tests for each. |
| Edited values break the page or run as code (VE5) | Text escaped, rich text through its own allow-list, addresses limited and quoted, the same spec over the app copy and the functions mirror (VE-D42). |
| Existing home and static pages change (VE5) | No marks and no values give byte-identical output, asserted over the shipped files (VE-D42). |
| A publish drops the app or other files (VE5) | Each release copies the live one and replaces only the page's files (VE-D40). |
| Many publishes, many releases (VE5) | The home page rebuild is coalesced (VE-D57). |
| A row edits the wrong row (VE4) | Rows are found by id, not by place (VE-D30), so a reorder or a translation's sparse rows never shift the target; specs move a row and type in a translation. |
| Templates whose rows are not one clean element (VE4) | The loop repeats its first child, so a row is always one element; one with no box is placed by its children (VE-D32); a value shown twice in a row edits the same value; the docs say what a row needs. |
| A new row vanishes from the page (VE4) | The page is drawn from the save shape, which drops blank rows: the edit screen draws them, saving still drops them (VE-D33). |
| Row order or data changes for existing entries (VE4) | Order is written exactly as the form editor writes it (positions 1 to n, ids kept); no new field, no migration. |

---

## 4. Open questions

None. The VE3.2 spike (2026-11-18) added none: TipTap works in the frame, see its build note under VE3.
