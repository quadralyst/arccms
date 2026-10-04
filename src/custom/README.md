# Custom space

This folder belongs to the app built on this copy of Arc CMS. Arc CMS ships these
files once, empty, and never changes them again, so pulling Arc CMS updates never
conflicts with what the app puts here. Never edit Arc CMS's own (core) files in an
app: see docs/app/custom-space.html, and run `npm run check:core`.

| File | For |
|------|-----|
| `routes.ts` | the app's pages, as Angular routes |
| `pages/` | the app's pages, found by file name like `src/app/pages` (`learn.page.ts` is `/learn`) |
| `nav.ts` | the app's items in the admin menu |
| `user-dashboard.ts` | the app's own page where members land, `/user/dashboard` |
| `home.ts` | where each role lands after signing in |
| `i18n/{lang}.json` | the app's translations (and rewording of core ones) |
| `styles.css` | the app's global styles, loaded after everything else |
| `pwa.ts`, `pwa-icon.svg` or `.png` | the installable app: name, colours, icon (docs/features/pwa.html) |
| `features.ts` | the Arc CMS features the app turns off, and the PWA on |
| `site/` | the public website: `header.html`, `footer.html`, `sign-in.html` (the sign-in page's brand panel), `site.css`, `templates/{folder}/`, `pages/`, `strings/{lang}.json`, `assets/` (served at `/site/`), `favicon.ico`, `403.html`, `404.html`. Each file replaces Arc CMS's at the same place in `public/_site/` or `public/`; strings are merged (docs/website/overview.html) |

The app's Cloud Functions go in `functions/src/custom/`, its security rules in
`firestore.app.rules` and `storage.app.rules` (docs/app/rules-and-indexes.html).
