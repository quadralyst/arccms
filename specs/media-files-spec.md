# Documents in the Media Library, and Images from PDFs: Build Spec (MF)

**Status:** BUILT 2026-10-11 (MF1 to MF5), browser-tested on the xlm dev project, reviewed. Not merged.
**Branch:** `feat/media-files`, cut from `dev` (45be9e8, brought up to a805ec6), worktree `../arccms-media-files`.

**Scope:**
1. **Files in the media library.** Admins upload PDFs, Word, Excel, PowerPoint, CSV and
   text files to a new Files tab, next to My Uploads, Unsplash and Icons.
2. **Files on pages.** Content links to them: a file card in rich text, a new `file`
   field type, template bindings, and an `allowFiles` option on the picker for any caller.
3. **Images from a PDF.** Take an image from any page of a PDF with the crop step admins
   already know. First from a PDF on the admin's computer (MF3, the PDF is not stored),
   then from a PDF in the library (MF4).
4. **Details and search.** Every image and file has a title, notes for staff, and (images)
   alt text; a search box finds them (MF5). Media details become staff-only to read.

**Out of scope:** choosing which image sizes to store at upload (discussed and dropped
2026-10-11: every upload keeps S, M, L and XL); tags; audio and video; ZIP; cropping from Word or PowerPoint (the screen says
to save it as a PDF); server-side conversion; folders and tags in the library; members-only
files (they are public, MF-D5); a different file per language; replacing a file while
keeping its link; PDF text in site search; "used on" before delete. The last four are in
section 8.

---

## 1. Decision log

| # | Decision | Choice |
|---|----------|--------|
| MF-D1 | Where files live in the UI | **A Files tab in the existing media manager.** One library, no new admin page or menu item. The tab's `kind` is `'file'`, beside `'image'` and `'icon'` (media.page.ts, `MediaMenuItem`). |
| MF-D2 | Where file records live | **A new collection, `mediaFiles`**, not a `kind` field on `media`. Every image picker reads `media` ordered by `uploadTime`; documents mixed in would show in all of them, and filtering them out would need every old `media` document backfilled, because Firestore cannot query for a missing field. A separate collection leaves every existing caller untouched. |
| MF-D3 | Allowed types | **PDF, Word (.docx, .doc), Excel (.xlsx, .xls), PowerPoint (.pptx, .ppt), CSV, plain text.** Never HTML, SVG, scripts, ZIP or macro files (.docm, .xlsm, .pptm): hosting those on the site's bucket invites phishing pages and malware links. |
| MF-D4 | Size cap | **20 MB per file**, one fixed constant, no new setting. Images keep their own setting (Settings > Misc, 5 MB by default) because they are resized in the browser; documents are stored as they are. |
| MF-D5 | Who can open a file | **Anyone with the link**, like images today (storage.rules: public read outside `users/` folders). The Files tab says so in one line under the upload card. Members-only files are a later feature tied to entitlements. |
| MF-D6 | How the type is decided | **By the file's extension**, not the browser's MIME guess (Windows reports CSV as `application/vnd.ms-excel`, some browsers report nothing). The uploader sets the content type from the extension; the rules check the two agree. |
| MF-D7 | Open or download | **PDF and text open in a browser tab** (`Content-Disposition: inline`); **Office files and CSV download** (`attachment`). Both carry the file's title as the download name. |
| MF-D8 | Title | Each file has an editable **title**, defaulting to the file name without its extension, with `-` and `_` turned into spaces ("Annual-Report_2025.pdf" becomes "Annual Report 2025"). The title is the link text on pages. |
| MF-D9 | Thumbnails | **A PDF's first page**, drawn in the browser at upload (longest side 400 px, JPEG, which every browser can encode; Safari quietly gives PNG when asked for WebP) and stored beside it. Other types show a type icon. No server work. |
| MF-D10 | Feature switch | **None.** The media library is always on (feature-routes.ts lists `admin/media` among the core routes); Files is part of it. |
| MF-D11 | A document dropped on My Uploads | MF1: any document goes to Files and the tab switches there, with a short note. From MF3: **a PDF opens "Take an image"** instead (My Uploads is the images tab, so the admin wants an image), with a link "Keep the whole PDF in Files instead". Word, Excel and the rest still go to Files. |
| MF-D12 | Storage rules | Files get their own folder, **`mediaFiles/`** (after the install's upload folder, when it has one), whose rules enforce the types and the cap. The general "staff may write anywhere" rule stops covering that folder; otherwise it would still allow anything there, since a write is allowed when any rule allows it. `mediaImages/` is **not** narrowed: Data > Import Files lets staff upload any file to any folder they type (import-files.page.ts, `targetPrefix`), so narrowing one folder adds little and would break imports (decided while building MF1). |
| MF-D13 | PDF engine | **pdf.js (`pdfjs-dist`)**, loaded only when a PDF is opened (a dynamic import), never on the server. The admin's first load and `npm run build` memory stay as they are. Pinned at 6.3.289: CVE-2024-4367 was fixed in 4.2.67, and from 5.0 pdf.js evaluates no code from a font at all, so the old `isEvalSupported` setting no longer exists. |
| MF-D14 | Image quality from a PDF | The crop frame works on a page drawn for the screen. **Save draws only the cropped part again**, at the scale that makes it at least the XL size (`maxSize`, 1200 px by default). Text and vector art stay sharp. A photo inside the PDF cannot be sharper than the photo the PDF holds; the existing "too small" note shows when the result is under the size picked. Drawing is capped at 16 million pixels (the iPhone Safari canvas limit). |
| MF-D15 | After Save as image | **Stay on the pages** with "Saved to My Uploads", so several images can be taken from one brochure without starting again. The new image is a normal upload (every size, WebP when that setting is on) named `{pdf name}-p{page}`. |
| MF-D16 | Reading a stored PDF back | A new admin-only callable, **`readMediaFile`**, which reads the PDF **in parts** of 6 MB. One callable reply holds about 10 MB (readMediaImage.ts, `MAX_MEDIA_READ_BYTES`), and base64 adds a third, so a 20 MB PDF cannot come back in one reply. The file is found from its `mediaFiles` document, never from a path the caller names. No bucket CORS setup is needed, matching `readMediaImage`. When the browser still has the bytes (just uploaded, or picked from the computer), nothing is read. |
| MF-D17 | Locked and broken PDFs | A password-protected PDF is refused with "This PDF is locked with a password. Remove the password, then try again." No password box. A PDF pdf.js cannot read gets "This PDF could not be opened." Both still upload to Files (they are valid files to link to); only the thumbnail and "Take an image" are skipped. |
| MF-D18 | The `file` field's value | **Always a list of rows**, also when the field holds one file: `[{ url, title, type, bytes, pages? }]`. One shape for one or several files, and the template loop works for both. The "Several files" checkbox only changes how many rows the editor lets you add. |
| MF-D19 | Translation | A `file` field is **not translatable**, like an image: every language links the same file. A different file per language is out of scope. |
| MF-D21 | Details | **Title, notes and (images only) alt text**, for images and files alike, edited in the preview side panel. Nothing extra is asked at upload: the title fills itself from the file name (MF-D8), the rest is optional. No tags: words in notes do the same job. |
| MF-D22 | Alt text in use | The picker returns the image's alt text with the selection; Insert image in rich text puts it in the image's `alt`. A content image field stores a URL only, so templates keep their own `alt` (unchanged). |
| MF-D23 | Search | **A search box at the top of My Uploads and Files**, matching title, notes, alt text and file name, case-insensitive, every word must match. Typing loads that tab's details once per visit and filters in the browser (Firestore has no word search); fine to a few thousand items. Clearing the box returns to the paged list. |
| MF-D24 | Who reads media details | **Staff only** (`isEditor()`) for `media` and `mediaFiles` documents, so notes stay private. The files themselves stay public. Only admin screens and Data export read these documents (checked 2026-10-11); pages use the file URLs. |
| MF-D20 | Rich text | The existing **"Attach files"** slash command (slash-commands.ts, which does nothing today) opens the picker on Files and inserts a file card. A document dropped or pasted into the editor uploads to Files and inserts a card, instead of today's `[File: name]` text (file-handler-extension.ts). |

---

## 2. What is true today

- **Media library** (`src/app/pages/admin/(media)/media.page.ts`): tabs My Uploads,
  Unsplash and Icons. Each tab has a `kind` (`'image'` or `'icon'`) and a caller's
  `allowImages` / `allowIcons` hide the tabs it cannot use; one tab left means no tab bar.
  Selection returns `mediaUrl`, `mediaUrls`, `size`, `kind`, `icon`.
- **Uploads** (`src/shared/services/file-upload.service.ts`): `ALLOWED_IMAGE_TYPES` is
  JPEG, PNG, WebP and GIF. `uploadFile` stores S/M/L/XL under
  `withStoragePrefix('mediaImages/...')`; `uploadCroppedCopy` stores a crop as a new upload
  with `-crop`; `storeSizes` does both. `deleteMediaItem` removes every size and the doc.
- **Cropping:** `ImageCropperComponent` (src/shared/components/image-cropper) with
  `CROP_RATIOS`, `cropTooSmall`, and bytes read through `readMediaImage`
  (functions/src/integrations/readMediaImage.ts, admin only, 7 MB cap).
- **Rules:** `firestore.rules` `media/{docId}`: read anyone, write `isEditor()`.
  `storage.rules`: staff write anything at any path outside the per-user folders; anyone
  reads outside `users/`. Tests: `tests/rules/firestore.rules.spec.ts`,
  `tests/rules/storage.rules.spec.ts`.
- **Rich text** (src/shared/components/tiptap-editor): "Insert image" calls
  `window.uploadImage()`; "Attach files" has an empty command; a dropped image becomes an
  uploaded image since e14ec2a (EditorImageUploadService, file-handler-extension.ts, a
  placeholder while it uploads), a dropped document becomes the text `[File: name]`.
- **Field types:** `ContentTypeFieldType` (content-types.model.ts) has `image` and
  `gallery` but no file. The type list for new fields is in `add.page.ts` and
  `edit.[contentTypeId].page.ts`; the content form renders each type in
  `create-content.component.html`; template bindings per type are in
  `src/shared/utils/template-reference.ts`; hydration is keyed on a value's shape, not its
  field type, in `template-hydration.service.ts` and its functions mirror
  `functions/src/shared/template-hydration.ts`.
- **Data move:** Data > Export Files and Import Files read the `media` collection only
  (`src/app/pages/admin/(data)/export-files`, `import-files`, `data-constants.ts`).

---

## 3. Data model

**`mediaFiles/{id}`** (read and write: `isEditor()`, like `media` from MF5)

| Field | Example | Notes |
|---|---|---|
| `title` | `Annual Report 2025` | Editable; link text (MF-D8) |
| `notes` | `Price list for the Pune store` | Optional, staff only (MF-D21, MF-D24) |
| `name` | `annual-report-2025-k3f9qa.pdf` | Stored file name |
| `downloadURL` | `https://firebasestorage...` | |
| `path` | `mediaFiles/annual-report-2025-k3f9qa.pdf` | With the install's upload folder in front when it has one |
| `type` | `pdf` | One of `pdf`, `word`, `excel`, `powerpoint`, `csv`, `text` |
| `contentType` | `application/pdf` | Set from the extension (MF-D6) |
| `bytes` | `2411724` | |
| `pages` | `24` | PDFs only, when pdf.js could read it |
| `thumbnail` | `{ url, path, width, height }` | PDFs only (MF-D9) |
| `uploadTime` | timestamp | The tab's sort order |

**Storage:** `mediaFiles/{name}-{random}.{ext}` and `mediaFiles/{name}-{random}-thumb.jpg`.

**Allowed files** (one table, shared by the uploader and a test that checks the rules agree):

| Extension | Content type | `type` | Opens |
|---|---|---|---|
| .pdf | application/pdf | pdf | inline |
| .docx | application/vnd.openxmlformats-officedocument.wordprocessingml.document | word | attachment |
| .doc | application/msword | word | attachment |
| .xlsx | application/vnd.openxmlformats-officedocument.spreadsheetml.sheet | excel | attachment |
| .xls | application/vnd.ms-excel | excel | attachment |
| .pptx | application/vnd.openxmlformats-officedocument.presentationml.presentation | powerpoint | attachment |
| .ppt | application/vnd.ms-powerpoint | powerpoint | attachment |
| .csv | text/csv | csv | attachment |
| .txt | text/plain | text | inline |
| -thumb.jpg | image/jpeg | (thumbnail) | inline |

**`media/{id}` gains** `title` (written at upload from the file name; older uploads show
their file name until edited), `alt` and `notes`, all optional.

**An image taken from a library PDF** is a normal `media` document plus
`source: { fileId, page }`, so it can be traced back. One taken from a PDF on the admin's
computer (MF3) has no `source`.

**A `file` field's value** (MF-D18): `[{ url, title, type, bytes, pages? }]`.

---

## 4. Screens

### Files tab
- An **Upload file** card first in the grid, the same size as a photo tile, accepting
  several files at once. One line under it: "Anyone with the link can open files here."
- **File cards:** the PDF's first page or a type icon, the title, and "PDF · 2.3 MB".
- **Preview panel** (the existing side panel): title (editable, saved on blur), type, size,
  pages, upload date, **Copy link**, **Open**, **Delete**. For a PDF, MF4 adds the pages
  and **Take an image**.
- **Delete** confirms with: "Pages that link to this file will stop working." It removes
  the file, its thumbnail and the document. Images taken from it stay.
- **Errors** in plain words: "This file type can't be uploaded. Use PDF, Word, Excel,
  PowerPoint, CSV or text." and "This file is 31 MB. Files can be up to 20 MB."

### Take an image (MF3 from the computer, MF4 from the library)
- Page thumbnails in a grid, drawn as they scroll into view (a 300-page PDF must not draw
  300 pages up front). Clicking one opens it in the **existing crop step**: the same
  ratios, the caller's `cropRatio` preselected, the same "too small" note.
- **Save as image** draws the cropped part at full quality (MF-D14), uploads it, and
  returns to the pages with "Saved to My Uploads" (MF-D15). **Done** returns to My
  Uploads with the newest image selected, as a cropped copy does today.
- Word or PowerPoint in Files: no "Take an image"; the panel says "To take images from
  this file, save it as a PDF and upload that."

### Picker contract (`MediaDialogData`, `MediaSelection`)
- `allowFiles?: boolean`, **false by default**, so no existing caller changes. A caller
  with only `allowFiles` gets the Files tab alone, without a tab bar (the existing rule).
- Selection: `kind: 'file'` and `file: MediaFileRef` (`{ id, url, title, type, bytes,
  pages? }`); with `multiple`, `files: MediaFileRef[]`. `mediaUrl` holds the first file's
  URL, so a caller that knows nothing new still gets a working link.

### Content type editor and content form
- New field type **File** with one option, **Several files**.
- Content form, empty: "Choose a file". Filled: one row per file (icon, title,
  "PDF · 2.3 MB"), **Change** and **Remove**; with Several files, **Add file** and drag
  to reorder.

### Rich text file card
- One anchor so every sanitiser and SSR keeps it:
  `<a class="arc-file" data-arc-file="pdf" href="..." target="_blank" rel="noopener">`
  `<span class="arc-file-title">Annual Report 2025</span>`
  `<span class="arc-file-meta">PDF · 2.3 MB</span></a>`.
- Shown as a card in the editor (a tiptap node), with Change and Remove on hover.
- A small default style for `.arc-file` in the site's base styles; a template can restyle it.

### Template bindings
- `data-arc-loop="{key}"` rows: `{{ url }}`, `{{ title }}`, `{{ type }}` ("PDF"),
  `{{ size }}` ("2.3 MB"), `{{ pages }}`. Detail pages only, like other loops.
- First-file siblings everywhere, lists and cards included: `{{ key_url }}`,
  `{{ key_title }}`, `{{ key_type }}`, `{{ key_size }}`. For a "Download brochure" button
  with no loop.
- Hydration finds a file list by its shape (rows with a string `url` and a number
  `bytes`), like `flattenImageSizes`, in both hydration copies.

---

## 5. Security

- **Storage** (MF-D12): `mediaFiles/{name}` and `{prefix}/mediaFiles/{name}`: create and
  update by staff only when the name's extension and the content type are a pair in the
  table (section 3) and the size is under 20 MB; delete by staff. The general staff-write
  rule excludes `mediaFiles` at the first and second level. `mediaImages/` is unchanged
  (MF-D12).
- **Firestore:** `media/{id}` and `mediaFiles/{id}`: read and write `isEditor()` (MF-D24).
- **`readMediaFile`:** `requireAdmin`, `fileId` without `/`, the path read from the
  document and required to sit directly under `{prefix}mediaFiles/`, PDFs only, 20 MB cap,
  `offset` a whole multiple of the part size and inside the file.
- **pdf.js** (MF-D13): pinned version (6.3.289), loaded in the browser only; only page
  drawing is used, so scripts in a PDF never run.
- **Rich text links:** the file card is built from the picked file's record, never from
  typed HTML; its `href` must be the bucket's download URL.

---

## 6. Phases

Every phase ends with a browser check of every screen it touched (localhost:5173 against
the dev project; functions deployed first when the phase changes one), the docs for that
phase (`npm run docs:affected`, then retake screenshots of changed screens), the full suite
run alone with a full log (`npm run test`, and `npm run test:rules` with Java 21 when rules
changed), and a critical review of the phase: correctness, security, every touched screen,
data, tests, docs, drift from this spec. Critical, high and medium findings are fixed
before the phase closes. New admin strings go in English and Hindi, then
`npm run i18n:keys` (restart a running dev server after it).

### MF1. Files in the library
1. Data > Import Files, upload mode: a document (by the allowed-files table) goes to
   `mediaFiles/` with a `mediaFiles` record, whatever folder is typed; other files keep
   today's behaviour.
2. `src/shared/utils/media-files.ts`: the allowed-files table, `fileTypeOf(name)`,
   `defaultTitle(name)`, `formatBytes(n)`, `MAX_FILE_BYTES`. A mirror for the functions if
   MF4 needs it.
3. Rules: `mediaFiles` in firestore.rules and storage.rules (section 5); the general rule
   excludes `mediaFiles`.
4. `FileUploadService`: `uploadDocument(file, progress)` (type by extension, cap, content
   type and disposition set, PDF thumbnail and page count through a lazily loaded pdf.js
   helper, `src/shared/utils/pdf-pages.ts`). `MediaFilesService` (as built): a paged list
   of `mediaFiles` by `uploadTime`, details updates, and `deleteFile(id)` (file, thumbnail,
   doc).
5. Files tab, upload card, file cards, preview panel, delete, copy link (section 4). A
   document dropped on My Uploads goes to Files (MF-D11).
6. Data > Export Files and Import Files include `mediaFiles` (as built: the file and its
   details travel; the first-page thumbnail is drawn again on import, not exported).
7. Tests: the helpers; `uploadDocument` (type by extension, refused types, the cap,
   disposition, thumbnail skipped for a locked PDF); the tab and preview; a test that the
   storage rules and the allowed-files table agree; rules tests for `mediaFiles` (types,
   size, staff only, delete); export and import.
8. Docs: docs/features/media.html (Files, what it stores, who can do what),
   docs/reference/data-model.html, docs/features/data.html, the security rules page.
   Screenshots of the Files tab.
9. Rules deploy (firestore and storage) to the dev project; browser check: upload each
   type, a 25 MB PDF (refused), an .html renamed .pdf is stored as a PDF and opens as one,
   a locked PDF (uploads, no thumbnail), delete, export and import.
10. Critical review of MF1.

### MF2. Files on pages
1. Picker: `allowFiles`, `MediaFileRef`, `kind: 'file'`, `file` / `files` (section 4).
2. `file` field type: content-types model, add and edit type pages (Several files), the
   content form, not translatable (content-translation.model.ts).
3. Templates: `customFieldReference` and `LOOP_ROWS` for `file`; `flattenFiles` in both
   hydration copies; the site's default `.arc-file` style.
4. Rich text: the file card node; "Attach files" opens the picker on Files; a dropped or
   pasted document uploads and inserts a card (MF-D20). Images dropped into the editor
   are not changed here (section 8).
5. Tests: picker contract (default unchanged, files only, multiple); field type in the
   type editor and content form; template reference rows; hydration of one and several
   files in both copies (and that a plain list of rows without `bytes` is left alone);
   the card node's HTML survives `sanitizeHtml` and SSR; slash command and drop.
6. Docs: docs/features/content.html (the File field), docs/features/templates.html
   (bindings), docs/features/media.html (picker options for developers). Screenshots of
   the field in the content form and a card in the editor.
7. Browser check: a type with a File field (one, then several), a published page with the
   bindings, a rich text card, dropping a PDF into the editor.
8. Critical review of MF2.

### MF3. Take an image from a PDF on the computer
1. "Take an image" screen (section 4) fed by a local PDF; nothing is stored but the images.
2. `pdf-pages.ts`: page thumbnails drawn on scroll, one page for the crop frame, and the
   cropped part drawn again at the save scale (MF-D14, the 16-megapixel cap).
3. Save as image: through the existing upload (`storeSizes`), named `{pdf}-p{page}`; stay
   on the pages (MF-D15).
4. A PDF dropped on My Uploads opens this screen, with "Keep the whole PDF in Files
   instead" (MF-D11). Locked and unreadable PDFs get their messages (MF-D17).
5. Tests: the save scale (small crop on a big page, a crop already over XL, the pixel cap);
   naming; the drop routing; locked and broken PDFs; staying on the pages after a save.
6. Docs: docs/features/media.html (Take an image from a PDF). Screenshots of the pages and
   the crop step.
7. Browser check with a text PDF, a scanned PDF, a large brochure, a locked PDF, and on a
   phone-width window.
8. Critical review of MF3.

### MF4. Take an image from a PDF in the library
1. `readMediaFile` callable (MF-D16, section 5), exported in functions/src/all.ts.
2. The preview panel of a library PDF shows its pages and Take an image; bytes come from
   the browser when it still has them, else from `readMediaFile` in parts, with progress.
   Saved images carry `source: { fileId, page }`.
3. Tests: the callable (admin only, document path only, PDFs only, cap, parts reassemble
   to the same bytes, bad offsets refused); the panel using local bytes when it has them.
4. Docs: docs/features/media.html, docs/reference/cloud-functions.html. Screenshot of
   the panel with pages.
5. Deploy only `readMediaFile` to the dev project; browser check with a 1 MB and an
   18 MB library PDF.
6. Critical review of MF4.

### MF5. Details and search
1. `media` uploads write `title`; the preview panel of both tabs edits title, notes and
   (images) alt, saved on blur.
2. Picker selection carries `alt`; Insert image in rich text uses it (MF-D22).
3. Search box (MF-D23) in My Uploads and Files.
4. firestore.rules: `media` and `mediaFiles` read by staff only (MF-D24); rules tests.
5. Tests: search matching (words, case, every field), panel saves, alt carried through,
   rules.
6. Docs: docs/features/media.html (details, search, who reads), data model, security
   rules page. Screenshots of the panel and a search.
7. Rules deploy; browser check: edit details, search, insert an image with alt text, a
   signed-out read of a `media` document is refused.
8. Critical review of MF5, then of the whole branch (as MF4 step 6 says).

MF3 does not need MF1 or MF2 and can be built first if images from PDFs are wanted sooner.

---

## 7. Acceptance

- Every existing image picker, upload, crop and template behaves exactly as before (the
  existing tests pass unchanged).
- An admin uploads a PDF, a Word file and a CSV; the PDF shows its first page; the PDF
  opens in a tab and the others download, each under its title.
- An .html, .svg or .zip file, or a 25 MB PDF, is refused with a plain message, and the
  same write straight to Storage is refused by the rules.
- A content type with a File field shows the files on a published page through both the
  loop and the `key_` bindings; a rich text file card survives publishing.
- From a 40-page brochure on the computer, an admin takes three images in one visit
  without the PDF being stored; each is a normal upload with every size.
- The same from an 18 MB PDF in the library works without a bucket CORS setup.
- An admin finds an image by a word from its notes, and an inserted image carries its alt
  text; a signed-out visitor cannot read media details but still sees every image.
- The admin's first load is no larger than before (pdf.js loads only with a PDF), and
  `npm run build` stays within its memory.

---

## 8. Later

- **Replace a file, keep its link:** for a price list or menu that changes. Check first
  whether overwriting a Storage object keeps its download token.
- **PDF text in site search,** through the search feature's custom-sources plug point.
- **Members-only files,** served through a function that checks entitlements.
- **"Used on" before delete,** for images and files alike.
- **Images dropped into rich text** are stored in the content as data URLs today, not
  uploaded to the library. Worth its own fix.
