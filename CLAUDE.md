# Working in this repository

This is Arc CMS, or an app built on a copy of it.

## If this is an app built on Arc CMS (a copy with its own features)

- **Never edit Arc CMS (core) files.** Put every app change in the custom space:
  `src/custom/` (pages, routes, admin menu items, translations, styles),
  `functions/src/custom/` (Cloud Functions and triggers), and
  `firestore.app.rules`, `storage.app.rules`, `firestore.app.indexes.json`.
  Read docs/app/custom-space.html before writing code.
- If the app needs something core does not offer, stop and say so: it belongs in
  Arc CMS as a general feature or plug point, not as an edit here.
- Run `npm run check:core` before every commit; it must report no core file.
- The account contract (the `arccms_uid` claim, where per-person data lives, what
  deleting an account removes) is docs/app/account-contract.html; security rules for app
  data are docs/app/rules-and-indexes.html.

## If this is Arc CMS itself

- Keep it generic: nothing specific to any one app. App-specific needs become
  general features or plug points, documented in docs/app/custom-space.html.
- Never put anything in the custom space (`src/custom/`, `functions/src/custom/`,
  `*.app.rules`, `firestore.app.indexes.json`) beyond the empty starter files: apps
  own those files, and a change there would conflict with every app on update.

## Documentation and tests are part of every task

A task that changes anything is not done until the docs, the tests and the whole suite agree with it.

- `docs/` is the official developer documentation (HTML, open `docs/index.html`). It says
  how Arc CMS works and how to use it, today. `specs/` holds the working papers: build
  specs, test plans, runbooks and the backlog. Never link from `docs/` into `specs/`.
- Before finishing, run `npm run docs:affected`. It lists the docs pages that describe the
  files you changed. Read them and update what is now wrong, in the same task. Retake the
  screenshots of any screen you changed. In the report, say which pages and screenshots
  changed, or why none needed to.
- Add or update tests that would have caught the change breaking. The docs have their own
  tests (`npm run check:docs`): they fail on a broken link, a page that names a file, script,
  feature or function that no longer exists, and a feature or script the docs do not cover.
- Run the whole suite (`npm run test`, and `npm run test:rules` when rules changed). If
  anything fails, the task is not done: fix it, or report it as unfinished with the output.
- In an app built on Arc CMS, the app's own pages go in `docs/custom/`; the rest of `docs/`
  is core and is not edited there.
