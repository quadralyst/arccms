# Working in this repository

This is Arc CMS, or an app built on a copy of it.

## If this is an app built on Arc CMS (a copy with its own features)

- **Never edit Arc CMS (core) files.** Put every app change in the custom space:
  `src/custom/` (pages, routes, admin menu items, translations, styles),
  `functions/src/custom/` (Cloud Functions and triggers), and
  `firestore.app.rules`, `storage.app.rules`, `firestore.app.indexes.json`.
  Read docs/custom-code.md before writing code.
- If the app needs something core does not offer, stop and say so: it belongs in
  Arc CMS as a general feature or plug point, not as an edit here.
- Run `npm run check:core` before every commit; it must report no core file.
- The account contract (the `arccms_uid` claim, where per-person data lives, what
  deleting an account removes) is docs/account-contract.md; security rules for app
  data are docs/app-rules.md.

## If this is Arc CMS itself

- Keep it generic: nothing specific to any one app. App-specific needs become
  general features or plug points, documented in docs/custom-code.md.
- Never put anything in the custom space (`src/custom/`, `functions/src/custom/`,
  `*.app.rules`, `firestore.app.indexes.json`) beyond the empty starter files: apps
  own those files, and a change there would conflict with every app on update.
