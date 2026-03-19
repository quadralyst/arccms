# Architecture Overview

High-level overview of the Arc CMS codebase for contributors and maintainers.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Meta-Framework | [AnalogJS](https://analogjs.org) 2.1.3 |
| Frontend | Angular 21, Angular Material, Bootstrap 5 |
| State Management | NgRx Signals |
| Rich Text Editor | TipTap 3 (Prosemirror) |
| Build Tool | Vite 7 |
| Backend | Firebase (Firestore, Auth, Storage, Cloud Functions) |
| Cloud Functions Runtime | Node.js 22 |
| Testing | Vitest |
| AI Integration | Google Vertex AI |

---

## Project Structure

```
arccms/
├── src/                          # Frontend application
│   ├── app/
│   │   ├── pages/                # File-based routing (AnalogJS)
│   │   │   ├── admin/            # Admin dashboard pages
│   │   │   │   ├── contents/     # Content type & item management
│   │   │   │   ├── users/        # User management
│   │   │   │   ├── (waitlists)/  # Waitlist management
│   │   │   │   ├── (settings)/   # Settings (email, analytics, etc.)
│   │   │   │   ├── (media)/      # Media library
│   │   │   │   └── (analytics)/  # Analytics dashboard
│   │   │   ├── (auth)/           # Login, signup, onboarding
│   │   │   ├── user/             # User profile pages
│   │   │   └── waitlist/         # Public waitlist pages
│   │   ├── app.ts                # Root component
│   │   └── app.routes.ts         # Route definitions
│   ├── shared/
│   │   ├── components/           # Reusable UI components
│   │   ├── services/             # Core services (auth, db, file upload)
│   │   ├── models/               # TypeScript interfaces
│   │   ├── stores/               # NgRx Signal stores
│   │   └── constants/            # App constants
│   ├── environments/             # Environment configs (dev/prod)
│   └── assets/                   # Static assets bundled by Vite
├── functions/                    # Firebase Cloud Functions
│   └── src/
│       ├── index.ts              # Function exports
│       ├── users/                # User lifecycle triggers
│       ├── waitlists/            # Waitlist event handlers
│       ├── emails/               # Email operations
│       ├── pages/                # Content publishing & hosting
│       ├── analytics/            # Google Analytics integration
│       ├── shared/               # Shared utilities
│       └── __tests__/            # Function tests
├── public/                       # Static public files
│   ├── templates/                # Content type HTML templates
│   ├── _partials/                # Global header/footer
│   ├── pages/                    # Static HTML pages
│   └── assets/                   # Public CSS, images
├── firebase.json                 # Firebase services config
├── firestore.rules               # Firestore security rules
├── firestore.indexes.json        # Firestore composite indexes
├── storage.rules                 # Cloud Storage security rules
├── angular.json                  # Angular/AnalogJS config
├── vite.config.ts                # Vite build config
└── vitest.config.ts              # Test config
```

---

## Frontend Architecture

### Routing

Arc CMS uses AnalogJS file-based routing. Pages in `src/app/pages/` automatically map to routes. Parenthesized directory names (e.g., `(auth)`, `(settings)`) create optional route segments.

Key routes:
- `/` — Home page
- `/onboarding` — First-run setup wizard
- `/admin/dashboard` — Admin dashboard
- `/admin/contents` — Content management
- `/admin/users` — User management
- `/admin/waitlists` — Waitlist management
- `/admin/settings/*` — Various settings pages
- `/waitlist` — Public waitlist signup
- `/leaderboard` — Public leaderboard
- `/p/:fileName` — Dynamic static pages

### Services

| Service | Purpose |
|---------|---------|
| `AuthService` | Authentication, first-run detection |
| `DbService` | Firestore CRUD operations |
| `FileUploadService` | Cloud Storage file uploads |
| `GenericStoreService` | Reusable NgRx Signal store |
| `ApiService` | Cloud Functions HTTP calls |

### State Management

NgRx Signal stores are used for reactive state. The `GenericStoreService` provides a reusable pattern for CRUD operations with Firestore collections.

### Component Patterns

- **Standalone components** — Angular 21 standalone component style
- **Base component** — Shared functionality (routing, forms, validation) via inheritance
- **Global table** — Configuration-driven table component for admin pages

---

## Backend Architecture (Cloud Functions)

Cloud Functions are organized by domain and triggered by Firestore events or HTTP calls.

### Function Categories

| Category | Trigger Type | Purpose |
|----------|-------------|---------|
| **User Lifecycle** | Firestore `onDocumentCreated/Deleted` | Create/delete Auth accounts, sync roles |
| **Content Publishing** | Firestore `onDocumentCreated` | Render templates to Firebase Hosting |
| **Waitlist** | Firestore triggers | Manage signups, referrals, counters |
| **Email** | Firestore triggers + HTTP | Send emails, track opens, process broadcasts |
| **Analytics** | HTTP callable | Connect/query Google Analytics |
| **Integrations** | HTTP callable | Unsplash image search proxy |

### Content Publishing Pipeline

1. Admin publishes content in the dashboard
2. A document is written to the `_publish_queue` collection
3. `processPublishQueue` Cloud Function triggers
4. Function loads the HTML template from `public/templates/`
5. Template is hydrated with content data (replacing `data-arc-bind` attributes)
6. Rendered HTML is deployed to Firebase Hosting via the Hosting API

---

## Firestore Data Model

### Core Collections

| Collection | Purpose |
|-----------|---------|
| `ContentTypes` | Content type definitions (fields, template, slug) |
| `arc_{slug}` | Published content items (dynamic per content type) |
| `arc_{slug}_drafts` | Draft content items |
| `Tags_{slug}` | Tags for each content type |
| `users` | User profiles and roles |
| `email_lookup` | Email-to-user mapping (used for first-run detection) |
| `Settings` | App configuration documents |

### Waitlist Collections

| Collection | Purpose |
|-----------|---------|
| `Waitlists` | Waitlist definitions |
| `Waitlists/{id}/users` | Waitlist signups (subcollection) |
| `WaitlistedUsers` | Global user registry |
| `WaitlistedUsers/{id}/referrals` | Referral tracking (subcollection) |

### Internal Collections

| Collection | Purpose |
|-----------|---------|
| `_publish_queue` | Triggers content publishing pipeline |
| `_broadcast_continue` | Resumes interrupted email broadcasts |
| `_email_counters` | Rate limiting for email sends |
| `EmailTemplate` | Email templates |
| `BroadcastEmails` | Broadcast campaign records |
| `EmailLogs` | Email send history |

### Settings Documents

The `Settings` collection uses document IDs as keys:

| Document ID | Purpose |
|------------|---------|
| `email` | Email provider configuration |
| `email_status` | Email service status |
| `onboarding_status` | Onboarding completion state |
| `site-usage` | Site usage preferences |
| `misc` | Miscellaneous settings |
| `cache` | Cache configuration |
| `global-message` | Global banner content |
| `users` | User signup/role settings |

---

## Security Model

### Firestore Rules

- **Public read**: Content collections (`arc_*`), content types, media, tags
- **Authenticated read**: User profiles, admin collections
- **Owner/Admin write**: Users can edit their own profile; admins can edit all
- **Functions-only write**: Internal collections (`_publish_queue`, `_broadcast_continue`, `_email_counters`)

### Storage Rules

- **Public read**: All files (needed for images on public pages and SSR)
- **Authenticated write**: Only logged-in users can upload

### Authentication

- Email/password via Firebase Auth
- Custom claims for role-based access (`admin`, `user`)
- `syncUserRole` Cloud Function keeps Firestore roles and Auth custom claims in sync

---

## Build & Deployment

### Development

```bash
npm run dev          # Vite dev server on localhost:5173
npm run test         # Vitest (all tests)
```

### Production Build

```bash
npm run build        # Vite builds Angular app + copies shell for SPA fallback
```

Output:
- `dist/analog/public` — Static files for Firebase Hosting
- `dist/analog/server` — SSR assets

### Deployment

```bash
npm run deploy:dev   # Build + deploy to dev project + seed static pages
npm run deploy:prod  # Build + deploy to production project + seed static pages
```

The deployment process:
1. Vite builds the Angular app with AnalogJS plugin
2. SSG prerenders the `/` route
3. SPA fallback via `__shell.html` for client-side routing
4. Cloud Functions compiled from TypeScript
5. Firebase CLI deploys hosting, functions, rules, and indexes
