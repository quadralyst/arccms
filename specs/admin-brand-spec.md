# Admin Brand: Colours, Name, Logo and Tab Titles Set by the App: Build Spec (AB)

**Status:** BUILT 2026-10-08 (AB1 to AB4, reviewed), agreed with Gunjan 2026-10-08 (an app team's request F17, plus two additions, F14, and the User Settings pane's doubled header).
**Branch:** `feat/admin-brand`, cut from `dev` (8801884), worktree `../arccms-admin-brand`,
dev server on port 5183.

**Scope:**
1. The admin's colours are CSS variables an app sets in `src/custom/styles.css`, with Arc's
   blues as defaults. Every place in the admin and the setup wizard that writes one of Arc's
   blues reads a variable instead, and Bootstrap's and Material's primary colours inside the
   admin follow the same accent.
2. The name and logo at the top left of the admin's side panel come from Settings, About,
   then from the app's own default in the custom space, then Arc CMS's. The same lookup
   serves the sign-in page, the member area and `og:site_name`.
3. The admin's browser tab says "Page | <site name>".
4. Docs listing the admin variables, like docs/website/sign-in-page.html lists the sign-in
   page's.
5. **Added:** an app can ship an image that fills the whole brand panel of the sign-in page.
6. **Added:** the setup wizard never shows an empty half between 768 and 992 pixels wide
   (the fix the sign-in page had in abdaac7).
7. **Added: F14, page titles that name Arc CMS** (an app team's brief, folded into AB3): every
   page's tab ends with the site's name; the titles members see are translated through the
   member strings (admin titles stay English); index.html's title is neutral, or the app's
   name when the build knows it, never Arc's marketing line; the sign-in page never shows
   "Arc CMS" while settings load; an app can give a core page its own title from the custom
   space.

**Out of scope:** the public website's colours (the site owns them in `site.css`); stored
colour defaults in code (global message, PWA theme colour, editor colours), which are data,
not styling; the sign-in page's own variables (`--arc-sign-in-*`), already in place.

**Phases:** AB1 colours and the wizard; AB2 name, logo and sign-in image; AB3 tab titles;
AB4 docs and screenshots, then one critical review of AB1 to AB4 (agreed: once, after AB4),
fixes, the whole suite, merge into dev, push, and a note for the app team. Any server
deploy also waits for AB4; none is expected (no functions, no rules).

---

## 1. What is true today

- The side panel's background is five radial gradients and a linear one on `.sidebar::before`
  (side-navbar.component.scss), in `#2654bd`, `#24c6dc`, `#3c76f5`, `#1d47a3`, `#1b429a`.
  The active and hovered menu item is a 15% white tint, not blue.
- The main buttons, `.arc-admin .btn-primary` and Material's primary flat and raised buttons,
  are a fixed gradient `#3c76f5` to `#1d47a3` in src/styles.css, for `.arc-admin` and
  `.arc-onboarding`.
- About 20 admin pages and shared admin components write the same blues in their own styles,
  and the setup wizard writes them 11 times.
- Bootstrap's `#0d6efd` reaches the admin through `text-primary` (37 uses), `btn-outline-primary`
  (23) and `bg-primary` (4). Material's prebuilt indigo-pink theme gives toggles, tabs, spinners
  and form fields indigo `#3f51b5`, and checkboxes, radios and sliders pink `#ff4081`.
- The panel shows `APPLICATION_NAME` ('Arc CMS', common-constants.ts) and the bundled
  `logo-small.png`; collapsed, it shows only the expand arrow.
- `signInBrand()` (sign-in-panel.component.ts) picks the sign-in page's name and logo from
  Settings, About, with `APPLICATION_NAME` and Arc's logo as the fallback; the member shell
  uses it for its name. `og:site_name` is 'Arc CMS' on public content pages.
- 57 route files set `routeMeta.title` to 'Page | Arc CMS' (44 of them admin).
- The setup wizard's left column is `col-md-6 d-none d-md-block`, but its panel is drawn
  from 992px, so between 768 and 992 the left half is blank.

## 2. Decision log

| # | Decision | Why |
|---|---|---|
| AB-D1 | **Colours reach the admin and the setup wizard only.** Public pages, the sign-in page and stored colour defaults keep their own. | The website and the sign-in page already have their own styling; admin colours must not leak into them. |
| AB-D2 | **Variables, with defaults that reproduce today's look exactly:** `--arc-admin-accent` (`#3c76f5`), `--arc-admin-accent-dark` (`#1d47a3`), `--arc-admin-button-background` and `--arc-admin-button-hover-background` (today's gradient), `--arc-admin-panel-background` (today's six gradients), `--arc-admin-panel-color` (`#fff`), `--arc-admin-menu-active-background` and `--arc-admin-menu-hover-background` (`rgba(255, 255, 255, 0.15)`). | Arc does not change by a pixel. A solid accent is needed beside the button background because most places use the blue as a text or border colour, where a gradient cannot go. |
| AB-D3 | **Lighter and darker shades come from the accent** with `color-mix()`: shadows, tints and the pressed button. The palette's other fixed blues (`#2654bd`, `#24c6dc`, `#1b429a`, `#2a5fd8`, `#163a8a`) map to the accent or the dark accent, or a mix of them. **The other brand blues the admin's styles wrote** (Bootstrap's `#0d6efd` and its tints in about 40 files, a few Tailwind and Material blues) map the same way: strong blues to the accent, dark ones to the dark accent, light tints to `color-mix(accent N%, #fff)` of the same lightness. Left alone: info alerts' teal-blues, colour palettes an admin picks from, email designs, chart and category colours other than blue, and shared parts of the public site and the sign-in page (search box and results, phone and country pickers, code boxes). | An app sets two colours, not ten; a teal admin with stray blue highlights would look broken. |
| AB-D4 | **Inside `.arc-admin`, `.arc-onboarding` and the dialog layer while one of them is open (`.arc-admin-overlay`, set by `useAdminOverlay()`), Bootstrap's primary and Material's primary and accent follow `--arc-admin-accent`.** Bootstrap: links, `text-primary`, `bg-primary`, `border-primary`, `btn-outline-primary`, checked boxes, focus rings, pills, pagination, dropdown, list group and progress. Material: each rule of the indigo-pink theme that sets its indigo or pink (500, or 300 for tracks, or an rgba of them), repeated inside the admin on the same selector with the accent; nothing else, so `warn` stays red and uncoloured elements stay so. The rules live in src/admin-theme.css. With Arc's defaults this is the one visible change: Material's indigo and pink, and Bootstrap's `#0d6efd`, become Arc's blue in the admin. | Otherwise a teal admin has indigo toggles, pink checkboxes and blue outline buttons. Dialogs render outside `.arc-admin`, so the dialog layer is included, but only while the admin or wizard is open: there is one layer for the whole app, and the sign-in page's toasts must keep their own colours. |
| AB-D5 | **A test fails when a stylesheet in the admin or the wizard writes one of Arc's blues outside the variables' definitions**, and when a Material token the prebuilt theme colours is not followed. | Keeps "every place reads the variable" true after the next change and the next Material update. |
| AB-D6 | **The setup wizard's left column shows from 992px**, like the sign-in page; narrower, the form is alone and centred. A test keeps the column and the panel in step. | Same cause and fix as abdaac7. |
| AB-D7 | **One lookup for the site's name and logo, field by field:** Settings, About; then the app's default (`src/custom/brand.ts` for the name, `src/custom/logo.svg`, `.png` or `.webp` for the logo); then Arc CMS's name and logo, only when no layer has a name or a logo. A name with no logo shows no logo (never Arc's beside another name); a logo with no name has no name. | The admin changes them with no code and no deploy; an app ships a sensible default; Arc's brand never appears beside someone else's. |
| AB-D8 | **The lookup serves every place that shows the site's name**: the admin panel, the sign-in page, the member shell, the admin tab titles and `og:site_name` on public content pages. `APPLICATION_NAME` stays only as Arc's own fallback. | One name everywhere. `og:site_name` was Arc's on every app's site. |
| AB-D9 | **The panel shows nothing until Settings, About has loaded**; saving About updates the panel at once. | Arc's name never flashes, and the admin sees the change they made. |
| AB-D10 | **Logo shape decides the layout**, measured when the image loads. Open panel: the logo fits in 40px high and 150px wide; a wide logo (at least twice as wide as tall) shows alone, since a wordmark already carries the name; a square one shows with the name. Collapsed: a square logo shows above the arrow; a wide one does not (it cannot be read in 65px). | No setting to choose; both shapes look right. |
| AB-D11 | **Settings, About gets a "Choose from media" button** beside the logo URL, opening the media library like the content editor does. | Pasting a URL is hard for an admin. |
| AB-D12 | **The sign-in image is app code only**: `src/custom/sign-in-image.webp`, `.jpg`, `.jpeg`, `.png` or `.svg`. When there is one, it fills the whole brand panel (cover, centred) and replaces the panel's text. | Agreed with Gunjan: image only, set by the app. A brand image usually carries its own text, and text over an unknown photo is hard to read. |
| AB-D13 | **The app's files are found at build time with `import.meta.glob`**, so a missing file is simply no file, with no build error and nothing to declare. | Same ease as `pwa-icon`: drop a file in. |
| AB-D14 | **`brand.ts` is a new custom starter file** (`CUSTOM_BRAND = {}`), listed in scripts/custom-starters.mjs; core specs see the shipped value. | The custom-space contract for starter files. |
| AB-D15 | **Tab titles:** `routeMeta.title` holds only the page's name ('Users'); one title strategy adds ` | <site name>`, and adds it again with the right name once About has loaded. A route without a title, or a page that sets its own title, is left alone. Until the name is known the tab shows the page's name alone. | 57 files stop naming Arc; the name has one source. |
| AB-D16 | **Member-facing titles are translated** (F14.1): the pages a member can see (profile, notifications, the user dashboard, "Authenticating", "Unauthorized", "Page Not Found") carry a `titleKey` in their route data, in the member strings, shown in the member's language and updated when it changes. Admin titles stay English. | An owner reading German sees "Profil \| Acme Studio". |
| AB-D17 | **index.html's title is the app's name from `brand.ts` when it has one, else the neutral "Loading"** (F14.2), written in at build time; the description meta loses Arc's marketing line the same way. | Never Arc's line on an app's tab. |
| AB-D18 | **`CUSTOM_BRAND.titles`** (F14.3): a map from a route path ('/admin/users', '/user/profile') to the title an app wants there; the site name is still added. | The rare page where the generic name does not fit, with no core edit. |

## 3. Phases

### AB1. Admin colours and the setup wizard
1. The variables (AB-D2) defined on `:root` in src/styles.css, with Arc's defaults.
2. The side panel, the active and hovered item, and the main buttons read them.
3. Every admin and wizard stylesheet that writes one of Arc's blues reads the variables (AB-D3).
4. Bootstrap and Material primaries follow the accent inside the admin and the wizard (AB-D4).
5. The setup wizard's column fix (AB-D6).
6. Tests: AB-D5's guard, AB-D6's column test.
7. Browser check: Arc's look unchanged; an app's teal set in a scratch `src/custom/styles.css`
   (not committed) reaches the panel, buttons, toggles, checkboxes and tabs; the wizard
   centred at 800px.

### AB2. Name, logo and sign-in image
1. `src/custom/brand.ts` starter (AB-D14) and the app-file lookup (AB-D13).
2. `siteBrand()` replaces `signInBrand()`'s fallback rule (AB-D7); used by the sign-in page,
   member shell, admin panel and `og:site_name` (AB-D8).
3. The panel: blank until loaded, layout by shape, collapsed square mark (AB-D9, AB-D10);
   saving About updates `SiteIdentityService`.
4. "Choose from media" in Settings, About (AB-D11), translated in every admin language.
5. The sign-in image (AB-D12).
6. Tests for the lookup, the panel's layout choice and the sign-in image.
7. Browser check: About name and logo show in the panel, open and collapsed, wide and
   square; the sign-in page with a scratch image.

### AB3. Tab titles (with F14)
1. The title strategy (AB-D15), registered in app.config.ts.
2. ' | Arc CMS' removed from every `routeMeta.title`.
3. Member-facing titles through member strings (AB-D16), in English and Hindi.
4. index.html's title and description (AB-D17); `CUSTOM_BRAND.titles` (AB-D18).
5. Tests: no route title names Arc CMS; the strategy adds the site's name, updates it when
   About loads, translates member titles, applies the app's map; index.html names no Arc.
6. Browser check: admin tabs say "Users | <site name>"; the sign-in page's tab never says
   Arc CMS while loading.

### AB4. Docs, screenshots and review
1. docs/app/admin-look.html: the variables, the name and logo lookup, the logo shapes, an
   example (teal), linked from docs/app/custom-space.html and the docs navigation.
2. docs/website/sign-in-page.html: the sign-in image. docs/app/custom-space.html: `brand.ts`,
   `logo.*`, `sign-in-image.*`. reference/config-keys.html: `CUSTOM_BRAND`. The About settings
   page's docs: the media button and where the name and logo show.
3. Screenshots: the docs have none yet (their screenshot phase is not built), so none to retake;
   screenshots of the admin in Arc blue and an app's teal and of the sign-in image go to Gunjan
   with the report instead.
4. `npm run docs:affected`, `npm run check:docs`.
5. Critical review of AB1 to AB4: correctness, security, data integrity, tests, docs, drift
   from this spec. Fix every critical and high item, re-run the checks.
6. The whole suite alone (`npm run test`), merge into dev, push, and a note for the app
   team with what to put in their custom space.

## 4. Review (2026-10-08, after AB4)

Fixed: the Material overrides were one rule for every element, which turned icons in primary
buttons, chips and tab content the accent (now one rule per theme rule, and the test compares
selector and token pairs); the admin's mobile bar, the user and content-type form footers, the
wizard's welcome and the broadcast sender fallback said "Arc CMS"; the dialog layer's colours
reached the sign-in page; an SVG logo with only a viewBox could not be measured; a page with no
name kept the last page's tab title; a slow first read could undo an About save; an empty
`og:site_name` was written; logo files were picked alphabetically, not svg first; the pressed
button lost its darker shade (now `filter: brightness(0.9)` over any background); links with
Bootstrap or Material classes took the accent. Also: the User Settings pane repeated the page
header (search, language, bell) inside Settings; it now has a plain heading, and a test keeps
the panes free of `arc-page-header`.

Left: `Settings/email` still defaults `senderName` to 'Arc CMS' in its model (a stored default,
set from the site name by the setup wizard); apps with their own member language must translate
the ten `member.titles.*` keys (their suite says so).
