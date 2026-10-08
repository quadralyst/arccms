# Changelog

All notable changes to Arc CMS will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added

- **The country beside a mobile number.** On the sign-in page the "Phone number or email" field shows the number's country (flag and calling code) as soon as it holds a number, and a list to change it when the site takes several countries; the profile's number box and the SMS test send have it too. A pasted or autofilled `+44 ...` number moves its code to the country, a number from a country the site does not take is refused at once naming the ones it takes, and the server gets the number with its code. The chip starts on the country this device used last, else the default. See docs/features/sign-in.html.
- **Settings, SMS picks countries, not codes.** **Countries** lists the countries people can sign in from, with flags and a search by name, ISO id or code; **Default country** shows when there are several. `Settings/sms` stores `defaultCountry` and `allowedCountries` beside the calling codes the server reads, and `Settings/users` gets `phoneCountry` and `phoneCountries` for the sign-in page. A site saved before reads each saved code as its main country until it is saved again. See docs/features/sms.html.
- `arc-phone-country`, `arc-country-picker`, the country table (`src/shared/data/countries.ts`, flags in `public/flags` from flag-icons, MIT) and `src/shared/utils/phone-country.ts`, for an app's own number boxes. See docs/app/custom-space.html.

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

- **The install files ship with no Firebase project.** `src/environments/environment.ts` and `environment.prod.ts` have empty web settings, and `arc-install.ts` is `{}`. A copy that has not been set up stops at `npm run dev` or `npm run build` with "No Firebase project configured: run npm run arc:configure", instead of talking to Arc CMS's own project. Arc CMS never changes the values in these files again; when it needs a new key in one, this changelog names it.
- **`npm run dev` and `npm run build` use the `default` alias** in `.firebaserc` when `arc:configure` has written its `firebase-web.<id>.ts`, and print the project as they start. They fall back to the environment files only when there is no such file. `ARC_PROJECT` still wins.
- `firebase-web.<id>.ts` now carries the project's install settings (`arcInstall`) too; an entry in `arc-install.ts` still wins.
- With the `seo` feature off, `npm run seed` no longer writes robots.txt, the sitemap, llms.txt, llms-full.txt or the feeds, and the next website deploy removes the ones already on Hosting.
- The callable check (`npm run deploy -- --probe`, `functions/scripts/check-callable-access.sh`) reads the functions build without `GCLOUD_PROJECT`, checks the deploy's project and its functions region by default instead of a fixed project, and says it checked nothing (exit 2) rather than reporting callables as blocked when it cannot read the build.

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

- **`npm run test` type-checks the app and the functions**, and **`npm run typecheck`** runs that check alone (`scripts/typecheck.mjs`). Vitest does not check types, so a type error used to pass the suite and fail only at `npm run build` or a deploy. The admin SMS settings page had one such error, which stopped the production build; it is fixed.

- On a site whose default country code is `+1` or `+7`, a number typed without `+` that starts with that digit (every Kazakh mobile starts with 7) was read as already carrying the code: `701 123 45 67` became `+7011234567`. Both twins of `normalizePhone` now need all eleven digits for those codes. In Russia, Kazakhstan and Belarus, a number typed with the domestic `8` in front of it beside the country chip is read correctly.
- New member translation keys: `member.phone_country.*`, `member.auth.identifier_error.phone_start_choose` and `phone_not_allowed`; `phone_start` is shorter.

- **Sign-in codes: waits and limits.** Choosing Change number and coming back to the same number (or address) within the code's 10 minutes goes straight to the code boxes, with the Resend countdown carrying on, instead of "Please wait 39s" and a live Resend button. A "please wait" from the server starts the countdown. The server checks the one-minute wait before the hourly limits, and a send the provider refuses gives its count back, so only codes actually sent count. At the limit the page says when to try again ("Try again after 5:42 PM"). The profile's add-a-number and add-an-email steps behave the same. See docs/features/sign-in.html.
- **One sign-in code at a time.** Asking for a code again while the last one still works (not used, not expired, under 5 wrong tries, sent in the last 30 minutes) sends the same code with another 10 minutes, by SMS and by email, so a person never holds two messages with different codes; the page says "We sent the same code again." Wrong tries are no longer reset by a resend. The code is kept sealed (AES-256-GCM, key derived from the server's secret in `_system`) beside its hash; codes stored before this update get a new code on the next request. Functions `requestPhoneOtp`, `requestSignupOtp` and `requestEmailLinkOtp` reply `sameCode: true` when they resent one.
- **Sign-in messages from the server are in the member's language.** Every refusal the sign-in functions send a member carries `details.reason` and its numbers, and the page shows `member.auth.server_error.<reason>`; the server's English is only a fallback.
- `consumeRateLimit` (app kit) takes an optional fifth argument, `reason`, and its refusal carries `details.reason` and `details.retryAfter` (seconds). Existing calls work unchanged.
- New member translation keys: `member.auth.server_error.*`, `member.auth.code_already_sent` and `member.auth.code_sent_again`.

### For apps upgrading

1. Merge the new version. If your copy edited files in `public/`, run `npm run arc:own-site`, then `npm run arc:own-site -- --write` (docs/website/move-your-site.html).
2. Check your own templates and pages for the old marketing classes (`.hero`, `.feature-card`, `.cta-primary`, `.section-headline` and the like) and for sections that relied on the `main.css` padding. `arc:own-site` brings the old styles back for a migrated home page only; elsewhere, copy the rules you use from `docs/examples/arc-cms-home.css` into `src/custom/site/site.css`.
3. Run `npm run arc:configure` once, so `arc-install.ts` names your hosting site.
   - The merge conflicts in `src/environments/environment.ts`, `environment.prod.ts` and `arc-install.ts` if your copy filled them in: Arc CMS emptied them. Keep your own version of all three (`git checkout --ours <file>`).
4. Run `npm run typecheck` and fix any type error it reports in your own pages or functions: `npm run test` now fails on them. They would already have failed your production build.
5. If your app has its own member languages, add the new member keys (`member.phone_country.*`, `member.auth.identifier_error.phone_start_choose`, `phone_not_allowed`, `member.auth.server_error.*`, `member.auth.code_already_sent`, `member.auth.code_sent_again`) to `src/custom/i18n/{lang}.json`; the member language check names any that are missing.
6. Deploy everything (`npm run deploy`), then republish (`npm run seed:prod`). Then open Settings, SMS once as an admin: that copies the list of countries for the sign-in page.
7. On an install set up before the standard pages, or before page layouts, open **Content types** and choose **Add standard pages** (it adds the pages and the Info boxes field that are missing). Then pick **Layout: Contact** on your Contact page if you want the new layout. If your own footer listed the old Documentation, GitHub or Community links from Arc CMS's footer, they are gone from the default one; keep your own footer as it is.

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
