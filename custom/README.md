# The app's own folder

An app built on a copy of Arc CMS keeps here everything that is not part of the built
site: command-line scripts, the data they import, and design notes and mockups. Arc CMS
ships only this README and never edits the folder, so pulling Arc CMS updates never
conflicts with it, and `npm run check:core` treats it as the app's own.

Nothing here is bundled into the site. A suggested layout (none of it is required):

| Folder | For |
|--------|-----|
| `scripts/` | scripts the app runs from the command line, like data imports |
| `data/` | source files those scripts read |
| `design/` | design notes, mockups and other working files |

A script that talks to Firebase gets the project, the install's database and the
credentials from `runAdminScript` instead of setting them up itself:

```js
// custom/scripts/count-words.mjs
import { runAdminScript } from '../../scripts/arc-admin-script.mjs';

runAdminScript(async ({ db }) => {
    const snap = await db.collection('words').count().get();
    console.log(`${snap.data().count} words`);
});
```

    node custom/scripts/count-words.mjs           the dev project
    node custom/scripts/count-words.mjs --prod    the production project

Tests named `*.spec.ts` in this folder run with `npm run test`. The app's documentation
goes in `docs/custom/`. See docs/app/scripts-and-data.html.
