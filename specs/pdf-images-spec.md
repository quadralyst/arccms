# Images from a PDF, Straight into the Editor: Build Spec (PI)

**Status:** BUILT 2026-10-11 (PI1 to PI4), browser-tested on the xlm dev project, reviewed. **Snap to photos (scope point 5; PI-D9 to PI-D12, PI-D19's `marks`) removed 2026-10-20:** see section 9. Agreed 2026-10-11, with the six assumptions in section 7 confirmed. Changes made while building are in section 8.
**Branch:** `feat/pdf-images`, cut from `dev` (0e05ae4), worktree `../arccms-pdf-images`.
**Builds on:** specs/media-files-spec.md (MF3 and MF4: the page grid and crop step,
`pdf-pages.ts`, the `mediaFiles` collection, `readMediaFile`).

**The job:** an admin writing content has a brochure or catalogue PDF with several photos,
and wants them in different places on the page. Today each photo takes about seven clicks
and the PDF must be chosen again for every spot. After this work it is:

1. **Insert image** opens on the PDF, at the page last used, with the frame already on
   the next photo not yet taken.
2. **Insert.**

Two clicks per photo once the PDF is open, and one framing drag only when the wanted
part is not a separate picture in the PDF.

**Scope (agreed 2026-10-11, all four points of the review):**
1. **A "From a PDF" tab in image pickers**, listing the PDFs in Files and offering one
   from the computer. A PDF from the computer is kept in Files automatically.
2. **The picker remembers where you were:** the PDF, the page and the zoom, until the
   admin page is reloaded.
3. **Insert straight from the crop step**, with the size and alt text there;
   "Save, take another" for collecting several.
4. **Zoom and page navigation** in the crop step.
5. **Snap to photos:** the pictures embedded in a page are outlined, and one click puts
   the frame on a picture's exact edges.

**PDFs are treated as images while cropping** (Gunjan, 2026-10-11): what is saved is
always the framed part of the page as drawn, never a picture's own file pulled out of the
PDF, and never text.

**Out of scope:** text labels (no copying text out of a PDF, no OCR: a label inside the
frame is saved as pixels like anything else); finding drawn artwork, charts and
illustrations made of shapes rather than a picture (they need a dragged frame); finding
photos inside a scanned PDF (the whole page is one picture); Word and PowerPoint (save as
PDF, as today); keeping PDF bytes between page reloads (IndexedDB); several PDFs open at
once.

---

## 1. Decision log

| # | Decision | Choice |
|---|----------|--------|
| PI-D1 | Where the PDF is reached from | **A "From a PDF" tab** (`value: 'pdf'`, icon `file-pdf`, right after My Uploads) in every image picker opened as a dialog. Its result is an image, so every caller that takes images gets it with no change: rich text, image fields, gallery fields, about settings, profile, waitlist. **Not on the Media page**, where Files already has "Take an image" and a second way in would only crowd it. |
| PI-D2 | What the tab shows | **A "Choose a PDF from your computer" card** (also a drop zone for the whole tab), then **the PDFs in Files** as cards: first page, title, page count, newest first, the PDF last used in this visit pinned first. A search box (MF-D23's `matchesSearch`). 24 at a time with "Show more". Listed from `MediaFilesService.listAll` filtered to `type === 'pdf'`: no new query, index or rule. |
| PI-D3 | A PDF from the computer | **Kept in Files automatically** (agreed 2026-10-11), so the next spot, the next content item or another admin can use it again. Its pages open at once from the local bytes; storing it runs alongside. It is stored only once it has opened (a locked or broken PDF is not kept from here). |
| PI-D4 | The same PDF chosen twice | **Not stored twice.** A PDF whose file name and byte size match one already in Files is that one: its record is used and nothing is uploaded. This keeps the space worry (2026-10-11) from growing with every visit. |
| PI-D5 | A PDF dropped on My Uploads | **Replaces the second half of MF-D11.** In a dialog, the picker switches to From a PDF with that PDF open. On the Media page, the page grid opens as today. Either way the PDF is kept in Files (PI-D3), so the "Keep the whole PDF in Files instead" link and the taker's `offerKeepInFiles` input go away. |
| PI-D6 | Saving before the PDF is stored | **Save waits for the PDF's record**, showing "Keeping the PDF in Files, 40%", so every image records its `source` (`{ fileId, page }`). Framing usually takes longer than storing, so the wait is rarely seen. If storing fails (no space, offline, over 20 MB), images still save, without a `source`, and the screen says the PDF was not kept. |
| PI-D7 | What is remembered | **The PDF, the page, the zoom level, and which pictures were taken from each page**, in a root service (`PdfPickerMemory`), for this browser tab until the page is reloaded. Nothing is written to Firestore or the browser's storage. The PDF's bytes stay in `MediaFilesService`'s recent list (the last 3), so a library PDF is read from Storage once per visit, not once per spot. |
| PI-D8 | Where the picker opens | **Where the last image came from.** When the last image chosen in any image picker in this tab came from From a PDF, the next picker opens there, on the remembered PDF and page, in the crop step. Otherwise it opens as today. A caller's `initialTab` always wins. Inserting from another tab clears this, so an admin who moves on is not sent back to the PDF. |
| PI-D9 | Where the frame starts on a page | **On the first picture not yet taken**, in reading order (top to bottom, then left to right). Taken pictures carry a tick. With none found, the frame starts as today (the largest centred frame of the ratio). This is what makes "Insert image, Insert" enough for the next photo. |
| PI-D10 | Finding the pictures | **From the page's drawing instructions** (pdf.js `page.getOperatorList()`), following the drawing position through `save`, `restore`, `transform` and form objects, and taking the box of every picture painted (`paintImageXObject`, `paintInlineImageXObject`). Exact to the point, no image analysis, no server. pdf.js parses the page again for this (milliseconds; pictures are not decoded), so the page shows as soon as it is drawn and the outlines follow. Annotations (stamps) are left out: their position comes from the annotation, which the walk does not follow. Checked on 2026-10-11 against the MF test catalogue: the picture came back at its exact box. |
| PI-D11 | Which pictures count | Pictures **under 48 points (two thirds of an inch) on either side** are left out (bullets, icons, small logos). A picture covering **90% or more of the page** is left out (a scan or a page background: suggesting the whole page helps no one). Stencil masks and repeated tiles are left out. Pictures overlapping by 80% or more of the smaller one count once; pieces whose edges touch and line up are joined into one (some PDF makers cut a photo into strips). Boxes are kept inside the page. At most 40 per page. |
| PI-D12 | Clicking a picture | **The frame takes its edges.** With the ratio on Free or Original, exactly; with a fixed ratio (the caller's `cropRatio`, or one the admin picked), the largest frame of that ratio centred on the picture. The frame can then be dragged as usual. |
| PI-D13 | What is saved | **Unchanged from MF-D14:** the framed part of the page drawn again at the XL size, then stored as a normal upload with every size. A picture partly hidden by a clipping shape or with something drawn over it comes out as it looks on the page. |
| PI-D14 | Zoom | **Fit, 150%, 200%, 300%, 400%**, with minus, plus and Fit buttons, Ctrl or Cmd with the wheel (a trackpad pinch arrives this way), a two-finger pinch on touch screens, and the `+` and `-` keys. A zoomed page scrolls; the frame keeps its place in the page. Past 100% the page is drawn again with more detail: 2400 px on the longest side at 150%, 3200 px (twice the fit view) from 200%; beyond that the browser enlarges it, which is still fine for placing a frame, and keeps a phone's memory safe (decided while building; the first draft said up to the 16 million pixel cap). The zoom stays when moving between pages. |
| PI-D15 | Moving between pages | **Previous and next buttons, "Page 3 of 40" with a box to type a page number, and the Page Up and Page Down keys** in the crop step. "All pages" goes back to the grid, "All PDFs" back to the list (dialog only). |
| PI-D16 | The crop step's buttons in a dialog | **Insert** (primary): saves the image, then closes the picker with it selected at the chosen size and with its alt text, exactly as picking it in My Uploads would. **Save, take another**: saves and stays on the page, the frame moving to the next picture not yet taken. On the Media page there is only **Save as image**, and after it the page stays open with the frame on the next picture too (the first draft kept MF-D15's return to the grid; staying is faster for several pictures on one page). |
| PI-D17 | Size and alt text in the crop step | **In a dialog, the crop step shows the S, M, L, XL size chips** (the picker's own `selectedSize`, so the "too small" note keeps working) **and an optional alt text box**, emptied after each save. The title is still filled in by itself (`admin.media.pdf.image_title`); a second image from the same page in a visit becomes "Brochure, page 3 (2)". |
| PI-D18 | Pickers that take several images | When the caller asked for `multiple` (gallery fields), **Insert returns every image taken in this visit plus the current frame**, and its label says how many ("Insert 3 images"). Single pickers insert only the current frame; images taken earlier with "Save, take another" are in My Uploads for the next spot. |
| PI-D19 | Shared crop component | `ImageCropperComponent` stays generic. It gains three optional inputs: **`frame`** (a frame to place, instead of the centred one; named `frame` because the cropper already has a `rect` signal), **`zoom`** (1 is fit, with **`zoomable`** turning on the gestures that ask for another zoom), and **`marks`** (suggested frames, each drawn as an outline button with a label and a taken flag; clicking one emits `markPicked`). Existing callers pass none of them and see no change. |
| PI-D20 | Rules, functions, indexes | **None change.** Storing a PDF uses the MF upload path and rules; reading one uses `readMediaFile`; the list reuses `listAll`. Nothing to deploy beyond the hosted admin. |

---

## 2. What is true today

- **Picker** (`src/app/pages/admin/(media)/media.page.ts`): tabs My Uploads, Files,
  Unsplash, Icons from `mediaManagerMenu` (common-constants.ts), filtered by `menuItems`
  (`allowImages`, `allowIcons`, `allowFiles`; Files shows in a dialog only with
  `allowFiles`). `insertMedia()` closes with a `MediaSelection` (`mediaUrl`, `mediaUrls`,
  `size`, `alt`, `kind`). A single PDF dropped on My Uploads calls `takeImageFromLocalPdf`
  (not stored); `closePdf()` returns to My Uploads with the last saved image selected.
- **Rich text** (`tiptap-editor.component.ts`, `openMediaManagerModal`): opens the picker
  with `{ isDialogOpen: true }` and inserts `result.mediaUrl` with `result.alt`.
- **Taker** (`pdf-image-taker/`): steps `loading`, `pages`, `crop`, `error`. Inputs
  `source`, `uploadSettings`, `initialRatio`, `sizeLimit`, `offerKeepInFiles`; outputs
  `saved`, `done`, `keepInFiles`. The crop view is the page drawn at 1600 px; Save draws
  the region at `saveScale` as PNG and uploads it with `uploadFile`, then `addBatch` with
  `source` for a library PDF, then returns to the grid.
- **PDF engine** (`src/shared/utils/pdf-pages.ts`): `openPdf` gives `pageCount`,
  `pageSize`, `renderPage`, `renderRegion`, `destroy`; `MAX_CANVAS_PIXELS`, `cappedScale`,
  `saveScale`, `frameToPdfRect`.
- **Cropper** (`src/shared/components/image-cropper`): inputs `src`, `ratio`,
  `crossOrigin`; outputs `rectChange`, `loaded`, `failed`. The frame resets whenever the
  ratio or the image changes; no zoom.
- **Library PDFs** (`media-files.service.ts`): `listAll`, `pdfBytes` (the recent cache of
  3, else `readFile` in 6 MB parts), `rememberBytes`. `FileUploadService.uploadDocument`
  stores a PDF with its page count and thumbnail.

---

## 3. The flow, screen by screen

**First photo** (rich text, Insert image):
1. The picker opens on My Uploads. The admin clicks **From a PDF**.
2. The PDFs in Files show, newest first, under "Choose a PDF from your computer". The
   admin clicks one, or chooses or drops one from the computer (kept in Files, PI-D3).
3. The page grid opens (as today). The admin clicks page 3.
4. The crop step: page 3 fitted, the pictures on it outlined, the frame on the first one.
   Footer: alt text box, size chips, **Save, take another** and **Insert**.
5. The admin clicks another outline, or drags the frame, types alt text, presses **Insert**.
   The image is in the editor.

**Next photo, somewhere else in the same content:**
1. Insert image. The picker opens straight on page 3 of the brochure, the first photo
   ticked, the frame on the second.
2. **Insert.**

**A photo on another page:** Insert image, Next page (or type the number), Insert.

**Several photos for a gallery field:** pick the PDF and page, then Save, take another for
each, then Insert: all of them go in at once.

---

## 4. Phases

Each phase ends with a full suite run, a browser test against the xlm dev project at
localhost:5173 (the worktree's dev server, "pdf-images" in launch.json), the docs it
affects, and a critical review whose critical, high and medium findings are fixed in that
phase.

### PI1. Finding the pictures on a page (the engine)

What it gives: a list of the pictures on any PDF page, in reading order, ready for the
crop step. Nothing visible yet.

1. `pdf-pages.ts`: a pure function `picturesFromOperators(ops, pageViewport)` taking the
   operator list (`fnArray`, `argsArray`) and the page's viewport transform (so rotated
   pages come out right), returning `PdfRect[]` in page points from the top left. It keeps
   the drawing position through `save`, `restore`, `transform`,
   `paintFormXObjectBegin` (its matrix) and `paintFormXObjectEnd`, and boxes each
   `paintImageXObject` and `paintInlineImageXObject` (the unit square through the current
   position). Then the PI-D11 rules: size floor, page share, overlap merge, strip join,
   page clip, limit, reading order (rows grouped when boxes share half their height).
2. `PdfDocument.findPictures(pageNumber): Promise<PdfRect[]>`, using the same
   `display` intent as `renderPage` so pdf.js reuses what it parsed. A page whose
   instructions cannot be read gives `[]`, never an error.
3. `snapFrame(picture, ratio)`: PI-D12's frame for a picture and a ratio.
4. Test PDFs (the Swift generator in the scratchpad, extended): a page with four photos,
   a photo cut into strips, a full-page scan, tiny icons, a photo inside a form object,
   a rotated page, a clipped photo, a page of drawn artwork only.
5. Tests: `pdf-pages.spec.ts` for the walk (nesting, forms, rotation), each PI-D11 rule,
   reading order and `snapFrame`, with made-up operator lists.
6. Critical review of PI1.

### PI2. A better crop step (everywhere the taker opens)

What it gives: zoom, page navigation and snap to photos, on the Media page (Files, Take an
image) and in the picker's existing My Uploads path.

1. `ImageCropperComponent`: the `rect`, `zoom` and `marks` inputs and the `markPicked`
   output (PI-D19). Marks are buttons in the frame layer ("Picture 2 of 4", "taken"),
   reachable with Tab, under the frame so dragging the frame still works.
2. Taker: holds the frame in PDF points, so a redraw at more detail or a zoom keeps it in
   place. Zoom (PI-D14) with a scrolling view and a redraw past 100%. Page navigation
   (PI-D15). `findPictures` per page, the frame starting on the first picture not taken
   (PI-D9), ticks on taken ones, a click snapping the frame (PI-D12). A hint under the
   page when nothing is found: "No separate pictures on this page. Drag the frame around
   the part you want."
3. Remove `offerKeepInFiles` and "Keep the whole PDF in Files instead"; a PDF dropped on My
   Uploads is stored in Files with PI-D4's check (PI-D5).
4. Tests: taker spec (navigation, zoom keeps the frame, snap with each ratio, start on
   the next untaken picture, no pictures found), cropper spec (the three inputs, existing
   callers unchanged), media page spec (a dropped PDF is stored once).
5. Docs: docs/features/media.html, Take an image from a PDF (zoom, pages, pictures,
   what is not found). Screenshot of the crop step.
6. Browser test on the Media page with the PI1 test PDFs, at desktop and phone width.
7. Critical review of PI2.

### PI3. From a PDF in the image pickers, and the picker's memory

What it gives: the PDF is reachable from Insert image and every other image picker, and
comes back where it was left.

1. `mediaManagerMenu`: the From a PDF tab (`kind: 'image'`); `menuItems` hides it on the
   Media page (PI-D1).
2. The tab (a new `arc-media-pdf-tab` component): the choose card and drop zone, the PDF
   cards from `listAll`, search, Show more, the last used PDF first (PI-D2). Choosing one
   opens the taker in the tab. A PDF from the computer opens at once and is stored
   alongside (PI-D3, PI-D4, PI-D6), its bytes remembered under its new id.
3. `PdfPickerMemory` (root service, PI-D7): `remember(fileId, title, page, zoom)`,
   `markTaken(fileId, page, rect)`, `lastFromPdf` (PI-D8), cleared from other tabs'
   inserts. The picker reads it in `ngOnInit` to open on the PDF, page and crop step.
   A remembered PDF that was deleted, or cannot be read, falls back to the list with
   "That PDF is no longer in Files."
4. Breadcrumb in the taker inside the tab: "All PDFs" and "All pages".
5. Tests: tab spec (list, filter to PDFs, search, local choose and dedupe, store failure),
   memory spec, media page spec (opens on the remembered page, `initialTab` wins, cleared
   by another tab's insert, hidden on the Media page).
6. Docs: docs/features/media.html (From a PDF in pickers, kept in Files, remembered until
   reload); docs/features/content.html where rich text images are described.
7. Browser test: rich text Insert image, a library PDF and a computer PDF, the second
   opening on the remembered page; an image field and a gallery field.
8. Critical review of PI3.

### PI4. Insert from the crop step

What it gives: the two-click loop.

1. Taker inputs for a dialog: `insertable` (true in a picker dialog), `multiple`, the
   size (`selectedSize` in and out), and an `inserted` output. Footer: alt text box, size
   chips, Save, take another, Insert (PI-D16, PI-D17). Media page footer unchanged.
2. Picker: `insertFromPdf(saved, alt)` closes with a `MediaSelection` built the same way
   `insertMedia()` builds one (`urlAtSize`, `size`, `alt`), and with `mediaUrls` for every
   image taken in this visit when `multiple` (PI-D18). Marks the memory (PI-D8).
3. Title numbering for a second image from the same page (PI-D17).
4. Tests: taker (Insert saves then emits once; Save, take another moves the frame on; alt
   saved and cleared), picker (single and multiple selections, size and alt), rich text
   (inserts with alt).
5. Docs: docs/features/media.html and content.html (the two-click loop, gallery fields).
   Screenshots of the From a PDF tab and the crop step in a dialog.
6. Browser test of the whole flow: four photos from one brochure into four places in one
   content item, then a gallery field, then a page reload (memory gone, list still there).
   `npm run docs:affected`, `npm run check:docs`, full suite.
7. Critical review of PI4 and of the whole feature against this spec.

---

## 5. Tests and checks summary

- Unit: `pdf-pages.spec.ts` (picture finding, snapping), cropper, taker, PDF tab, memory,
  media page, tiptap editor.
- No rules change, so `test:rules` is run only if a rules file is touched by mistake.
- Browser: the PI1 test PDFs, the MF 17.6 MB catalogue (read once per visit), phone width.

## 6. Risks and limits

- **Drawn artwork is not found.** A "photo" made of shapes (vector illustrations, charts,
  the MF test brochure) has no picture to find; the frame starts centred and the hint
  says to drag it. Most brochures from photographers and print shops embed real photos.
- **Scanned PDFs** are one picture per page, left out by PI-D11; framing is by hand.
- **Clipped pictures** snap to the picture's full box, which can be larger than what shows
  (a photo in a circle, or trimmed by a shape). The frame can be dragged in; what is saved
  is what shows (PI-D13).
- **Memory** is per browser tab and lost on reload, by design (PI-D7).
- **Space:** every PDF opened from the computer is now kept (PI-D3), at most once each
  (PI-D4). Files shows them, so they can be deleted.

## 7. Assumptions to confirm

1. From a PDF is not added to the Media page (Files already has Take an image).
2. A PDF that matches one in Files by name and size is treated as the same PDF.
3. A PDF that is locked or cannot be opened is not kept in Files from the From a PDF tab.
4. The picker opens on the PDF only when the last image came from a PDF; any other insert
   resets it.
5. Pictures under 48 points on a side, or covering 90% or more of the page, are not
   suggested.
6. Single pickers insert only the current frame; gallery pickers insert everything taken
   in the visit.

## 8. Changes made while building (2026-10-11)

- **The cursor moves past an inserted image** (`insertImageAndMoveOn`, tiptap-editor/service/insert-image.ts). Left selected, the image was replaced by the next Insert image, which the two-click loop made easy to do; when the image ends the text an empty paragraph follows it.
- **A library PDF read from Storage is kept for the visit** (`MediaFilesService.pdfBytes`), as PI-D7 says; before, only uploads were kept and each picker read the PDF again.
- **Thumbnails pause while a page is open to crop**, so the page opens first.
- **Two quick zooms keep the frame**, and an older, less detailed drawing finishing late is dropped.
- **Wheel zoom** is about 1.3 times a mouse wheel notch; the first build jumped nearly twice per notch.
- **The admin menu loads its own translations** (side-navbar.component.ts). Found while testing: on a URL with no page of its own, such as `/admin/contents`, nothing asked for the language file and the menu showed bare keys (`admin.nav.dashboard`). Not part of PI, but small and in the same build.
- MF-D11's "Keep the whole PDF in Files instead" link is gone (PI-D5): every PDF opened is kept.

**Review fixes (2026-10-11, critical review of PI1 to PI4):**
- A press inside the frame always moves it, also over an outline (before, a frame snapped with a fixed ratio, or trimmed inside a picture, could not be dragged: the press re-snapped it). A picture's number always picks it.
- A frame is placed only on the image it was meant for, and Save and Insert wait while a sharper drawing loads, so a zoom can no longer save the wrong part of the page.
- The crop step's page gets less height (more rows than the plain crop step), so at Fit the whole page and its handles stay in view in a picker.
- A gallery's Insert takes the images from every PDF used in the visit, not only the open one.
- A PDF dropped on an open PDF in From a PDF opens it, instead of the browser leaving for the file.
- The page shows as soon as it is drawn; outlines follow. Annotations are left out of picture finding.
- Smaller: a fixed-ratio frame inside a picture keeps to it when the ratio changes; zoom waits while saving; outlines say "taken" to screen readers; "All PDFs" is in the crop step too; the same PDF opened twice at once uploads once; an offline read no longer forgets the PDF; "Pages: 12" instead of "12 pages" (no "1 pages"); the cropper's wheel and key zoom are off for callers that do not ask for zoom (`zoomable`).

## 9. Snap to photos removed (2026-10-20)

Gunjan, 2026-10-20: the automatic photo finding did not work well enough on real brochures, so it is gone; framing is by hand, as in any crop step. A review that day found why it misses: it ignores clipping paths (most layout tools trim a placed photo with a frame, so the outline is the whole placed photo, not what shows), a larger picture under photos (a background panel under 90% of the page) swallowed every photo on it through the "near copy" rule, and photos that touch with no gap were joined as "strips".

What went:
- `findPictures`, `picturesFromOperators`, `readingOrder`, `snapFrame` and the PI-D11 limits in `src/shared/utils/pdf-pages.ts`.
- The cropper's `marks` input and `markPicked` output (PI-D19); `frame`, `zoom` and `zoomable` stay.
- In the taker: outlines, ticks, the frame starting on the next picture (PI-D9), snapping on a click (PI-D12) and on a ratio change. A page opens with the centred frame; after **Save, take another** the frame stays where it was; a new ratio starts a fresh centred frame.
- `PdfPickerMemory.markTaken` and `takenOn`; the memory keeps the PDF, page and zoom (PI-D7, PI-D8).
- The strings `admin.media.pdf.picture_label`, `picture_label_taken`, `pictures_found` and `no_pictures`; the hint under the page is now `admin.media.pdf.crop_hint` ("Drag the frame around the part you want.").

Everything else in this spec (From a PDF, the remembered place, Insert from the crop step, zoom and page navigation) is unchanged.

