# An App's Own Website: Build Spec

**Status:** All phases built 2026-10-04. W1 and W2 (446b05e), W3 (c4fa603), W4 and W5 (fc424dd) deployed to the dev project and checked; W6 (002b25a) needs no deploy. W7 (final docs pass, example page script, CHANGELOG) uncommitted. Screenshots: the docs have none yet; they come with the developer docs' own screenshot phase (D7, specs/developer-docs-strategy.md).

**Follow-ups after review (2026-10-04, uncommitted):** the website deploy keeps published pages
(`scripts/arc-hosting-release.mjs`: build to the `arc-deploy` preview channel, then one live
release of the build plus the published files); publishing pages through the live file list
(it read only the first 1000 files); the home page republishes when Settings it shows change
(`onSiteSettingsWritten`, a `home` queue action); the preview runs `arc-site.js` (the Angular
`WaitlistFormService` is gone); `arc-site.js` sends the app's full signup metadata, shows
"Welcome back" and resolves a legacy default form id; the placeholder carries Arc CMS branding;
the server entry files are removed.
**Branch:** `feat/own-website`, cut from `dev` (a41d8b4), in the worktree `../arccms-own-website`.
**Scope:** an app built on Arc CMS owns its whole public website (home page in every
language, header, footer, content templates, static pages, styles, favicon, error
pages) from one folder in the custom space, `src/custom/site/`, without changing a
core file. The home page becomes a published page, like content: static HTML on
Hosting, in every enabled language, with every SEO tag. Core ships a placeholder home
page and one system default template set, so a site with nothing of its own still
renders every content type.

**App report fixes (2026-10-04, branch fix/app-site-links-versions):** language prefixes only for
localized addresses (home, search, public content types; `isLocalizedPath`), a
`languageRedirect` route for stray prefixed addresses; every `/site/` file in `site.json`
with links versioned on published pages, in the preview (`siteFilesInterceptor`) and in the
app's CSS `url()` at build time; core specs read `public/_site/` directly.

**Out of scope:** switching the home page at run time (dropped 2026-10-04); merging the
two copies of the template filler (SPA and functions, about 700 lines each) into one,
which is its own task; a visual editor for templates.

---

## 1. Decision log

| # | Decision | Choice |
|---|----------|--------|
| W-D1 | Where the app's site lives | **`src/custom/site/`**, with named files (section 2), not a mirror of `public/`. Already custom space, so `check:core` needs no new rule. Core ships nothing in it. |
| W-D2 | What stays in core's `public/` | Only files that must be served at a URL: the system default templates, the placeholder home page, the default header and footer, favicon, error pages, core assets. Component HTML moves next to its component. |
| W-D3 | One source per piece | The build assembles core's defaults and the app's files into one served folder, `/_site/` (section 3). The SPA and the publish functions both read that, so what you preview is what publishes. |
| W-D4 | Firestore overrides | **Removed.** `templates/{folder}:detail\|list` and `Settings/partials` are written by nothing in the code; they are a hidden second copy. The migration (section 9) reports any that exist. |
| W-D5 | The home page | **Published like content**: static HTML written to Hosting at `/index.html` and `/{lang}/index.html`. The SPA no longer prerenders `/` or `/hi`; it renders the same file only as a local preview. |
| W-D6 | Home page format | **A whole HTML document** (decided 2026-10-04): its own `<head>` with title, description, fonts, CSS and script links. Publishing adds the SEO tags and fills the Arc CMS elements. The same shape as static pages. |
| W-D7 | Home page languages | **Either way** (decided 2026-10-04): `home.{lang}.html` when it exists, otherwise `home.html` published in that language with `data-arc-t` text from `strings/{lang}.json`. Published for every enabled language. |
| W-D8 | Scripts and animation | **Plain script files** (decided 2026-10-04): libraries from a CDN or from `src/custom/site/assets/`, the app's own `home.js` served as a file. No build step; no npm imports in site scripts. |
| W-D9 | Placeholder home page | Core's home page is "This site is not set up yet" with a link to the docs, `noindex`. The Arc CMS marketing page becomes a docs example. |
| W-D10 | System default templates | **One set**, `partials.html`, `list.html`, `detail.html`, used for any public type without its own folder. The SPA's built-in Angular copy of the default layout is removed. Publishing reads the default from the live site like any folder; a copy built into the functions (`functions/src/site-defaults.gen.ts`, gitignored, from `scripts/arc-site-defaults.mjs`) is used only when the live site cannot give it (hosting off, or not yet deployed with `/_site/`), so a type on the default always publishes a full page (refined during W3, 2026-10-04). |
| W-D11 | Template folders | Reusable folders, listed by the build (no `templates.json` to edit). A content type picks one only when it has public pages (as today); a folder named after the type's slug is preselected. |
| W-D12 | Header and footer in the SPA | Rendered from the same HTML as published pages, not compiled as Angular templates. The `{`, `}`, `@` escaping rule disappears. |
| W-D13 | Live parts of published pages | One script, `/assets/js/arc-site.js`, beside `arc-search.js`: signup forms, live counts, the legal notice, PWA install. Published pages work without the SPA. |
| W-D14 | The "deploy before publishing" trap | Guarded twice: a template folder missing on the live site fails the publish with a message; the admin running locally warns when local site files differ from the live ones. |
| W-D15 | Home page without the content feature | Home and static pages publish with `content` off (the cards are empty); they are the website, not a content feature. Their functions move to a core group. **As built:** no move. The website deploy's seed runs the publishing code directly (`functions/scripts/call-seed.cjs`), so the home page and static pages publish with `content` off; with it off there is no content to republish for, and no admin action. |
| W-D16 | Legal links on signup forms | **No setting.** The notice links to `/p/terms` and `/p/privacy-policy` when the site has those pages; its wording is translatable through `strings/{lang}.json`. `src/shared/constants/legal-notice.ts` keeps only the wording defaults. |
| W-D18 | Site stylesheets in the app | **On only while a website page is shown** (added 2026-10-04). `main.css` and `site.css` are each one `<link>`, versioned `?v={hash}`, switched on by the website's components (header, footer, home page, sign-in page) and off (`disabled`) when the last goes, so they never style the admin or member area. `main.css` leaves the home page's JS bundle. |
| W-D19 | The sign-in page is the site's | **Added to W2 on request (2026-10-04).** Name and logo from Settings, About (Arc CMS's when unset); the brand panel is a site file, `sign-in.html` (core ships a neutral one, no marketing); colours and font through CSS variables set in `site.css` (`--arc-sign-in-*`). |
| W-D20 | Failures found in W3 testing | **Fixed in W3 (2026-10-04).** (a) A release that went out without the item's own page stamped the item "deployed", hiding any build failure: the publish queue now releases the rest unstamped and records the failure on the item. (b) The editor read the previous publish's result as this one's: it now waits for a deploy time that differs from the one on the record when it started watching. |
| W-D21 | Editor side panel | **Added to W3 on request (2026-10-04).** The resize handle is always visible (a dotted grip in the gap between the two areas, no extra line) and the width is remembered per content type in the browser, starting from the shared width. |
| W-D17 | Migration | **`npm run arc:own-site`**, a plan by default and the move with `--write` (section 9). Quadralyst's own website becomes an app repo of its own and is the first site moved with it. |

---

## 2. The app's folder

```
src/custom/site/
  home.html             the home page, a whole HTML document (default language)
  home.hi.html          optional: the home page written in Hindi
  header.html           the site header, an HTML fragment
  footer.html           the site footer, an HTML fragment
  site.css              styles for every public page (header, footer, templates)
  templates/{folder}/   partials.html, list.html, detail.html (any may be missing)
  pages/{name}.html     static pages, whole documents, at /p/{name}
  strings/{lang}.json   translations of data-arc-t keys, merged over core's
  assets/               images, scripts, fonts: served at /site/...
  favicon.ico, 403.html, 404.html
```

Every file is optional. A file the app does not have is core's, so the app keeps
receiving Arc CMS improvements to everything it has not replaced. `strings/{lang}.json`
is merged key by key over core's; every other file replaces core's.

A template folder that lacks a file uses the system default for that file, so a folder
with only `detail.html` is valid.

## 3. How core finds the files

`scripts/arc-site.mjs` is the one resolver, used by the Vite plugin, the tests, the
migration and `docs:affected`:

- `siteSources()`: every site file, the app's where it has one, else core's.
- `assembleSite(outDir)`: writes the served folder and its manifest.

The served layout, the same in `npm run dev` and on Hosting:

| URL | From |
|-----|------|
| `/_site/home.html`, `/_site/home.{lang}.html` | the app's home page, else core's placeholder |
| `/_site/header.html`, `/_site/footer.html` | the app's, else core's |
| `/_site/templates/{folder}/{file}.html` | the app's folders, plus `default` from core |
| `/_site/pages/{name}.html` | core's pages plus the app's (same name: the app's) |
| `/_site/strings/{lang}.json` | merged |
| `/_site/site.json` | the manifest: home languages, template folders and their files, pages, a hash of every file |
| `/site/...` | `src/custom/site/assets/` |
| `/assets/css/site.css` | `src/custom/site/site.css`, else empty |
| `/favicon.ico`, `/403.html`, `/404.html` | the app's, else core's |

`/_site/` is source, not pages: `firebase.json` sends `X-Robots-Tag: noindex` for it and
robots.txt disallows it, so the raw home page is never indexed beside the published one.

The Vite plugin assembles at start and on every change to either source (dev), and into
the build output (build). Core's `public/` keeps only plain served files.

## 4. Templates

- **System default set:** `public/templates/default/` gains `partials.html`. The SPA renders
  a type on the default from these files, through the same filler as a custom folder; the
  built-in Angular layout in `content-detail` and `content-list` goes.
- **Publishing:** reads `/_site/templates/{folder}/{file}.html` from the live site
  (`functions/src/shared/site-files.ts`), the default folder included; the copy built
  into the functions is the last resort (W-D10).
- **Missing folder:** a type whose folder is not in the live `site.json` fails to publish,
  with the status "Template folder 'x' is not on the live site. Deploy the website, then
  publish again." Today it silently publishes with a bare fallback.
- **Picker:** reads the folders from `site.json`. The dead `/api/templates` call and the
  check of the old file names are removed.
- **Cards anywhere:** `<arc-content-partials content-type="articles" limit="6">` (plain
  attributes; the Angular binding form goes) renders that type's `partials.html` on the
  home page at publish time, and in the SPA preview.

## 5. The home page

**Publishing.** A new core function renders the home page for each enabled language:

1. Source: `home.{lang}.html` if `site.json` lists it, else `home.html` with
   `strings/{lang}.json` applied.
2. Fill `<arc-header>`, `<arc-footer>`, `<arc-content-partials>`, `<arc-search>` and
   `<arc-language-switcher>`, the same as content pages.
3. Merge into the document's own `<head>`: canonical, hreflang alternates, Open Graph and
   Twitter tags, WebSite and Organization JSON-LD, the site stylesheets, `arc-site.js`,
   the PWA manifest when on. The page's own `<title>` and description are kept; when
   missing, they come from Settings, About.
4. Write `/index.html` (default language) and `/{lang}/index.html` in one Hosting release.
5. List the home page in the sitemap and llms.txt. **As built:** llms.txt links it as HTML under Optional, since it has no Markdown twin.

**When it publishes.** After every website deploy (the reseed), when content of a type it
shows is published or unpublished, and from a "Republish home page" action in the admin. **As built:** the action is **Republish website** on the Content types page (the whole site, `redeploy-all`), since a Settings change can touch every page.

**Setup redirect.** The published page carries `data-setup` while the setup wizard is still to do (decided at publish time), and arc-site.js then sends the owner to /onboarding as the SPA does. A page published after setup has no check and no read.

**main.css.** The old marketing page's rules (about 840 lines: hero, sponsors, features, founding circle, contact) moved to `docs/examples/arc-cms-home.css`. Core `main.css` keeps only the body, header and footer, so an app's own class names (`.hero`, `section`) are not styled by core.

**Build.** Nothing is prerendered, so the Analog build has `ssr: false`: one browser bundle, faster and lighter, and `dist/analog/public/index.html` is the app shell until the seed publishes the home page over it.

**Preview.** In `npm run dev` the SPA's `/` and `/{lang}` render the same file from
`/_site/`, filling the same elements client-side. On the live site the published file
answers `/` before the SPA does. Between a website deploy and the reseed, `/` shows the
SPA preview of the live files, which looks the same.

**Removed:** `public/index.html`, `public/i18n/hi/index.html`, `home.hi.component.ts`, the
`/hi` route, `HOME_PAGE_LANGUAGES` and the prerender list. `HomeBaseComponent`'s behaviours
move to where they now run: signup forms and the legal notice to `arc-site.js`, JSON-LD to
the publisher, the onboarding redirect to the SPA preview route.

## 6. Header, footer, static pages, styles

- **Header and footer** render in the SPA from `/_site/header.html` and `footer.html`
  (bundled into the app at build so they are there on first paint). Core places the search
  box and language switcher in `<arc-search>` and `<arc-language-switcher>`, applies
  `data-arc-t` and the language prefix to links, as publishing does.
- **Static pages:** every page in `site.json` publishes with the website, not only privacy
  and cookie policy, and is listed in the sitemap.
- **Styles:** `/assets/css/site.css` loads after `main.css` in the SPA and on every
  published page (added to the default `cssUrls`, and appended when an install's stored
  list lacks it).

## 7. `arc-site.js`

A small script on every published page, no framework:

- Signup forms: `form[data-waitlist-form]` submits through the same callable as the SPA,
  with the verification step and the legal notice. Only when the `forms` feature is on.
- Live counts: `[data-waitlist-count]`.
- PWA: registers the service worker and exposes `arcSite.install()` and
  `arcSite.canInstall` for an install button, when the PWA is on.
- A signed-in hint: `arcSite.signedIn`, set by the SPA in local storage, so a home page can
  say "Open the app" instead of "Sign up".

## 8. Guards

- **Missing folder** (section 4).
- **Local differs from live:** when the admin runs on localhost, the editor fetches the live
  `/_site/site.json` and compares hashes with the local one. A difference shows "Your site
  files differ from the live site; publishing uses the live ones. Deploy the website first."
  beside Publish.

## 9. Migration

`npm run arc:own-site` in an app (it needs the `upstream` remote, like `check:core`):

1. For each site file under `public/` that differs from upstream: move it to its place in
   `src/custom/site/` and restore core's file. `public/index.html` becomes `home.html`,
   `public/i18n/{lang}/index.html` becomes `home.{lang}.html`.
2. Turn the old home page's Angular syntax into plain HTML (`[contentType]="'x'"` becomes
   `content-type="x"`, `ngSrc` becomes `src`, `&#123;`-style escapes stay valid) and wrap it
   into a whole document with the title from the old root `index.html`.
3. Write only the app's added or changed keys to `strings/{lang}.json`.
4. Report Firestore `templates/*` and `Settings/partials` documents that exist, with what to
   do with each (needs credentials through `runAdminScript`; skipped with a note otherwise).
5. Print the deploy order: functions and website together, then the reseed.

Without `--write` it prints the plan and changes nothing. `check:core`, when it lists a
file under `public/`, points to this command.

**As built (W6):**
- It runs after `git merge upstream/...`, mid-merge with conflicts open or after the merge
  commit; before the merge it stops and says to merge. It reads the app's old files from
  its newest commit in the old layout (the one with `public/_partials/_header.html`) and
  compares them with the Arc CMS version that commit was based on. A file the merge
  already carried into `public/_site/` with the app's edit is taken from the working copy.
  `public/` is restored to the Arc CMS version being merged, not the upstream tip.
- An edited `main.css` becomes `site.css`; otherwise the old `main.css` comes along as
  `assets/home.css`, linked from the migrated home page, since core `main.css` is slim now.
- Files the app added under `public/` move to `src/custom/site/assets/` (served at
  `/site/`), with links in the moved files updated.
- Step 4 (reporting Firestore template overrides) is not built: the closing message says
  they are no longer read. Old `src/app/pages/home-i18n/` components are reported for deletion.
- **Guard (section 8):** the dev server serves the live manifest at `/__arc/live-site.json`
  (Hosting sends no CORS headers), and `arc-site-drift-notice` shows "Live site differs"
  beside Publish and on Content types. The site name comes from `hostingSite` in
  `arc-install.ts`, now written by `arc:configure`; without it, the project's default site.

## 10. Phases

| Phase | Builds |
|-------|--------|
| W1 | `arc-site.mjs`, the Vite plugin, `/_site/` and `site.json`, noindex headers and robots, the empty `site.css`, tests |
| W2 | SPA: header and footer from HTML, templates from `/_site/`, one default set (with `partials.html`), the picker from `site.json`, static pages, favicon and error pages, dead code out; the site stylesheets switch (W-D18); the sign-in page branding (W-D19) |
| W3 | Functions: read `/_site/`, default set bundled, Firestore overrides removed, missing-folder failure, static pages from `site.json`, `site.css` in `cssUrls` |
| W4 | Home page publishing, languages, SEO, sitemap and llms.txt, republish triggers, admin action, SPA preview, placeholder, old home page removed, core function group |
| W5 | `arc-site.js`: forms, counts, legal notice, PWA, signed-in hint |
| W6 | The local-differs guard, `arc:own-site`, the `check:core` hint |
| W7 | Docs (below), the example home page, screenshots, full suite |

Each phase ends with the full suite passing. W3 to W5 change functions, so they need a
functions deploy to the dev project before the browser checks.

## 11. Docs to change

`docs/website/overview.html` (the "edit core files in place" table goes), `templates.html`,
`static-pages.html`, `languages.html`, `forms.html`, `seo.html`, `launch-checklist.html`;
`docs/features/templates.html` (Firestore overrides), `content.html`, `languages.html`;
`docs/app/custom-space.html`, `check-core-and-upgrade.html`, the upgrade page;
`docs/reference/npm-scripts.html`, `cloud-functions.html`; `src/custom/README.md`.
New: **Build your home page** (a new page under docs/website/, to be written in W4), with the example page.

## 12. Tests

- Resolver: app over core, string merge, missing files in a folder fall back to the default.
- Assembly and manifest: layout, hashes, noindex headers.
- Home publishing: language source choice, head merge (kept title, added tags), cards filled,
  one release for all languages, placeholder when the app has no home page.
- Templates: missing folder fails with the message; default set bundled; overrides gone.
- `arc-site.js`: form submit, counts, notice links only for pages that exist.
- Migration: plan only without `--write`; Angular syntax converted; core files restored.
- Docs checks pass with the new files and scripts.
