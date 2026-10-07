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
- **Cards from content types without public pages.** A type with **Generate public pages** off shows in the home page's card block, through its **Card template**, with no links. Services, a hero or testimonials are edited in the admin without each item getting a page. See docs/website/editable-sections.html.
- **Your own entry order.** A content type can be set to **Your own order**; **Arrange** on the entry list drags entries into place, and the list page and home page cards follow it.
- **Site info on pages.** `data-arc-site`, `data-arc-site-if` and `data-arc-site-loop` print the site's name, email, phone, address, logo, social links, standard pages and the year from Settings, About, in the header, footer, home page, templates and static pages. About gains a public **Phone**, published as `telephone`.
- **FAQ custom field.** Repeating questions and answers, with FAQPage structured data on the page.
- **Contact form** (feature `contact`, on by default). `<form data-arc-contact-form>` on any published page, spam checks, a **Messages** inbox and an alert to admins (`admin_contact_message`). New functions `submitContactMessage` and `onContactMessageCreated`, a `ContactMessages` collection with its rules and index.
- **Standard pages.** A built-in **Info Pages** type at `/info` with About, Contact, FAQ, Privacy Policy, Terms and Cookie Policy as drafts, created by the setup wizard or **Add standard pages**. A new `info` template folder shows a map, questions, contact details and the contact form per page. Structured data type **Web page**.
- **Page layouts.** A template folder may hold layouts, `detail-{name}.html`, and an entry picks one with **Layout** in the editor (shown only when its folder has one); list and card templates are unchanged. A layout the live site lacks falls back to `detail.html`. Core ships a Contact layout for the standard pages (intro, map beside the address, contact boxes beside the form), a new **Info boxes** field on Info Pages, and a new Contact page starts with both.

### Changed

- On a translated page, only links to pages that exist in every language take the language prefix: the home page, search and public content types. Sign-in, the member area, an app's own pages, static pages and files keep their address, and a stray `/hi/signup` redirects to `/signup`.
- The app's own files in `src/custom/site/assets/` are linked with their version (`/site/home.css?v=…`) on published pages, in the preview and in `url()` of the app's stylesheets, so a changed file reaches returning visitors.
- Publishing reads templates and site files from the live site's `/_site/`; template overrides stored in Firestore are no longer read.
- The build no longer prerenders or builds a server bundle.
- **`firebase-functions` is now 7.4.0** (was 7.1.0), which clears the Firebase CLI's "out of date" warning on deploy. No code changes in an app. After merging, run `npm install --prefix functions` and redeploy all the functions.
- Dependencies refreshed with `npm audit fix` (lock files only, no version range changed): no critical advisories left, root down from 69 to 32 advisories and `functions/` from 52 to 20. Run both installs after merging.
- **The Firebase CLI is pinned in the root `package.json`** instead of `functions/package.json`. Functions deploys no longer install it (467 fewer packages, `functions/` advisories down to 11), and the npm scripts still run the pinned copy. A CI workflow copied from docs/app/ci.html can drop the step that adds `functions/node_modules/.bin` to `GITHUB_PATH`. An app that added `firebase-tools` to `functions/package.json` itself should remove it there.
- `npm run deploy` keeps the published pages when it deploys the website: the build goes to a preview channel, then one live release holds the build and the published pages. Never deploy the website with a plain `firebase deploy --only hosting`.
- Publishing keeps every file of a site past 1000 files (the live file list is now read page by page).
- `main.css` styles only the body, header and footer. The old marketing page's styles are in `docs/examples/arc-cms-home.css`. Its global `section { padding: 100px 0 }` rule is gone too.
- The published home page republishes itself when Settings it shows change (About, the site address, languages, the powered-by line).
- Signups from the published home page record the same metadata as the app's forms, and someone already on the list sees "Welcome back".
- `arc-site.js` runs on every published page (content, list and static pages too), so signup and contact forms work anywhere on the site.
- The signup terms notice, the contact form's privacy line and the cookie banner link to the published standard pages (`/info/terms`, `/info/privacy-policy`, `/info/cookie-policy`) when they exist.
- The default footer lists the published standard pages and a copyright line instead of the Documentation, GitHub and Community links. Its `main.css` rules apply only to the site footer, so a `<footer>` inside a card or dialog keeps its own look.
- The About setting **Profiles elsewhere (sameAs)** is now **Social and profile links**.

### For apps upgrading

1. Merge the new version. If your copy edited files in `public/`, run `npm run arc:own-site`, then `npm run arc:own-site -- --write` (docs/website/move-your-site.html).
2. Check your own templates and pages for the old marketing classes (`.hero`, `.feature-card`, `.cta-primary`, `.section-headline` and the like) and for sections that relied on the `main.css` padding. `arc:own-site` brings the old styles back for a migrated home page only; elsewhere, copy the rules you use from `docs/examples/arc-cms-home.css` into `src/custom/site/site.css`.
3. Run `npm run arc:configure` once, so `arc-install.ts` names your hosting site.
4. Deploy everything (`npm run deploy`), then republish (`npm run seed:prod`).
5. On an install set up before the standard pages, or before page layouts, open **Content types** and choose **Add standard pages** (it adds the pages and the Info boxes field that are missing). Then pick **Layout: Contact** on your Contact page if you want the new layout. If your own footer listed the old Documentation, GitHub or Community links from Arc CMS's footer, they are gone from the default one; keep your own footer as it is.

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
