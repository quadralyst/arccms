import { Routes } from '@angular/router';
import { roleGuard } from './guards/role.guard';

export const routes: Routes = [
  // AnalogJS file-based routes handle /admin/* automatically via .page.ts files
  // This is just a fallback redirect for /admin to /admin/dashboard
  {
    path: 'admin',
    redirectTo: '/admin/dashboard',
    pathMatch: 'full'
  },

  // Onboarding Wizard (first-run setup)
  {
    path: 'onboarding',
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
  {
    path: 'leaderboard',
    loadComponent: () =>
      import('./pages/waitlist/leaderboard/leaderboard.component').then((m) => m.LeaderboardComponent),
  },
  {
    path: 'leaderboard/:waitlistId',
    loadComponent: () =>
      import('./pages/waitlist/leaderboard/leaderboard.component').then((m) => m.LeaderboardComponent),
  },
  {
    path: 'leaderboard/:waitlistId/:waitlisteduserid',
    loadComponent: () =>
      import('./pages/waitlist/leaderboard/leaderboard.component').then((m) => m.LeaderboardComponent),
  },
  {
    path: 'user/:waitlistId/:userId',
    loadComponent: () =>
      import('./pages/waitlist/user-details/user-details.component').then((m) => m.UserDetailsComponent),
  },
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
  // Admin Profile Route
  {
    path: 'admin/profile',
    loadComponent: () =>
      import('./pages/admin.page').then((m) => m.default),
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
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
    path: 'admin/settings',
    loadComponent: () =>
      import('./pages/admin.page').then((m) => m.default),
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
    path: 'admin/data',
    loadComponent: () =>
      import('./pages/admin.page').then((m) => m.default),
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

  {
    path: 'user/profile',
    loadComponent: () =>
      import('./pages/admin.page').then((m) => m.default),
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin', 'user'] },
    children: [
      {
        path: '',
        loadComponent: () => import('./pages/(auth)/(profile)/profile.page').then((m) => m.default),
      }
    ]
  },
  // Admin Waitlist Routes (Angular router-based for admin area)
  {
    path: 'admin/waitlists',
    loadComponent: () =>
      import('./pages/admin.page').then((m) => m.default),
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
      {
        path: 'subscribers',
        loadComponent: () =>
          import('./pages/admin/(waitlists)/subscribers/subscribers.page').then((m) => m.default),
      },
    ],
  },
  // Admin Email Logs Route
  {
    path: 'admin/email-logs',
    loadComponent: () =>
      import('./pages/admin.page').then((m) => m.default),
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
  // Admin Users Routes (router-based for admin area)
  {
    path: 'admin/users',
    loadComponent: () =>
      import('./pages/admin.page').then((m) => m.default),
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
        loadComponent: () =>
          import('./pages/admin/users/(add-user)/add.page').then((m) => m.default),
      },
      {
        path: 'edit/:userId',
        loadComponent: () =>
          import('./pages/admin/users/(edit-user)/edit.[userId].page').then((m) => m.default),
      },
      {
        path: 'view/:userId',
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
    path: 'admin/products',
    loadComponent: () =>
      import('./pages/admin.page').then((m) => m.default),
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
    path: 'admin/transactions',
    loadComponent: () =>
      import('./pages/admin.page').then((m) => m.default),
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
  // Public Pricing Page (logged-in users purchase from here)
  {
    path: 'pricing',
    loadComponent: () =>
      import('./pages/pricing/pricing.page').then((m) => m.default),
  },

  // Dynamic Public Pages - must be before 404
  {
    path: 'p/:fileName',
    loadComponent: () =>
      import('./pages/public-page-renderer/public-page-renderer.component').then((m) => m.PublicPageRendererComponent),
  },

];
