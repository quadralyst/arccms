# Changelog

All notable changes to Arc CMS will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added

- **The app owns its website.** Home page, header, footer, sign-in panel, content templates, static pages, strings, site styles, favicon and error pages live in `src/custom/site/`, laid over Arc CMS's defaults in `public/_site/`. See docs/website/overview.html.
- **The home page is published as a static page** in every language, from `src/custom/site/home.html` (or `home.{lang}.html`), with SEO tags and live parts run by `/assets/js/arc-site.js`. **Republish website** on the Content types page publishes everything again.
- **`npm run arc:own-site`** moves a site an app edited in `public/` into `src/custom/site/`.
- In `npm run dev`, the editor says **Live site differs** when your site files are not the live ones yet.

### Changed

- On a translated page, only links to pages that exist in every language take the language prefix: the home page, search and public content types. Sign-in, the member area, an app's own pages, static pages and files keep their address, and a stray `/hi/signup` redirects to `/signup`.
- The app's own files in `src/custom/site/assets/` are linked with their version (`/site/home.css?v=…`) on published pages, in the preview and in `url()` of the app's stylesheets, so a changed file reaches returning visitors.
- Publishing reads templates and site files from the live site's `/_site/`; template overrides stored in Firestore are no longer read.
- The build no longer prerenders or builds a server bundle.
- `npm run deploy` keeps the published pages when it deploys the website: the build goes to a preview channel, then one live release holds the build and the published pages. Never deploy the website with a plain `firebase deploy --only hosting`.
- Publishing keeps every file of a site past 1000 files (the live file list is now read page by page).
- `main.css` styles only the body, header and footer. The old marketing page's styles are in `docs/examples/arc-cms-home.css`. Its global `section { padding: 100px 0 }` rule is gone too.
- The published home page republishes itself when Settings it shows change (About, the site address, languages, the powered-by line).
- Signups from the published home page record the same metadata as the app's forms, and someone already on the list sees "Welcome back".

### For apps upgrading

1. Merge the new version. If your copy edited files in `public/`, run `npm run arc:own-site`, then `npm run arc:own-site -- --write` (docs/website/move-your-site.html).
2. Check your own templates and pages for the old marketing classes (`.hero`, `.feature-card`, `.cta-primary`, `.section-headline` and the like) and for sections that relied on the `main.css` padding. `arc:own-site` brings the old styles back for a migrated home page only; elsewhere, copy the rules you use from `docs/examples/arc-cms-home.css` into `src/custom/site/site.css`.
3. Run `npm run arc:configure` once, so `arc-install.ts` names your hosting site.
4. Deploy everything (`npm run deploy`), then republish (`npm run seed:prod`).

---

## [1.0.0] - 2026-03-06

### Added

- **Content Management** — Dynamic content types with custom fields, rich text editor (TipTap), draft/publish workflow, tags, and SEO optimization
- **Template System** — HTML template hydration with data binding, loops, and custom styling
- **Waitlist Management** — Signup forms, referral tracking, leaderboard, and email workflows
- **User Management** — Email/password authentication, role-based access control (admin/user)
- **Email Integration** — Modular email provider support (SMTP, Gmail, Resend) with broadcast messaging and tracking
- **Admin Dashboard** — Content management, user management, waitlist management, email logs, and settings
- **Analytics Integration** — Google Analytics connection and dashboard
- **Cloud Functions** — Firestore triggers for user lifecycle, content publishing, waitlist operations, email processing, and analytics
- **Onboarding Wizard** — First-run setup flow for initial admin account creation
- **Global Banner** — Configurable site-wide announcement banner
- **Cookie Consent** — GDPR-compliant cookie consent banner
- **Media Library** — Image upload and management with Unsplash integration
