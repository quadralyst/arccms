# Custom space

This folder belongs to the app built on this copy of Arc CMS. Arc CMS ships these
files once, empty, and never changes them again, so pulling Arc CMS updates never
conflicts with what the app puts here. Never edit Arc CMS's own (core) files in an
app: see docs/custom-code.md, and run `npm run check:core`.

| File | For |
|------|-----|
| `routes.ts` | the app's pages, as Angular routes |
| `pages/` | the app's pages, found by file name like `src/app/pages` (`learn.page.ts` is `/learn`) |
| `nav.ts` | the app's items in the admin menu |
| `i18n/{lang}.json` | the app's translations (and rewording of core ones) |
| `styles.css` | the app's global styles, loaded after everything else |

The app's Cloud Functions go in `functions/src/custom/`, its security rules in
`firestore.app.rules` and `storage.app.rules` (docs/app-rules.md).
