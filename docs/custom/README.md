# The app's own docs

An app built on a copy of Arc CMS keeps its own documentation here. Arc CMS never
edits this folder, so pulling Arc CMS updates never conflicts with it, and
`npm run check:core` treats it as the app's own.

The rest of `docs/` is Arc CMS's developer documentation. Open `docs/index.html`.
Its checks skip this folder, so pages here follow whatever format the app wants.
