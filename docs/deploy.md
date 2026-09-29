# Deploying Arc CMS

Run one command and answer a few questions:

```bash
npm run deploy
```

Each question has a default in brackets; press Enter to take it.

1. **Which Firebase project?** Your `.firebaserc` projects, with the one you deployed to last
   (or chose with `firebase use`) first. "Another project id" takes any other.
2. **Its settings.** The deploy shows what the project uses, for example:

   ```
   xlm-project-864ff
     Database:   arccms
     Website:    off
     Storage:    the default bucket, folder arccms/
     App users:  users/{id} in (default)
   ```

   They come from `arccms.config.json`, and the files generated from it are rebuilt on every
   deploy, so they are never out of date. A project with no settings yet is offered a short
   setup (below).
3. **What to deploy?**
   - Only the functions changed since the last deploy (shown with how many)
   - Everything: functions, database rules and indexes, storage rules, and the website
   - All functions
   - Database rules and indexes
   - Storage rules
   - Website: builds it, publishes it, then publishes the static pages

   A choice is marked "changed since the last deploy" when its files changed. The website is
   offered only where it is on and has a build (the `default` and `production` projects).
4. **Confirm.** The summary shows the project, the config file and the exact command. For a
   production project (named `production`, or with prod or live in its id) you type the
   project id instead of pressing Enter.

Afterwards, a new callable is checked for being reachable from the browser, and the deploy is
remembered (in `.arc-deploy-state.json`, not committed) for the next "only what changed".

## A project with no settings yet

The deploy asks how the project is used:

- **Only by Arc CMS** (its own website or app): whether to publish the website on the project's
  main site. The site's own users become the App audience (live lists, change events,
  `##APP.*##` tags), reading their `email`, `name` and `phone` until you change that in
  Settings, App audience. Then it deploys as usual.
- **Shared with another app** (Arc CMS as its admin or backend): Arc CMS gets its own database,
  website (or none), storage bucket and folder, so neither app touches the other's. The other
  app's users are the App audience: it asks where they are (`users/{id}` unless you say
  otherwise, or `none`). It then lists the commands that create the database, site and bucket,
  and stops: create them first (the database in the same location as the other app), then run
  `npm run deploy` again. Commit `src/environments/arc-install.ts` as well; the website reads
  it.

## Storage next to another app

Firebase keeps one storage rules file per bucket. When Arc CMS shares a project with another
app (it has its own database) but keeps its files in the project's default bucket, deploying
Arc CMS's storage rules would replace the other app's. So such an install deploys no storage
rules: the menu does not offer them, and `--only storage` stops with a message.

Give Arc CMS a bucket of its own to deploy them:

1. Firebase console, Storage, the bucket menu, "Add bucket" (for example `<project>-arccms`).
2. `npm run arc:configure -- --project=<alias> --bucket=<that bucket>`, then commit
   `src/environments/arc-install.ts`.
3. `npm run deploy`, then "Everything" (the functions need the new bucket too, for deleting
   accounts).

Files already uploaded stay where they are; their links keep working.

## When the deploy stops

- **"...is set up with the database ... but this checkout has no settings for it"**: this
  project was set up on another computer. Copy its `arccms.config.json` here. Deploying without
  it would send the functions and rules to a different database than the website reads.
- **"arccms.config.json says the database is ... but arc-install.ts says ..."**: the two were
  changed separately. Run `npm run arc:configure -- --project=<alias>`, check the result and
  commit `src/environments/arc-install.ts`.
- **"Hosting is off for ..."**: the project publishes no website (`--site=none`).
- **"Storage rules are not deployed for ..."**: Arc CMS shares the default bucket with another
  app (see Storage next to another app).

## Deploying with options

With options, `npm run deploy` asks nothing, which is what scripts and CI use:

```bash
npm run deploy -- --only functions:arccms --project default
npm run deploy -- --only functions:arccms:arccms.<name> --project default
npm run deploy -- --only firestore --project default
npm run deploy -- --only storage --project default
```

It still picks the project's settings, retries functions that hit Google's per-minute limit,
and records whole deploys for "only what changed". Add `--probe` after adding a callable to
check every callable is reachable.

Always deploy through `npm run deploy`, never plain `firebase deploy`: only the former uses the
project's settings (its database, website and bucket).
