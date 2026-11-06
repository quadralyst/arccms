import { Routes } from '@angular/router';
import { roleGuard } from './guards/role.guard';
import { languageRedirect, languageRouteGuard } from './guards/language.guard';
import { publicContentTypeGuard } from './core/site/public-content-types';
import { memberPagesGuard, entitledGuard } from './pages/user/user.guards';
import { CUSTOM_ADMIN_ROUTES } from '../custom/admin-routes';
import { CUSTOM_ROUTES } from '../custom/routes';
import { CUSTOM_USER_DASHBOARD } from '../custom/user-dashboard';
import { FEATURE_OFF_ROUTE, whenOn } from './core/features/feature-routes';

export const routes: Routes = [
  // A feature this app turned off (src/custom/features.ts) answers every one of
  // its URLs with the not-found page, whichever route or file would serve it.
  FEATURE_OFF_ROUTE,

  // The 403 page stands alone: someone without access to the admin has no use for its
  // side menu. Listed here, so the admin shell (pages/admin.page.ts) is never drawn around it.
  {
    path: 'admin/unauthorized',
    title: 'Unauthorized',
    data: { titleKey: 'member.titles.unauthorized' },
    loadComponent: () =>
      import('./pages/admin/unauthorized.page').then((m) => m.default),
  },
  // The admin: one shell (pages/admin.page.ts, the side menu and layout) around every
  // page, so moving between pages keeps it, with the panel's scroll and open groups.
  // A page listed here shares it; a parent of its own would draw the shell again.
  // Each page has its own guard and the shell has none: a guard runs for the routes a
  // move opens, never again for the shell it stays in, and an app's admin page may let
  // in more roles than admins. A URL with no match here falls through to the routes
  // below, then the file-based pages (docs/app/pages-and-routes.html).
  {
    path: 'admin',
    loadComponent: () =>
      import('./pages/admin.page').then((m) => m.default),
    children: [
      { path: '', redirectTo: '/admin/dashboard', pathMatch: 'full' },
      {
        path: 'dashboard',
        title: 'Dashboard',
        canActivate: [roleGuard],
        data: { allowedRoles: ['admin'] },
        loadComponent: () =>
          import('./pages/admin/(dashboard)/dashboard.page').then((m) => m.default),
      },
      {
        path: 'media',
        title: 'Media Manager',
        canActivate: [roleGuard],
        data: { allowedRoles: ['admin'] },
        loadComponent: () =>
          import('./pages/admin/(media)/media.page').then((m) => m.default),
      },
      // Admin Profile Route
      {
        path: 'profile',
        title: 'Profile',
        canActivate: [roleGuard],
        data: { titleKey: 'member.titles.profile', allowedRoles: ['admin'] },
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./pages/(auth)/(profile)/profile.page').then((m) => m.default),
          },
        ],
      },
      // Admin Settings Routes
      {
        path: 'settings',
        title: 'Settings',
        canActivate: [roleGuard],
        data: { allowedRoles: ['admin'] },
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./pages/admin/(settings)/settings.page').then((m) => m.default),
            children: [
              { path: '', redirectTo: 'about', pathMatch: 'full' },
              {
                path: 'about',
                loadComponent: () =>
                  import('./pages/admin/(settings)/about/about-settings.page').then((m) => m.default),
              },
              {
                path: 'email',
                loadComponent: () =>
                  import('./pages/admin/(settings)/email-setting/email-setting.page').then((m) => m.default),
              },
              {
                path: 'integrations',
                loadComponent: () =>
                  import('./pages/admin/(settings)/integrations-setting/integrations-setting.page').then((m) => m.default),
              },
              {
                path: 'user',
                loadComponent: () =>
                  import('./pages/admin/(settings)/user-setting/user-setting.page').then((m) => m.default),
              },
              {
                path: 'sms',
                loadComponent: () =>
                  import('./pages/admin/(settings)/sms/sms-settings.page').then((m) => m.SmsSettingsPage),
              },
              {
                path: 'ai',
                loadComponent: () =>
                  import('./pages/admin/(settings)/ai/ai-settings.page').then((m) => m.AiSettingsPage),
              },
              {
                path: 'message',
                loadComponent: () =>
                  import('./pages/admin/(settings)/message/message.page').then((m) => m.default),
              },
              {
                path: 'site-usage',
                loadComponent: () =>
                  import('./pages/admin/(settings)/site-usage/site-usage.page').then((m) => m.default),
              },
              {
                path: 'analytics',
                loadComponent: () =>
                  import('./pages/admin/(settings)/analytics-setting/analytics-setting.page').then((m) => m.default),
              },
              {
                path: 'payments',
                loadComponent: () =>
                  import('./pages/admin/(settings)/payments/payments-setting.page').then((m) => m.default),
              },
              {
                path: 'localization',
                loadComponent: () =>
                  import('./pages/admin/(settings)/localization/localization-settings.page').then((m) => m.LocalizationSettingsPage),
              },
              {
                path: 'search',
                loadComponent: () =>
                  import('./pages/admin/(settings)/search/search-settings.page').then((m) => m.SearchSettingsPage),
              },
              {
                path: 'app-audience',
                loadComponent: () =>
                  import('./pages/admin/(settings)/app-audience/app-audience-settings.page').then((m) => m.AppAudienceSettingsPage),
              },
              {
                path: 'automations',
                loadComponent: () =>
                  import('./pages/admin/(settings)/automations/automations-settings.page').then((m) => m.AutomationsSettingsPage),
              },
              {
                path: 'discoverability',
                loadComponent: () =>
                  import('./pages/admin/(settings)/discoverability/discoverability-settings.page').then((m) => m.DiscoverabilitySettingsPage),
              },
              {
                path: 'misc',
                loadComponent: () =>
                  import('./pages/admin/(settings)/misc/misc-settings.page').then((m) => m.MiscSettingsPage),
              },
            ],
          },
        ],
      },
      // Admin Data Routes
      {
        path: 'data',
        title: 'Data',
        canActivate: [roleGuard],
        data: { allowedRoles: ['admin'] },
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./pages/admin/(data)/data.page').then((m) => m.default),
            children: [
              { path: '', redirectTo: 'export-data', pathMatch: 'full' },
              {
                path: 'export-data',
                loadComponent: () =>
                  import('./pages/admin/(data)/export-data/export-data.page').then((m) => m.default),
              },
              {
                path: 'import-data',
                loadComponent: () =>
                  import('./pages/admin/(data)/import-data/import-data.page').then((m) => m.default),
              },
              {
                path: 'export-files',
                loadComponent: () =>
                  import('./pages/admin/(data)/export-files/export-files.page').then((m) => m.default),
              },
              {
                path: 'import-files',
                loadComponent: () =>
                  import('./pages/admin/(data)/import-files/import-files.page').then((m) => m.default),
              },
            ],
          },
        ],
      },
      // Admin Waitlist Routes (Angular router-based for admin area)
      {
        path: 'waitlists',
        title: 'Signup Forms',
        canActivate: [roleGuard],
        data: { allowedRoles: ['admin'] },
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./pages/admin/(waitlists)/waitlists.page').then((m) => m.default),
          },
          {
            path: 'dashboard/:waitlistId',
            loadComponent: () =>
              import('./pages/admin/(waitlists)/dashboard/waitlist-dashboard.component').then((m) => m.default),
          },
          {
            path: 'templates/:waitlistId',
            loadComponent: () =>
              import('./pages/admin/(waitlists)/templates/templates.page').then((m) => m.default),
          },
          {
            path: 'users/:waitlistId',
            loadComponent: () =>
              import('./pages/admin/(waitlists)/joined-users/joined-users.page').then((m) => m.default),
          },
          {
            path: 'tags',
            loadComponent: () =>
              import('./pages/admin/(waitlists)/tags/tags.page').then((m) => m.default),
          },
        ],
      },
      {
        path: 'contacts',
        title: 'Contacts',
        canActivate: [roleGuard],
        data: { allowedRoles: ['admin'] },
        loadComponent: () =>
          import('./pages/admin/(contacts)/contacts.page').then((m) => m.default),
      },
      {
        path: 'lists',
        title: 'Lists',
        canActivate: [roleGuard],
        data: { allowedRoles: ['admin'] },
        loadComponent: () =>
          import('./pages/admin/(lists)/lists.page').then((m) => m.default),
      },
      // Admin List hub (U4): one workspace per list: Members, Broadcasts, Sequence.
      {
        path: 'lists/:listId',
        title: 'List',
        canActivate: [roleGuard],
        data: { allowedRoles: ['admin'] },
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./pages/admin/(list-hub)/list-hub.page').then((m) => m.default),
          },
        ],
      },
      // The contents folder holds only pages below it (content types, a type's
      // entries), so the bare /admin/contents would open an empty page.
      { path: 'contents', redirectTo: '/admin/contents/content-types', pathMatch: 'full' },
      {
        path: 'contents/content-types',
        title: 'Content Types',
        canActivate: [roleGuard],
        data: { allowedRoles: ['admin'] },
        loadComponent: () =>
          import('./pages/admin/contents/content-types/index.page').then((m) => m.default),
      },
      {
        path: 'contents/content-types/add',
        title: 'Add Content Type',
        canActivate: [roleGuard],
        data: { allowedRoles: ['admin'] },
        loadComponent: () =>
          import('./pages/admin/contents/content-types/(add-content-type)/add.page').then((m) => m.default),
      },
      {
        path: 'contents/content-types/edit/:contentTypeId',
        title: 'Edit Content Type',
        canActivate: [roleGuard],
        data: { allowedRoles: ['admin'] },
        loadComponent: () =>
          import('./pages/admin/contents/content-types/(edit-content-type)/edit.[contentTypeId].page').then((m) => m.default),
      },
      {
        path: 'contents/content-types/tags',
        title: 'Tags Management',
        canActivate: [roleGuard],
        data: { allowedRoles: ['admin'] },
        loadComponent: () =>
          import('./pages/admin/contents/content-types/tags/index.page').then((m) => m.default),
      },
      {
        path: 'contents/content-types/tags/add',
        canActivate: [roleGuard],
        data: { allowedRoles: ['admin'] },
        loadComponent: () =>
          import('./pages/admin/contents/content-types/tags/(add-tag)/add.page').then((m) => m.default),
      },
      {
        path: 'contents/content-types/tags/edit/:tagId',
        canActivate: [roleGuard],
        data: { allowedRoles: ['admin'] },
        loadComponent: () =>
          import('./pages/admin/contents/content-types/tags/(edit-tag)/edit.[tagId].page').then((m) => m.default),
      },
      {
        path: 'contents/:slug',
        title: 'Contents List',
        canActivate: [roleGuard],
        data: { allowedRoles: ['admin'] },
        loadComponent: () =>
          import('./pages/admin/contents/[slug]/index.page').then((m) => m.default),
      },
      {
        path: 'contents/:slug/add',
        title: 'Add Content',
        canActivate: [roleGuard],
        data: { allowedRoles: ['admin'] },
        loadComponent: () =>
          import('./pages/admin/contents/[slug]/add.page').then((m) => m.default),
      },
      {
        path: 'contents/:slug/edit/:contentId',
        title: 'Edit Content',
        canActivate: [roleGuard],
        data: { allowedRoles: ['admin'] },
        loadComponent: () =>
          import('./pages/admin/contents/[slug]/edit.[contentId].page').then((m) => m.default),
      },
      // Admin Authors route (specs/discoverability-spec.md, D2). Explicit like
      // every other admin feature route.
      {
        path: 'authors',
        title: 'Authors',
        canActivate: [roleGuard],
        data: { allowedRoles: ['admin'] },
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./pages/admin/(authors)/authors.page').then((m) => m.default),
          },
        ],
      },
      // Admin Audience Route (custom Fields, U4.5).
      {
        path: 'contact-fields',
        title: 'Contact Fields',
        canActivate: [roleGuard],
        data: { allowedRoles: ['admin'] },
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./pages/admin/(contact-fields)/contact-fields.page').then((m) => m.default),
          },
        ],
      },
      // Admin Audience Route (App users, CO6.3): the host app's users, read live.
      {
        path: 'app-users',
        title: 'App Users',
        canActivate: [roleGuard],
        data: { allowedRoles: ['admin'] },
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./pages/admin/(app-users)/app-users.page').then((m) => m.default),
          },
        ],
      },
      // Admin Audience Route (Tags). Declared explicitly like every other admin
      // feature route rather than relying on file-based routing, which resolves
      // server-side but does not reliably reach the client route table here — the
      // page then falls through to the public `:contentTypeSlug/:urlSlug` route and
      // renders "Content Not Found" in the public shell.
      {
        path: 'contact-tags',
        title: 'Contact Tags',
        canActivate: [roleGuard],
        data: { allowedRoles: ['admin'] },
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./pages/admin/(contact-tags)/contact-tags.page').then((m) => m.default),
          },
        ],
      },
      // Admin search results (specs/search-spec.md, S4). Explicit like every
      // other admin route.
      {
        path: 'search',
        title: 'Search',
        canActivate: [roleGuard],
        data: { allowedRoles: ['admin'] },
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./pages/admin/(search)/search.page').then((m) => m.default),
          },
        ],
      },
      // Admin Email Logs Route
      {
        path: 'email-logs',
        title: 'Email Logs',
        canActivate: [roleGuard],
        data: { allowedRoles: ['admin'] },
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./pages/admin/(email-logs)/email-logs.page').then((m) => m.default),
          },
        ],
      },
      // Admin Feedback: what people sent with the feedback button (docs/features/feedback.html).
      {
        path: 'feedback',
        title: 'Feedback',
        canActivate: [roleGuard],
        data: { allowedRoles: ['admin'] },
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./pages/admin/(feedback)/feedback.page').then((m) => m.default),
          },
        ],
      },
      // Admin Messages: what people sent with the site's contact form (specs/site-sections-spec.md, SS5).
      {
        path: 'messages',
        title: 'Messages',
        canActivate: [roleGuard],
        data: { allowedRoles: ['admin'] },
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./pages/admin/(messages)/messages.page').then((m) => m.default),
          },
        ],
      },
      // Admin SMS Logs Route (Email + SMS menu): every text message, like Email Logs.
      {
        path: 'sms-logs',
        title: 'SMS Logs',
        canActivate: [roleGuard],
        data: { allowedRoles: ['admin'] },
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./pages/admin/(sms-logs)/sms-logs.page').then((m) => m.default),
          },
        ],
      },
      // Admin Email Routes (Brand Kit, Composer, Broadcasts, Drip Campaigns, Announcements)
      // Nested under a shared /admin/email/* prefix so the sidebar's Email submenu
      // maps to real, matching routes instead of scattered top-level paths.
      {
        path: 'email',
        title: 'Email',
        canActivate: [roleGuard],
        data: { allowedRoles: ['admin'] },
        children: [
          { path: '', redirectTo: 'brand-kit', pathMatch: 'full' },
          {
            path: 'brand-kit',
            title: 'Brand Kit',
            loadComponent: () =>
              import('./pages/admin/(email-brand)/brand-kit.page').then((m) => m.default),
          },
          {
            path: 'composer',
            title: 'Composer',
            loadComponent: () =>
              import('./pages/admin/(email-composer)/email-composer.page').then((m) => m.default),
          },
          {
            path: 'broadcasts',
            title: 'Broadcasts',
            loadComponent: () =>
              import('./pages/admin/(broadcasts)/broadcasts.page').then((m) => m.default),
          },
          {
            path: 'drip-campaigns',
            title: 'Drip Campaigns',
            loadComponent: () =>
              import('./pages/admin/(drips)/drips.page').then((m) => m.default),
          },
          {
            path: 'announcements',
            title: 'Announcements',
            loadComponent: () =>
              import('./pages/admin/(announcements)/announcements.page').then((m) => m.default),
          },
        ],
      },
      // Admin Users Routes (router-based for admin area)
      {
        path: 'users',
        title: 'Users',
        canActivate: [roleGuard],
        data: { allowedRoles: ['admin'] },
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./pages/admin/users/index.page').then((m) => m.default),
          },
          {
            path: 'add',
            title: 'Add User',
            loadComponent: () =>
              import('./pages/admin/users/(add-user)/add.page').then((m) => m.default),
          },
          {
            path: 'edit/:userId',
            title: 'Edit User',
            loadComponent: () =>
              import('./pages/admin/users/(edit-user)/edit.[userId].page').then((m) => m.default),
          },
          {
            path: 'view/:userId',
            title: 'View User',
            loadComponent: () =>
              import('./pages/admin/users/(view-user)/view.[userId].page').then((m) => m.default),
          },
          {
            path: ':role',
            loadComponent: () =>
              import('./pages/admin/users/[role]/index.page').then((m) => m.default),
          },
        ],
      },
      // Admin Products Routes
      {
        path: 'products',
        title: 'Products',
        canActivate: [roleGuard],
        data: { allowedRoles: ['admin'] },
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./pages/admin/(products)/products.page').then((m) => m.default),
          },
        ],
      },
      // Admin Transactions Routes
      {
        path: 'transactions',
        title: 'Transactions',
        canActivate: [roleGuard],
        data: { allowedRoles: ['admin'] },
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./pages/admin/(transactions)/transactions.page').then((m) => m.default),
          },
        ],
      },
      // Admin Notifications Route (nests under the admin shell for the sidebar;
      // the same page component also renders standalone at /notifications for
      // signed-in members, self-wrapping in the user shell there).
      {
        path: 'notifications',
        title: 'Notifications',
        canActivate: [roleGuard],
        data: { titleKey: 'member.titles.notifications', allowedRoles: ['admin'] },
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./pages/(notifications)/notifications.page').then((m) => m.default),
          },
        ],
      },
      // The app's own admin pages (src/custom/admin-routes.ts). After every core page, so
      // an app page never replaces a core one by accident.
      ...CUSTOM_ADMIN_ROUTES,
    ],
  },

  // Onboarding Wizard (first-run setup)
  {
    path: 'onboarding',
    title: 'Setup',
    loadComponent: () =>
      import('./pages/(onboarding)/onboarding.page').then((m) => m.default),
  },

  // Waitlist Routes
  {
    path: 'waitlist',
    loadComponent: () =>
      import('./pages/waitlist/waitlist.component').then((m) => m.WaitlistComponent),
  },
  {
    path: 'waitlist/:waitlistId',
    loadComponent: () =>
      import('./pages/waitlist/waitlist.component').then((m) => m.WaitlistComponent),
  },
  // Signup forms have no leaderboard or member page any more (specs/form-gamification-spec.md).
  // Their links in emails already sent open the form, where the person sees they are on the list.
  { path: 'leaderboard', redirectTo: '', pathMatch: 'full' },
  { path: 'leaderboard/:waitlistId', redirectTo: 'waitlist/:waitlistId', pathMatch: 'full' },
  { path: 'leaderboard/:waitlistId/:memberId', redirectTo: 'waitlist/:waitlistId', pathMatch: 'full' },
  // Any three-segment /user URL fits, so it goes when signup forms are off.
  ...whenOn('forms', [{ path: 'user/:waitlistId/:userId', redirectTo: 'waitlist/:waitlistId', pathMatch: 'full' }]),
  {
    path: 'unsubscribe/:userId',
    loadComponent: () =>
      import('./pages/waitlist/unsubscribe-handling/unsubscribe-handling.component').then((m) => m.UnsubscribeHandlingComponent),
  },
  {
    path: 'unsubscribe/:waitlistId/:userId',
    loadComponent: () =>
      import('./pages/waitlist/unsubscribe-handling/unsubscribe-handling.component').then((m) => m.UnsubscribeHandlingComponent),
  },

  // The member's home: a blank core page, or the app's own (src/custom/user-dashboard.ts).
  {
    path: 'user/dashboard',
    title: 'Dashboard',
    data: { titleKey: 'member.titles.dashboard' },
    canActivate: [memberPagesGuard],
    loadComponent: CUSTOM_USER_DASHBOARD
      ?? (() => import('./pages/user/(dashboard)/dashboard.page').then((m) => m.default)),
  },

  // Member profile (rendered in the user shell, not the admin shell)
  {
    path: 'user/profile',
    title: 'Profile',
    data: { titleKey: 'member.titles.profile' },
    canActivate: [memberPagesGuard],
    loadComponent: () =>
      import('./pages/user/profile/user-profile.page').then((m) => m.default),
  },

  // Public Pricing Page (logged-in users purchase from here)
  {
    path: 'pricing',
    title: 'Pricing',
    loadComponent: () =>
      import('./pages/pricing/pricing.page').then((m) => m.default),
  },

  // Member account / billing (sign-in required)
  {
    path: 'account',
    title: 'Account',
    data: { titleKey: 'member.titles.account' },
    canActivate: [memberPagesGuard],
    loadComponent: () =>
      import('./pages/account/account.page').then((m) => m.default),
  },
  // The member's plan, credits and recent activity (the payments feature).
  ...whenOn('payments', [{
    path: 'user/payments',
    title: 'Payments',
    data: { titleKey: 'member.titles.payments' },
    canActivate: [memberPagesGuard],
    loadComponent: () =>
      import('./pages/user/payments/payments.page').then((m) => m.default),
  }]),
  // Members-only premium area (paid entitlement required)
  {
    path: 'user/premium',
    title: 'Premium',
    data: { titleKey: 'member.titles.premium' },
    canActivate: [memberPagesGuard, entitledGuard],
    loadComponent: () =>
      import('./pages/user/premium/premium.page').then((m) => m.default),
  },
  // Public payment test screens
  {
    path: 'checkout/success',
    loadComponent: () =>
      import('./pages/checkout-success/checkout-success.page').then((m) => m.default),
  },
  {
    path: 'checkout/cancel',
    loadComponent: () =>
      import('./pages/checkout-cancel/checkout-cancel.page').then((m) => m.default),
  },

  // Dynamic Public Pages - must be before 404
  {
    path: 'p/:fileName',
    loadComponent: () =>
      import('./pages/public-page-renderer/public-page-renderer.component').then((m) => m.PublicPageRendererComponent),
  },

  // The home page in another language, /{lang}: the same page as '/', which
  // renders the site's home.{lang}.html or home.html in that language
  // (specs/own-website-spec.md, W4). Published sites serve the static
  // /{lang}/index.html instead; this is the preview and the fallback. Listed
  // before the language content routes so the single-segment path wins.
  {
    path: ':lang',
    pathMatch: 'full',
    canMatch: [languageRouteGuard],
    loadComponent: () => import('./pages/index.page').then((m) => m.default),
  },

  // Translated public content: /{lang}/{contentTypeSlug}[/{urlSlug}].
  //
  // Published pages are served as static HTML straight from Hosting; these
  // routes are the SPA fallback that renders drafts, previews, and anything
  // not yet deployed — the same role the unprefixed content routes play.
  //
  // `canMatch` is what makes a wildcard first segment safe: a URL like
  // /admin/settings/localization has the right shape but 'admin' is not a
  // language, so the route is skipped rather than matched-and-broken.
  // Search results (specs/search-spec.md, S-D18). The default language's
  // /search is the file-based src/app/pages/search.page.ts; this is its
  // /{lang}/search twin, listed before the two-segment content route so a
  // language prefix plus 'search' is never read as a content type.
  // These fit any URL of their length, so a feature that is off leaves them out.
  ...whenOn('search', [{
    path: ':lang/search',
    canMatch: [languageRouteGuard],
    loadComponent: () =>
      import('./pages/search.page').then((m) => m.default),
  }]),
  ...whenOn('content', [{
    path: ':lang/:contentTypeSlug/:urlSlug',
    canMatch: [languageRouteGuard, publicContentTypeGuard],
    loadComponent: () =>
      import('./pages/page.parts/content-detail.component').then((m) => m.ContentDetailComponent),
  },
  {
    path: ':lang/:contentTypeSlug',
    canMatch: [languageRouteGuard, publicContentTypeGuard],
    loadComponent: () =>
      import('./pages/page.parts/content-list.component').then((m) => m.ContentListComponent),
  }]),

  // Any other address under a language prefix exists once, without it: /hi/signup
  // is /signup. Links are written that way (isLocalizedPath); this catches the rest.
  languageRedirect,

  // The app's own routes (src/custom/routes.ts, docs/app/custom-space.html). After every
  // core route, so an app page never replaces a core one by accident; still
  // ahead of the file-based pages, which Analog adds after these.
  ...CUSTOM_ROUTES,
];
