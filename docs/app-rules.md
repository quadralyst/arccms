# App rules: security rules and indexes for an app built on Arc CMS

An app built on Arc CMS shares its Firestore database and Storage bucket, and
Firebase takes one rules file per database and per bucket. So the app never edits
Arc CMS's files. It keeps its own next to them, and every deploy combines the two.

| Arc CMS (core, never edited by the app) | The app's own (optional) |
|---|---|
| `firestore.rules` | `firestore.app.rules` |
| `storage.rules` | `storage.app.rules` |
| `firestore.indexes.json` | `firestore.app.indexes.json` |

`scripts/arc-rules-build.mjs` writes the combined files to `.arc-build/` (not
committed), and `firebase.json` deploys those. It runs by itself before every
Firestore and Storage deploy (a Firebase `predeploy`), including a plain
`firebase deploy`. Run it by hand with `npm run rules:build`.

Upstream Arc CMS updates then never touch the app's files, so merges stay clean.

## Writing app rules

The app file holds `match` blocks (and functions of its own), with **no**
`rules_version` or `service` wrapper. They are placed inside Arc CMS's
`match /databases/{database}/documents` scope (for Storage: `match /b/{bucket}/o`),
where the core file has the line `// @arc-app-rules`.

```
// firestore.app.rules
match /users/{userDocId}/children/{childId} {
  allow read, write: if ownsUserRecord(userDocId);
  allow read: if isAdmin();

  match /progress/{lessonId} {
    allow read, write: if ownsUserRecord(userDocId);
  }
}
```

```
// storage.app.rules: the per-user folder is readable by its owner and admins in
// the core rules; writes, with the app's limits, are granted here.
match /users/{userDocId}/recordings/{fileName} {
  allow write: if ownsUserRecord(userDocId)
    && (request.resource == null
        || (request.resource.size < 10 * 1024 * 1024 && request.resource.contentType.matches('audio/.*')));
}
```

**Helpers** the core files define for app rules, in both Firestore and Storage:

| Helper | True when |
|---|---|
| `isSignedIn()` | anyone is signed in |
| `isAdmin()` | the signed-in person is an Arc CMS admin (`role` claim) |
| `isEditor()` | an admin or an editor |
| `ownsUserRecord(userDocId)` | the signed-in person owns `users/{userDocId}` (the `arccms_uid` claim, no document read; see [account-contract.md](account-contract.md)) |

**Things to know**
- Rules in Firebase add up: if any matching rule allows a request, it is allowed.
  An app rule can grant more, never take away what a core rule grants.
- Storage: the core rules keep every path public for reading except folders named
  `users` in the first two levels (the per-user folders). Put private files under
  `users/{userDocId}/`.
- Keep function names in the app file distinct from the core helpers.

## App indexes

`firestore.app.indexes.json` has the same shape as `firestore.indexes.json`
(`indexes`, `fieldOverrides`). They are merged without duplicates; a field override
defined differently in both files stops the build.

`npm run export-indexes` (live indexes into the core file) leaves out the indexes
listed in the app file, so app indexes never move into Arc CMS's file.

## Testing app rules

`npm run test:rules` builds the combined files and runs every spec in `tests/rules/`
against the Firestore and Storage emulators (it needs Java 21). The core specs load
`.arc-build/firestore.rules` and `.arc-build/storage.rules`, so app specs placed in
`tests/rules/` (for example `tests/rules/app.firestore.spec.ts`) test the app rules
together with the core ones, in the same way.
