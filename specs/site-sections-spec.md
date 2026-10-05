# Editable Site Sections: Build Spec

**Status:** Spec only, not built. Written 2026-10-05; standard pages and the contact form added and every decision settled the same day. Checked against `dev` at 17d7ae1 (after the website docs backlog, 824ce0b).
**Branch:** `feat/site-sections`, to be cut from `dev`, in a worktree (`../arccms-site-sections`) so the main checkout's dev server keeps running.
**Codes:** phases are SS1 to SS7 and decisions SS-D1 onwards. (The website docs backlog in `specs/website-docs-review.md` already uses B1 to B7.)

**Scope:** let an admin edit the sections a converted HTML mockup usually has (services, a hero, FAQs, contact details, social links) without a developer, and ship the standard pages every site needs (About, Contact, FAQ, Privacy, Terms, Cookies) as admin-edited pages, with a working contact form.

| Phase | What it does |
|---|---|
| **SS1** Cards from data-only types | The home page's card block (`<arc-content-partials>`) works for a content type with *Generate public pages* off, so Services, Hero or Testimonials are edited in the admin without each item getting its own public page. |
| **SS2** Your own order | A content type can be set to *Your own order*: admins drag entries into place, and the list page and home page cards follow that order instead of newest first. |
| **SS3** Site info on pages | Phone joins Settings, About; `data-arc-site` attributes print the site's name, email, phone, address, logo and social links in the header, footer, home page, templates and static pages, so contact details are edited once. |
| **SS4** FAQ field | A new repeating custom field, FAQ (question and answer rows, like Info Cards), with FAQPage structured data on the page. |
| **SS5** Contact form | A new switchable feature, `contact`: `<form data-arc-contact-form>` on any published page, a public function with spam checks, a **Messages** inbox in the admin, and a bell and email alert to admins. Includes running the live parts script (`arc-site.js`) on every published page, not only the home page. |
| **SS6** Standard pages | A built-in **Pages** content type at `/info/...` with About, Contact, FAQ, Privacy Policy, Terms and Cookie Policy as drafts. One template whose sections (map, FAQ, contact details, contact form) turn on per page. The signup terms notice and the cookie banner link to these pages once published. |
| **SS7** Docs walkthrough and changelog | One docs page that builds a services block, a hero, an FAQ and a contact footer from a mockup; the example files; the changelog. |

**Out of scope:** an admin menu manager for header and footer navigation (its own spec, later); cards on pages other than the home page (templates and static pages); repeating fields (Info Cards, FAQ) inside the card block's items loop; sort orders other than newest first and your own (oldest first, A to Z); per-language contact details; pages at the site root (`/about` rather than `/info/about`), a later feature if clients ask; file uploads and custom fields on the contact form; adding contact form senders to the audience; rich text FAQ answers; per-page `AboutPage` and `ContactPage` structured data; merging the app and functions copies of the template filler.

---

## 0. Where this comes from

A team converting a plain HTML mockup asked for admin CRUD for: a hero (title, subtitle, image, button), menus, FAQs (question, answer, display order), CMS pages (About, Privacy, Terms, Contact), contact information (email, phone, address, social links) and services (name, short description, icon or image, redirect URL, status). Contact Us is richer than the other pages: a form, a map and social links.

| Request | Today | After this spec |
|---|---|---|
| Services CRUD | A content type fits every field, but to show on the home page it must have public pages, so each service also gets a `/services/x` page, a list page and sitemap entries. Order is newest first. | A data-only `services` type in your own order (SS1, SS2). |
| Hero | Hard-coded in `home.html` by a developer. | A data-only `hero` type with one entry, shown with `count="1"` (SS1). |
| FAQ | One entry per question has no display order; a `labelvalue` field works but reads as label and value. | The FAQ page (SS6) with the FAQ field (SS4), or a data-only `faq` type in your own order for a home page block (SS1, SS2). |
| Contact information | Settings, About holds email, address and profile links, but they only reach structured data and email footers. No phone. | Phone added; every value printable on any published page (SS3). |
| CMS pages | About and Contact as a content type the developer sets up; Privacy and Terms as developer-edited static files. | Seeded Pages type, edited in the admin, in every language (SS6). |
| Contact Us | No contact form: signup forms collect only an email, and the Feedback button is for signed-in users. | The Contact page shows contact details, a map and a contact form; messages land in the Messages inbox (SS3, SS5, SS6). |
| Menu management | `header.html`, edited by hand. | Unchanged (separate spec). |

---

## 1. Decision log

All decided 2026-10-05.

### Cards and order

| # | Decision | Choice |
|---|----------|--------|
| SS-D1 | How a data-only type reaches the home page | **The existing card block**, `<arc-content-partials>`, stops removing types with *Generate public pages* off. No new element. The type's template folder supplies `partials.html`, as today. |
| SS-D2 | Template folder for a data-only type | The **Content Template** picker shows whether or not public pages are on. With them off it is labelled **Card template** and only its `partials.html` is used. A folder named after the slug is preselected, as today. |
| SS-D3 | Links on cards of a data-only type | `{{ url }}` and the block's `{{ listUrl }}` are **empty**: there is no page to link to. The default `partials.html` guards its links with `data-arc-if`. A redirect is the type's own text field, such as `{{ redirect-url }}`. |
| SS-D4 | Sort choices | **Two**: *Newest first* (the default, as today) and *Your own order*. Fewer choices, one clear meaning each. |
| SS-D5 | How your own order is set | An **Arrange** button on the entry list, shown only for a type in your own order, opens a dialog listing every entry as a draggable row; Save writes the order. The paged entry table stays as it is. |
| SS-D6 | Where the order is stored | The type's setting is `entryOrder` (not `order`, which already holds the type's position in the admin menu). Each draft and published copy has a number, `sortOrder`. Publishing copies it. A new entry goes **last**. Switching a type to your own order numbers its existing entries in their current newest first order, so nothing jumps. |
| SS-D7 | Reading in order | For a type in your own order, the list page and the card block read the type's published entries and sort in memory by `sortOrder`, then `publishedOn` descending for ties or missing values. No `orderBy` query, so no new index and no entry dropped for lacking the field. The list page keeps its cap of 100; the Arrange dialog warns above 200 entries. |
| SS-D8 | Republishing after a reorder | A new publish queue action, **`order`**, for one type: copies `sortOrder` from drafts to published copies, rebuilds the type's list page (when it has public pages) and the home page (when it shows the type), in one release. |
| SS-D9 | Feeds and sitemap | **Unchanged.** RSS, the sitemap and `llms.txt` stay newest first; order is a display choice. |

### Site info

| # | Decision | Choice |
|---|----------|--------|
| SS-D10 | How site info is printed | **Attributes**, like `data-arc-t`: `data-arc-site="phone"` replaces the element's text, and on an `<a>` also sets `href` (`mailto:`, `tel:`). It works in the header and footer, which have no `{{ }}` values, and the same way in every other site file. One way to learn. |
| SS-D11 | Empty values | An element bound to an empty value is **removed**. `data-arc-site-if="phone"` on a wrapper keeps the wrapper (a label, an icon) only when the value is set. |
| SS-D12 | Social links | **No new admin field.** The existing profile links (`sameAs`, one URL per line) become the social links. The platform is read from the address (instagram.com is Instagram), giving each link a name and an icon class. `data-arc-site-loop="social"` repeats its first child per link. |
| SS-D13 | Phone | A new **Phone** field in Settings, About, stored as typed. The `tel:` link keeps only digits and a leading `+`. Published in the Organization structured data as `telephone`. |
| SS-D14 | Republishing after an About change | Republish **every page that shows a changed value**: if any site file other than the home page uses `data-arc-site`, queue `redeploy-all`; otherwise queue `home`, as today. Checked against the live site's files, like `homeShowsType`. |

### FAQ field

| # | Decision | Choice |
|---|----------|--------|
| SS-D15 | FAQ field shape | A `REPEATER_SCHEMAS` entry, `faq`: rows of **Question** (text, required, translatable, 200 characters) and **Answer** (textarea, translatable, 2000 characters), with an optional block heading (`{key}_heading`). Rows keep the order they are dragged into, as every repeater does. |
| SS-D16 | FAQ answer format | **Plain text.** Published with blank lines as paragraphs and full web addresses as links (`{{ answer_html }}` beside the plain `{{ answer }}`). Rich text needs a rich text sub-field in a 280px row and HTML translation; left for later. |
| SS-D17 | FAQ structured data | A detail page with an FAQ field that has rows adds a **FAQPage** node (first FAQ field only). Google shows FAQ results only for some government and health sites since 2023; the node is still valid and AI assistants read it, and the docs say exactly that. |

### Contact form

| # | Decision | Choice |
|---|----------|--------|
| SS-D18 | Inbox | **A Messages page of its own**, not the Feedback inbox, which is for signed-in users with screenshots and voice notes. |
| SS-D19 | Feature | A new switchable feature, **`contact`**, on by default, needing nothing. Off: no Messages menu or page, no functions, and published pages drop `[data-arc-contact-form]` elements so no dead form shows. |
| SS-D20 | Which fields the form has | **The markup decides**, from a known set: `name`, `email` (required), `phone`, `subject`, `message` (required). Unknown inputs are ignored. Nothing to configure in the admin. |
| SS-D21 | Spam | No CAPTCHA and no emailed code. A hidden honeypot input, at least 3 seconds between page load and send, at most 5 messages an hour per sender address (IP, stored hashed) and per email, and length caps. A message with more than 3 links is kept but marked **Possible spam** and raises no alert. |
| SS-D22 | Telling the admins | `notifyAdmins` with a new `admin_contact_message` type: a bell notification and, by the existing default for `admin_*` types, an email to each admin. At most one alert per 10 minutes, saying how many messages arrived, as Feedback does. |
| SS-D23 | Replying | **Reply** opens the admin's own email client (`mailto:` with the subject and the message quoted). Arc CMS sends nothing to the sender, so a stranger cannot make the site email arbitrary addresses. |
| SS-D24 | Audience | Senders are **not** added to contacts or lists. They wrote to ask something, not to subscribe. |
| SS-D25 | Keeping messages | Kept until an admin deletes them. A line under the form links the privacy policy ("We use your details only to reply."), translatable through `strings/{lang}.json`. |
| SS-D26 | Live parts on every published page | `arc-site.js` (`arcSiteScript`, with the page's strings) goes on **content detail, list and static pages**, not only the home page, and those builds get the terms notice step (`addLegalNotices`) the home page already has. Signup forms then work in posts and static pages too. |

### Standard pages

| # | Decision | Choice |
|---|----------|--------|
| SS-D27 | One type or several | **One type, Pages**, for every standard page, Contact included. A page's extra sections come from optional fields, not from a second type. |
| SS-D28 | Address | Slug **`info`**: `/info/about`, `/info/contact`, `/info/privacy-policy`. `pages` is taken by static pages (`/pages/{name}`), `site` by site files (`/site/...`). The list page, `/info`, is a plain index of the published pages. |
| SS-D29 | How a section turns on | Sections with their own data show when the data exists: **Locations** (map location field) and **FAQ** (SS4). Sections that show site-wide data have a switch, off by default: **Show contact details** (SS3 bindings) and **Show contact form** (SS5). Switches rather than a layout dropdown, because `data-arc-if` tests a value, not an equality, and switches combine (an About page can show the map without the form). |
| SS-D30 | Starting text | Every page starts as a **short outline** with prompts written as `[Replace: ...]`. The bundled samples in `public/_site/pages/` are Arc CMS's own policies (Quadralyst's) and are **not** used. The company name, email and address are filled in from Settings, About where set. No legal advice is shipped. |
| SS-D31 | Never live by accident | Seeded pages are **drafts**. Publishing an entry that still contains `[Replace:` asks "This page still has text to replace. Publish anyway?" (a warning, not a block). |
| SS-D32 | Who creates them | The setup wizard, beside Articles, when the `content` feature is on. Existing installs: **Add standard pages** on Content types creates the type if missing and any missing page (by URL slug), never overwriting. A type with slug `info` that Arc CMS did not create (no `standard: 'pages'` marker) is left alone, and the button says why. |
| SS-D33 | Which link the terms notice and cookie banner use | The **published Pages entry** wins (`/info/terms`, `/info/privacy-policy`, `/info/cookie-policy`), then the app's static file (`/p/terms`), then no link, as today. The admin edits the page, so the notice links what the admin sees. A cookie banner link an admin changed by hand is kept. |
| SS-D34 | Structured data | The seeded type uses a new schema type choice, **Web page** (`WebPage`), instead of Article: a privacy policy has no author or article date. |

---

## 2. SS1: Cards from data-only types

### Functions

- `functions/src/pages/deployHomePage.ts`, `renderContentPartials`: remove the element only when the type does not exist, not when `hasPublicUrl === false`. `partialPageData` sets `listUrl` to `''` for a data-only type.
- `cardData` gets a `hasPublicPages` argument and sets `url` to `''` when false. Change it in **both** copies, the source of truth `src/app/core/utils/content-cards.ts` and the mirror `functions/src/shared/content-cards.ts`, and extend `content-cards.spec.ts` (the parity test).
- `functions/src/publishQueue/processPublishQueue.ts` (the `hasPublicUrl && homeShowsType` check after the switch): republish the home page after publish, update, unpublish and delete when `homeShowsType(slug)`, whatever `hasPublicUrl` is. Everything else that skips data-only types (detail page, list page, sitemap, search) stays.

### App

- `src/app/pages/page.parts/content-partials.component.ts`: it never checked `hasPublicUrl`, so the preview already shows these cards while the published page drops them. After SS1 they agree. Pass `hasPublicPages` to `cardData`.
- Content type add and edit pages: show the template picker when public pages are off, labelled *Card template*, hint "Used for this type's cards on the home page." The slug stays hidden while public pages are off, as today.
- `public/_site/templates/default/partials.html`: guard links with `data-arc-if="url"` and `data-arc-if="listUrl"`.
- `src/shared/utils/template-reference.ts`: the card rows note that `url` and `listUrl` are empty for a type without public pages.

### Tests

- Home page publish: a data-only type with two published entries renders its cards with empty `url`; a type that does not exist is still removed.
- Queue: publishing an entry of a data-only type that the home page shows rebuilds the home page; one it does not show does not.
- Card parity spec: empty `url` in both copies.
- Default `partials.html`: a card with no link when `url` is empty.
- Edit page: template picker shown with public pages off, with the card label.

### Docs

`docs/features/content.html` (the *Generate public pages* row), `docs/website/home-page.html` (the card block), `docs/features/templates.html`, `docs/website/content-types.html`.

---

## 3. SS2: Your own order

### Data

- `ContentTypes/{id}.entryOrder`: `'newest' | 'manual'`; missing means `'newest'`. In `content-types.model.ts` and the functions' type reads.
- `arc_{slug}_drafts/{id}.sortOrder` and `arc_{slug}/{id}.sortOrder`: number.

### Admin

- Content type add and edit pages: an **Entry order** choice, *Newest first* or *Your own order*, hint "Your own order lets you drag entries into place. The list page and home page cards follow it."
- Switching to *Your own order* numbers every draft in its current newest first order (batched writes, chunked under 500) and queues `order`.
- Entry list: an **Arrange** button for a type in your own order. The dialog lists every draft (title, status) with drag handles (Angular CDK drag and drop), plus Save and Cancel. Save writes `sortOrder` 1..n to the drafts in one batch and queues `order`. Above 200 entries the dialog says the list page shows the first 100.
- New entries (editor, bulk import) get `max(sortOrder) + 1`; bulk import keeps the file's row order.
- The editor never shows `sortOrder`.

### Functions

- Publish copies `sortOrder` with the draft (a top-level field; check the copy keeps it).
- Queue action `order`, `{ action: 'order', contentTypeSlug }`, handled like the site-wide items, before the per-document setup: copy `sortOrder` from each draft to its published copy, rebuild the list page when the type has public pages and the home page when it shows the type, one release.
- A helper `readInDisplayOrder(slug, type, limit)` used by `deployContentListPage.ts` and `deployHomePage.ts`: for `'manual'`, read all published entries and sort by `sortOrder` ascending, then `publishedOn` descending; for `'newest'`, today's query.
- Sitemap, RSS, `llms.txt` and `seedStaticPages` unchanged (SS-D9).

### App

- `content-list.component.ts` and `content-partials.component.ts`: the same rule as the helper (one shared function in `src/app/core/utils/`, mirrored in functions with a parity test like the cards'), so the preview matches.
- `template-reference.ts`: the `items` note ("Newest first, up to 100") says "In the type's entry order, up to 100".

### Rules and indexes

None new: drafts and the queue are writable by admins and editors, and the in-memory sort needs no index. `npm run test:rules` still runs to confirm.

### Tests

- Order helper (both copies, parity): `sortOrder` ascending, missing values last, ties newest first; `'newest'` unchanged.
- Switching to your own order numbers existing entries newest first.
- Arrange dialog: Save writes 1..n and queues `order`; Cancel writes nothing.
- Queue `order`: copies `sortOrder`; rebuilds list and home page in one batch; skips the list page for a data-only type.
- New entry gets the next number; bulk import keeps file order.

### Docs

`docs/features/content.html` (settings table, a *Put entries in your own order* section), `docs/reference/data-model.html`, `docs/website/content-types.html`, screenshot of the Arrange dialog.

---

## 4. SS3: Site info on pages

### Settings

- `IAboutSettings.phone` (`about-settings.model.ts`) and `AboutConfig.phone` (`functions/src/shared/site-settings.ts`). A Phone input on the About page under Contact email.
- The profile links label becomes **Social and profile links**, hint "One address per line. Shown as social links on your site and listed for search engines."
- `buildOrganization` adds `telephone`.

### The bindings

| Write | Becomes |
|---|---|
| `data-arc-site="name"` | Site name |
| `data-arc-site="description"` | Site description |
| `data-arc-site="email"` | Contact email; on `<a>` also `href="mailto:…"` |
| `data-arc-site="phone"` | Phone as typed; on `<a>` also `href="tel:+…"` |
| `data-arc-site="address"` | Address, line breaks kept as `<br>` |
| `data-arc-site="logo"` | On `<img>`, `src`; elsewhere nothing |
| `data-arc-site-if="phone"` | Element kept only when the value is set |
| `data-arc-site-loop="social"` | First child repeated per link, with `{{ url }}`, `{{ platform }}` (`instagram`), `{{ label }}` (`Instagram`) and `{{ icon }}` (`fa-brands fa-instagram`) |

Platforms recognised by host: Facebook, Instagram, X (twitter.com and x.com), LinkedIn, YouTube, GitHub, TikTok, Pinterest, Threads, WhatsApp (wa.me), Telegram (t.me), Medium. Anything else: platform `link`, label the host name, icon `fa-solid fa-link`.

### Where it applies

One pure function, `applySiteInfo(html, info)`, source of truth in `src/app/core/site/site-info.ts` with a mirror in `functions/src/shared/site-info.ts` and a parity test, like the cards. Called next to every `applyStrings`:

- Functions: home page (page, header and footer), content detail and list pages, card blocks, static pages (`deployStaticPage.ts`).
- App: `site-fragment.ts` (header and footer; before their scripts run, so a script sees the filled values), `content-detail`, `content-list`, `content-partials`, the home page preview (`index.page.ts`) and static pages. The app reads About through the existing site identity service (`site-identity.service.ts`).

Values are escaped as text; the social loop's values are escaped as attributes.

### Republishing

`onSiteSettingsWritten`: when `about` changes, `siteUsesSiteInfo()` (beside `homeShowsType`) checks whether the live header, footer, any template folder or any static page contains `data-arc-site`. If so, queue `redeploy-all`; otherwise `home`, as today (SS-D14).

### Tests

- `applySiteInfo`: each key, `mailto:` and `tel:`, empty value removes, `-if` keeps or removes, social loop with known and unknown hosts, escaping (a name with `<`).
- Parity: the two copies give the same output for a shared fixture.
- Each publish path applies it (home, detail, list, cards, static page, header and footer).
- `onSiteSettingsWritten`: bound in the footer queues `redeploy-all`; bound only on home, or nowhere, queues `home`.
- Organization structured data includes `telephone`.
- About page saves and reloads Phone.
- `template-reference.ts` lists the attributes; its spec checks them.

### Docs

The About settings section in `docs/features/seo.html`, `docs/features/templates.html` (attributes table), `docs/website/home-page.html` (live parts table), `docs/website/static-pages.html`, `docs/website/templates.html` (header and footer), screenshot of Settings, About.

---

## 5. SS4: FAQ field

### Field

- `REPEATER_SCHEMAS.faq` in `src/shared/models/repeater.model.ts`: row label *Question*, hint "Each row is one question and its answer. Drag rows to change the order.", heading `heading` ("Section heading", translatable), sub-fields `question` and `answer` (SS-D15).
- `ContentTypeFieldType` gains `'faq'`; the add and edit pages list it as **FAQ**.
- Translation, row ids and positions come from the repeater machinery; check the content translation model treats both sub-fields as prose.
- Bulk import skips it, like the other repeating fields.

### Templates

```html
<section data-arc-if="faq">
    <h2>{{ faq_heading }}</h2>
    <div data-arc-loop="faq">
        <details>
            <summary>{{ question }}</summary>
            <div data-arc-bind="answer_html"></div>
        </details>
    </div>
</section>
```

`answer_html` is derived per row at render time in both hydration copies (`functions/src/shared/template-hydration.ts`, `src/app/core/services/template-hydration.service.ts`), the way `map_embed` is derived for map locations: escape, blank lines to paragraphs, `https://` addresses to links.

### Structured data

`buildFaqPage(rows)` in `functions/src/shared/structured-data.ts`: `FAQPage` with `mainEntity` of `Question` and `acceptedAnswer` `Answer`, plain text. The detail page adds it when the type has an FAQ field with at least one complete row, in the page's language.

### Template Reference

`template-reference.ts` gets the FAQ field's snippet (the loop above); `template-reference.spec.ts` renders it, as for every field type.

### Tests

- Schema: `faq` with both sub-fields translatable.
- Hydration (both copies): rows in position order; `answer_html` makes paragraphs and links and escapes everything else.
- Structured data: FAQPage with rows; none without; a translated page uses translated text.
- Add page offers FAQ; the editor renders the rows.

### Docs

`docs/features/content.html` (field types table, repeating fields), `docs/features/templates.html` (custom field bindings), `docs/features/seo.html` (structured data), screenshot of the FAQ field in the editor.

---

## 6. SS5: Contact form

### Live parts on every published page (SS-D26)

- `deployContentPage.ts`, `deployContentListPage.ts`, `deployStaticPage.ts`: append `arcSiteScript(...)` with the setup state and the page's strings, and run `addLegalNotices`, as `deployHomePage.ts` does. Move both helpers to a shared module (`functions/src/shared/site-script.ts`) rather than importing from the home page builder.
- The app runs `arc-site.js` on its content and static page views as the home page preview does, so forms work in `npm run dev`.
- Note: `arc-site.js` sends visitors to `/onboarding` while setup is unfinished. On every page now, as on the home page; `?debug` still stays.

### The form

```html
<form data-arc-contact-form>
    <input name="name" placeholder="Your name">
    <input name="email" type="email" required placeholder="Your email">
    <textarea name="message" required placeholder="How can we help?"></textarea>
    <button type="submit" data-arc-t="contact_send">Send</button>
</form>
```

`arc-site.js` takes over the submit: adds the hidden honeypot input and the privacy line, sends the known fields with the page path, the language and the time since load, then replaces the form with the thank-you text (`contact_sent`) or shows the error (`contact_error`, `contact_too_many`). Strings travel on `data-strings` like the `signup_*` ones (`arcSiteScript` passes `contact_*` keys too); English defaults in `arc-site.js`, Hindi in `public/_site/strings/hi.json`.

With the `contact` feature off, publishing removes `[data-arc-contact-form]` elements (SS-D19).

### Functions (`functions/src/features/contact.ts`)

| Function | Kind | Does |
|---|---|---|
| `submitContactMessage` | HTTPS, public, CORS for the site's origins | Validates (required fields, email format, length caps: name 100, subject 200, message 5000), honeypot, minimum time, rate limits (SS-D21); writes `ContactMessages/{id}` |
| `onContactMessageCreated` | Firestore trigger | Unless marked spam, `notifyAdmins('admin_contact_message', ...)` with the 10 minute throttle (SS-D22) |

### Data

- `ContactMessages/{id}`: `name`, `email`, `phone`, `subject`, `message`, `page`, `lang`, `status` (`new`, `done`, `spam`), `createdAt`. No IP stored on the message.
- `_contact_limits/{hash}`: per hashed IP and per email, `count` and `windowStart`; functions only.

### Rules and indexes (core files)

- `firestore.rules`: `ContactMessages` read, update (`status` only) and delete by admins; no client create. `_contact_limits` closed to clients.
- `firestore.indexes.json`: `ContactMessages` on `status` ascending, `createdAt` descending (the inbox filter).
- Rules tests for both collections.

### Admin: Messages

- `/admin/messages`, an explicit route in `app.routes.ts` (file-based admin routes alone render the public not-found page). Menu item **Messages** with the count of new messages.
- A list (New, Done, Possible spam tabs; sender, subject or the start of the message, page, date) and the side panel pattern from the email screens for one message. Actions: **Reply** (`mailto:`), **Mark done**, **Not spam**, **Delete**.
- The feature registry: `contact` in the feature ids, its menu item and route gated, its functions in the feature's group.

### Tests

- Function: valid message stored; each rejection (missing email, bad email, honeypot, too fast, sixth message in an hour, too long); link-heavy message stored as spam.
- Trigger: alerts admins; throttled; no alert for spam.
- `arc-site.js`: takes over the form, sends only known fields, shows thank-you and errors in the page's language.
- Publishing: content, list and static pages carry `arc-site.js` and the legal notice; with `contact` off the form is removed.
- Messages page: tabs, reply link, mark done, delete.
- Feature flag: off removes the route, menu item and functions.

### Docs

New `docs/features/contact-form.html`; `docs/reference/feature-ids.html`, `docs/reference/cloud-functions.html`, `docs/reference/data-model.html`, `docs/features/notifications.html` (the new alert type), `docs/website/home-page.html` and `docs/website/forms.html` (forms now work on every published page); screenshots of the Messages page and a sent form.

---

## 7. SS6: Standard pages

### The type

Created from a definition in `src/app/pages/(onboarding)/onboarding-defaults.ts`, beside Articles:

| Setting | Value |
|---|---|
| Name, singular | Pages, Page |
| Slug | `info` |
| Icon | `fas fa-file-lines` |
| Public pages | On |
| Template folder | `info`, shipped by core in `public/_site/templates/info/` (`detail.html`, `list.html`) |
| Entry order | Your own order (SS2) |
| Structured data | Web page (`WebPage`, SS-D34; a new entry in `functions/src/shared/schema-types.ts`) |
| Marker | `standard: 'pages'` |
| Fields | **Locations** (map location), **FAQ** (SS4), **Show contact details** (on/off), **Show contact form** (on/off, offered only with `contact` on) |

### The template

`info/detail.html`: title and body, then four sections in this order, each behind `data-arc-if`: the map (Locations loop), the FAQ (SS4 loop), contact details (SS3 bindings and the social loop), the contact form (SS5 markup). Plain, accessible markup on the site's classes, so an app restyles it in `site.css` or replaces the folder in `src/custom/site/templates/info/`.

### The pages

All drafts, in this order:

| Page | Slug | Starts with |
|---|---|---|
| About | `about` | Outline: who you are, what you do, why; `[Replace: ...]` prompts |
| Contact | `contact` | One line of intro; Show contact details on; Show contact form on when `contact` is on |
| FAQ | `faq` | The FAQ field with three prompt rows |
| Privacy Policy | `privacy-policy` | Outline with the usual headings (what you collect, why, who you share it with, how long you keep it, people's rights, contact) and prompts |
| Terms | `terms` | Outline with the usual headings and prompts |
| Cookie Policy | `cookie-policy` | Outline: what cookies the site sets and how to refuse them |

Name, email and address come from Settings, About where set (SS-D30).

### Creating them

- Setup wizard: with `content` on, the Pages type and its drafts are created with Articles.
- Content types page: **Add standard pages** (SS-D32). It creates the type when missing and each missing page, and reports what it added.
- Publishing an entry containing `[Replace:` asks first (SS-D31). The check is in the editor's publish action, for every type, so it also helps a team that writes its own outlines.

### Links

- `src/shared/constants/legal-notice.ts`, `legalNoticeUrls`: the published `info` entry first, then the static page, then none (SS-D33). The app learns which standard pages are published from a small public read of `arc_info` (`terms`, `privacy-policy`, `cookie-policy`); publishing knows from Firestore.
- The notice is baked into published pages, so publishing or unpublishing `terms` or `privacy-policy` queues `redeploy-all` when it changes whether the link exists (rare: once at launch).
- Cookie banner (`site-usage.model.ts`, default `privacyPolicyLink: '/p/cookie-policy'`): while the link is the untouched default, the banner uses `/info/cookie-policy` once that entry is published.

### Tests

- Wizard creates the type and six drafts, none published; with `content` off, none.
- Add standard pages: creates only what is missing; leaves a foreign `info` type alone with a message; running it twice adds nothing.
- Template: each section shows only with its data or switch on; the form section disappears with `contact` off.
- Publish warning with `[Replace:` present; none without.
- Legal notice: published entry, then static file, then none. Cookie banner default follows the entry; a custom link is kept.
- `WebPage` structured data for the type.

### Docs

`docs/website/static-pages.html` (the "Other fixed pages" section becomes *Standard pages*), `docs/features/content.html`, `docs/website/launch-checklist.html` (replace every `[Replace:` and publish the legal pages), `docs/features/banners.html` (cookie link), `docs/website/forms.html` (terms notice links), `docs/getting-started/first-admin.html` (what the wizard creates), `docs/features/seo.html` (Web page); screenshots of the Pages list and the Contact page.

---

## 8. SS7: Docs walkthrough and changelog

- New page `docs/website/editable-sections.html`, *Let editors change your home page*: converts four mockup sections step by step: services (data-only type, card template, your own order, redirect URL field), hero (data-only type, one entry, `count="1"`), FAQ (the FAQ page, and a home page block from a data-only type) and a footer with contact details and social links. Linked from `docs/website/overview.html` and `docs/website/convert-a-site.html`.
- Example files under `docs/examples/sections/`: `partials.html` for services and hero, a footer fragment using `data-arc-site`.
- `npm run docs:affected` after every phase; `npm run check:docs` clean.
- `CHANGELOG.md` entry.

---

## 9. Deploy

One deploy per phase, after its tests pass. Targeted functions only (`functions:arccms:arccms.<name>`):

| Phase | Functions | Also |
|---|---|---|
| SS1 | `processPublishQueue`, `seedStaticPages` | |
| SS2 | `processPublishQueue`, `seedStaticPages` | |
| SS3 | `processPublishQueue`, `seedStaticPages`, `onSiteSettingsWritten` | |
| SS4 | `processPublishQueue`, `seedStaticPages` | |
| SS5 | `processPublishQueue`, `seedStaticPages`, `submitContactMessage`, `onContactMessageCreated` | Firestore rules and indexes |
| SS6 | `processPublishQueue`, `seedStaticPages` | |

Hosting is the user's own deploy (the `info` template folder and the new `arc-site.js` need one before the browser checks). Browser checks at localhost:5173 after each functions deploy.

## 10. Order of work

SS1, SS2, SS3, SS4, SS5, SS6, SS7. SS1 and SS2 share the card block and the queue; SS6 needs SS2 to SS5, so the Contact and FAQ pages are complete when they are created. Each phase: build, tests, docs, full suite (`npm run test`, plus `npm run test:rules` for SS5), report, one deploy, browser check.
