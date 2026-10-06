/*
 * The page list of the docs, defined once. The sidebar, the previous and next links, the
 * breadcrumbs and the search index all come from here, in this order. A page is listed
 * when it exists (a test fails on a page that is missing from this list, and on an entry
 * whose page or heading is not there).
 */
window.ARC_DOCS_NAV = [
  {
    title: "Get started",
    pages: [
      { path: "getting-started/what-is-arc-cms.html", title: "What is Arc CMS" },
      { path: "getting-started/website-or-app.html", title: "A website or an app" },
      { path: "getting-started/requirements.html", title: "Requirements" },
      { path: "getting-started/install.html", title: "Install" },
      { path: "getting-started/configure.html", title: "Configure a project" },
      { path: "getting-started/run-locally.html", title: "Run it locally" },
      { path: "getting-started/first-admin.html", title: "Create the first admin" },
      { path: "getting-started/folder-tour.html", title: "A tour of the folders" },
      { path: "getting-started/first-deploy.html", title: "Deploy for the first time" },
      { path: "getting-started/upgrading.html", title: "Upgrade Arc CMS" },
      { path: "website/move-your-site.html", title: "Move your site into src/custom/site" }
    ]
  },
  {
    title: "Concepts",
    pages: [
      { path: "concepts/architecture.html", title: "Architecture" },
      { path: "concepts/core-and-custom.html", title: "Core and custom" },
      { path: "concepts/roles-and-claims.html", title: "Roles and claims" },
      { path: "concepts/shared-firebase-project.html", title: "Sharing a Firebase project" }
    ]
  },
  {
    title: "Build a website",
    pages: [
      { path: "website/overview.html", title: "Build a website" },
      { path: "website/convert-a-site.html", title: "Turn an HTML site into an Arc CMS site" },
      { path: "website/plan-content.html", title: "Plan your content" },
      { path: "website/content-types.html", title: "Define content types" },
      { path: "website/templates.html", title: "Design templates" },
      { path: "website/home-page.html", title: "Build your home page" },
      { path: "website/editable-sections.html", title: "Let editors change your home page" },
      { path: "website/static-pages.html", title: "Write static pages" },
      { path: "website/sign-in-page.html", title: "Brand the sign-in page" },
      { path: "website/media.html", title: "Manage media" },
      { path: "website/authors-and-tags.html", title: "Add authors and tags" },
      { path: "website/seo.html", title: "Get found by search engines and AI" },
      { path: "website/languages.html", title: "Publish in more than one language" },
      { path: "website/search.html", title: "Add search" },
      { path: "website/forms.html", title: "Collect sign-ups" },
      { path: "website/choose-features.html", title: "Choose your website's features" },
      { path: "website/launch-checklist.html", title: "Launch checklist" }
    ]
  },
  {
    title: "Build a custom app",
    pages: [
      { path: "app/overview.html", title: "Build a custom app" },
      { path: "app/custom-space.html", title: "Use the custom space" },
      { path: "app/choose-features.html", title: "Choose your app's features" },
      { path: "app/pages-and-routes.html", title: "Add pages and routes" },
      { path: "app/admin-menu.html", title: "Add admin menu items" },
      { path: "app/member-area.html", title: "Build the member area" },
      { path: "app/functions.html", title: "Write your own Cloud Functions" },
      { path: "app/scripts-and-data.html", title: "Run scripts and keep data" },
      { path: "app/rules-and-indexes.html", title: "Set security rules and indexes" },
      { path: "app/account-contract.html", title: "Follow the account contract" },
      { path: "app/app-accounts.html", title: "App accounts" },
      { path: "app/app-kit.html", title: "The app kit" },
      { path: "app/pin.html", title: "PINs for your app" },
      { path: "app/member-languages.html", title: "Member languages" },
      { path: "app/sign-in.html", title: "Set up sign-in" },
      { path: "app/payments.html", title: "Add payments and premium features" },
      { path: "app/pwa.html", title: "Make it installable" },
      { path: "app/offline.html", title: "Keep working offline" },
      { path: "app/environments.html", title: "Dev, staging and production" },
      { path: "app/ci.html", title: "Deploy from CI" },
      { path: "app/app-audience.html", title: "Connect your app's users" },
      { path: "app/shared-project.html", title: "Share a Firebase project" },
      { path: "app/check-core-and-upgrade.html", title: "Keep core untouched" }
    ]
  },
  {
    title: "Features",
    pages: [
      { path: "features/overview.html", title: "All features" },
      { path: "features/content.html", title: "Content" },
      { path: "features/templates.html", title: "Templates" },
      { path: "features/media.html", title: "Media" },
      { path: "features/authors-and-tags.html", title: "Authors and tags" },
      { path: "features/search.html", title: "Search" },
      { path: "features/seo.html", title: "SEO and discoverability" },
      { path: "features/languages.html", title: "Languages" },
      { path: "features/forms.html", title: "Signup forms" },
      { path: "features/audience.html", title: "Audience" },
      { path: "features/app-audience.html", title: "App audience" },
      { path: "features/email.html", title: "Email engine" },
      { path: "features/email-marketing.html", title: "Email marketing" },
      { path: "features/automations.html", title: "Automations" },
      { path: "features/sms.html", title: "SMS" },
      { path: "features/sign-in.html", title: "Sign-in methods" },
      { path: "features/payments.html", title: "Payments" },
      { path: "features/entitlements.html", title: "Premium entitlements" },
      { path: "features/users-and-roles.html", title: "Users and roles" },
      { path: "features/pwa.html", title: "Installable app (PWA)" },
      { path: "features/contact.html", title: "Contact form" },
      { path: "features/feedback.html", title: "Feedback button" },
      { path: "features/notifications.html", title: "Notifications" },
      { path: "features/analytics.html", title: "Analytics" },
      { path: "features/banners.html", title: "Banners" },
      { path: "features/data.html", title: "Data import and export" }
    ]
  },
  {
    title: "Use Arc CMS",
    pages: [
      { path: "admin/overview.html", title: "Use the admin area" },
      { path: "members/overview.html", title: "What members see" }
    ]
  },
  {
    title: "Operations",
    pages: [
      { path: "operations/deploy.html", title: "Deploy" },
      { path: "operations/targeted-deploys.html", title: "Deploy only what changed" },
      { path: "operations/security-rules.html", title: "Security rules" },
      { path: "operations/testing.html", title: "Testing" },
      { path: "operations/troubleshooting.html", title: "Troubleshooting" }
    ]
  },
  {
    title: "Reference",
    pages: [
      { path: "reference/npm-scripts.html", title: "npm scripts" },
      { path: "reference/config-keys.html", title: "Configuration keys" },
      { path: "reference/feature-ids.html", title: "Feature ids" },
      { path: "reference/cloud-functions.html", title: "Cloud Functions" },
      { path: "reference/email-tags.html", title: "Email merge tags" },
      { path: "reference/data-model.html", title: "Data model" },
      { path: "reference/glossary.html", title: "Glossary" }
    ]
  },
  {
    title: "Contributing",
    pages: [
      { path: "contributing/keep-core-generic.html", title: "Keep core generic" },
      { path: "contributing/frontend-notes.html", title: "Frontend notes" },
      { path: "contributing/writing-docs.html", title: "Writing docs" },
      { path: "contributing/docs-and-tests-are-part-of-done.html", title: "Docs and tests are part of done" }
    ]
  }
];
