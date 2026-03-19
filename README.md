# Arc CMS

<p align="center">
  <strong>Open-Source, Low-Code Content Management System for Scalable Startup Websites</strong>
</p>

<p align="center">
  <a href="https://github.com/quadralyst/arccms">GitHub Repository</a> &bull;
  <a href="#features">Features</a> &bull;
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#documentation">Documentation</a>
</p>

---

## Overview

Arc CMS is a modern, open-source content management system built with **Angular 21** and **Firebase**. It provides a low-code solution for startups and developers who need a scalable website with powerful content management, waitlist/signup management, and customizable templates — all without the complexity of traditional CMS platforms.

### Built With

| Layer | Technology |
|-------|-----------|
| Meta-Framework | [AnalogJS](https://analogjs.org) 2.1.3 (fullstack Angular) |
| Frontend | Angular 21, Angular Material, Bootstrap 5 |
| Backend | Firebase (Firestore, Auth, Storage, Cloud Functions) |
| Editor | TipTap 3 with Prosemirror |
| State Management | NgRx Signals |
| Build Tool | Vite 7 |
| Testing | Vitest |

---

## Features

### Content Management
- **Dynamic Content Types** — Create custom content types (articles, manuals, products, etc.) with configurable fields
- **Rich Text Editor** — Full-featured TipTap editor with code blocks, tables, images, links, and more
- **Custom Fields** — Add text, textarea, dropdown, checkbox, and number fields to any content type
- **Template System** — Create custom HTML templates for list, detail, and partial views
- **SEO Optimization** — Built-in meta tags, Open Graph, and Twitter cards support
- **Draft/Publish Workflow** — Manage content lifecycle with draft and publish states
- **Tags & Categories** — Organize content with multiple tags and color-coded labels

### Waitlist Management
- **Signup Forms** — Embeddable waitlist forms with referral tracking
- **Leaderboard** — Display waitlist rankings with masked email privacy
- **Email Workflows** — Welcome emails, OTP verification, and broadcast messaging
- **Unsubscribe Handling** — Built-in unsubscribe with user-friendly flow

### User Management
- **Role-based Access** — Admin and User roles with protected routes
- **Firebase Authentication** — Email/password authentication with email verification
- **User Settings** — Configure signup permissions and default roles

### Admin Settings
- **Email Configuration** — Modular email provider support (SMTP, Gmail, Resend)
- **Global Banner** — Configurable site-wide announcement banner
- **Cookie Consent** — GDPR-compliant cookie consent banner
- **Analytics Integration** — Google Analytics connection and dashboard
- **Media Library** — Image upload and management with Unsplash integration

### Template System
Arc CMS uses a template hydration system — write plain HTML/CSS templates and Arc CMS injects your content:

```
public/templates/
├── articles/          # Template folder for a content type
│   ├── list.html      # List/grid page
│   ├── detail.html    # Single item page
│   └── partials.html  # Embeddable card sections
└── templates.json     # Template registry
```

See [TEMPLATES.md](TEMPLATES.md) for the complete customization guide.

---

## Quick Start

### Prerequisites
- Node.js >= 20.19.1
- npm >= 10.0.0
- Firebase CLI (`npm install -g firebase-tools`)
- A Firebase project with Firestore, Authentication, and Storage enabled

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/quadralyst/arccms.git
   cd arccms
   ```

2. **Install dependencies:**
   ```bash
   npm install
   cd functions && npm install && cd ..
   ```

3. **Configure environment:**
   ```bash
   cp src/environments/environment.example.ts src/environments/environment.ts
   ```
   Edit `src/environments/environment.ts` and add your Firebase project config.

4. **Start the development server:**
   ```bash
   npm run dev
   ```
   Navigate to `http://localhost:5173/`. The onboarding wizard will guide you through initial setup.

For detailed setup instructions, see [INSTALL.md](INSTALL.md).

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run test` | Run unit tests with Vitest |
| `npm run deploy:dev` | Build and deploy to development project |
| `npm run deploy:prod` | Build and deploy to production project |

---

## Project Structure

```
arccms/
├── src/
│   ├── app/
│   │   ├── pages/                # File-based routing (AnalogJS)
│   │   │   ├── admin/            # Admin dashboard pages
│   │   │   ├── (auth)/           # Authentication pages
│   │   │   ├── user/             # User dashboard
│   │   │   └── waitlist/         # Public waitlist pages
│   │   ├── app.ts                # Root component
│   │   └── app.routes.ts         # Route definitions
│   ├── shared/
│   │   ├── components/           # Reusable UI components
│   │   ├── services/             # Core services
│   │   ├── models/               # TypeScript interfaces
│   │   └── stores/               # NgRx Signal stores
│   └── environments/             # Environment configs
├── functions/                    # Firebase Cloud Functions
├── public/
│   ├── templates/                # Custom HTML templates
│   ├── pages/                    # Static HTML pages
│   └── _partials/                # Global header/footer
├── firebase.json                 # Firebase configuration
├── firestore.rules               # Firestore security rules
└── storage.rules                 # Cloud Storage security rules
```

For a detailed architecture overview, see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Documentation

| Document | Description |
|----------|-------------|
| [INSTALL.md](INSTALL.md) | Detailed installation and deployment guide |
| [TEMPLATES.md](TEMPLATES.md) | Template customization and creation guide |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Codebase architecture and data model |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contribution guidelines |
| [CHANGELOG.md](CHANGELOG.md) | Version history and release notes |
| [SECURITY.md](SECURITY.md) | Security policy and vulnerability reporting |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | Contributor Code of Conduct |
| [Global Table README](src/shared/components/global-table/README.md) | Configuration-driven table component |

---

## Deployment

### Firebase Hosting

1. Build the project:
   ```bash
   npm run build
   ```

2. Build Cloud Functions:
   ```bash
   cd functions && npm run build && cd ..
   ```

3. Deploy:
   ```bash
   firebase deploy
   ```

See [INSTALL.md](INSTALL.md) for detailed deployment instructions.

---

## Contributing

We welcome contributions! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on:

- Setting up your development environment
- Branch naming conventions
- Submitting pull requests
- Code style expectations

---

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

---

## Community

- Star the [GitHub Repository](https://github.com/quadralyst/arccms)
- Report issues on [GitHub Issues](https://github.com/quadralyst/arccms/issues)
- Discuss with us at [GitHub Discussions](https://github.com/quadralyst/arccms/discussions)

---

<p align="center">
  Made by <a href="https://x.com/gunjankarun">Gunjan Karun</a> from <a href="https://github.com/quadralyst">Quadralyst</a>
</p>
