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

- Publishing reads templates and site files from the live site's `/_site/`; template overrides stored in Firestore are no longer read.
- The build no longer prerenders or builds a server bundle.
- `main.css` styles only the body, header and footer. The old marketing page's styles are in `docs/examples/arc-cms-home.css`.

### For apps upgrading

1. Merge the new version. If your copy edited files in `public/`, run `npm run arc:own-site`, then `npm run arc:own-site -- --write` (docs/website/move-your-site.html).
2. Run `npm run arc:configure` once, so `arc-install.ts` names your hosting site.
3. Deploy everything (`npm run deploy`), then republish (`npm run seed:prod`). Until the republish, `/` shows the home page from the app instead of the published file.

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
