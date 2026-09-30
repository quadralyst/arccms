# Arc CMS

<p align="center">
  <strong>Open-source, low-code content management for websites and apps, on your own Firebase project</strong>
</p>

<p align="center">
  <a href="https://github.com/quadralyst/arccms">GitHub Repository</a> &bull;
  <a href="#what-you-get">What you get</a> &bull;
  <a href="#quick-start">Quick start</a> &bull;
  <a href="#documentation">Documentation</a>
</p>

---

## Overview

Arc CMS is an open-source content management system built with **Angular 21** and **Firebase**. Use it to build a content website with search, SEO, signup forms and email, or copy it and build your own app on top of it. Everything it stores lives in your own Firebase project.

### Built with

| Layer | Technology |
|-------|-----------|
| Meta-framework | [AnalogJS](https://analogjs.org) (fullstack Angular) |
| Frontend | Angular 21, Angular Material, Bootstrap 5 |
| Backend | Firebase: Firestore, Authentication, Storage, Cloud Functions |
| Editor | TipTap 3 |
| State | NgRx Signals |
| Build and test | Vite 7, Vitest |

---

## What you get

- **Content**: your own content types with their own fields, drafts, publishing, bulk import, and plain HTML templates that decide how pages look.
- **Search and discoverability**: site search, structured data, sitemap, robots.txt, llms.txt and RSS.
- **Languages**: content and the admin area in more than one language.
- **Sign-ups and audience**: signup forms with referrals, contacts, lists, tags, and your app's users as a live audience.
- **Email and SMS**: an email engine with a brand kit and logs, broadcasts, drip sequences and automations, and text messages.
- **Accounts and payments**: email, Google and phone sign-in, roles, and checkout with premium entitlements.
- **Installable app**: an optional PWA.

Ten features can be switched on or off, so an app carries only what it needs. Everything is described in the [documentation](docs/index.html).

---

## Quick start

You need Node 22.18 or later, npm 10 or later, the Firebase CLI and a Firebase project on the Blaze plan.

```bash
git clone https://github.com/quadralyst/arccms.git
cd arccms
npm install
npm install --prefix functions
```

To build a website or an app of your own, make a copy with its own repository instead of working in the clone: see [Install](docs/getting-started/install.html).

Create the Firebase project, paste its web config into `src/environments/environment.ts` and `src/environments/environment.prod.ts`, and choose it with `firebase use --add`. Then deploy once and start the dev server:

```bash
npm run deploy
npm run dev
```

Open `http://localhost:5173`. The setup wizard creates the first admin.

The local app works against your real Firebase project: there is no emulator. Step by step, with the reasons and the traps, in [Get started](docs/getting-started/what-is-arc-cms.html).

---

## Documentation

The developer documentation is plain HTML in [`docs/`](docs/index.html). Open `docs/index.html` in a browser, or run `npm run docs` and open `http://localhost:5180`.

| Start here | For |
|------------|-----|
| [Get started](docs/getting-started/what-is-arc-cms.html) | Install, configure, run and deploy |
| [Build a website](docs/website/overview.html) | Content, templates, search, forms and launch |
| [Build a custom app](docs/app/overview.html) | Your own pages, functions and rules on a copy of Arc CMS |
| [Use Arc CMS](docs/admin/overview.html) | Running a site or an app: the admin area and what members see |
| [Features](docs/features/overview.html) | Every feature, one page each |
| [Reference](docs/reference/npm-scripts.html) | Scripts, configuration, functions, email tags and the data model |

Other files in this repository:

| Document | Description |
|----------|-------------|
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute |
| [CHANGELOG.md](CHANGELOG.md) | Version history and release notes |
| [SECURITY.md](SECURITY.md) | Security policy and how to report a vulnerability |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | Code of conduct |

`specs/` holds the working papers of the project (build specs, test plans, runbooks); the documentation is in `docs/`.

---

## Contributing

We welcome contributions. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup, branch names, pull requests and code style. Every change updates the documentation and its tests: see [Docs and tests are part of done](docs/contributing/docs-and-tests-are-part-of-done.html).

---

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

---

## Community

- Star the [GitHub repository](https://github.com/quadralyst/arccms)
- Report issues on [GitHub Issues](https://github.com/quadralyst/arccms/issues)
- Discuss with us on [GitHub Discussions](https://github.com/quadralyst/arccms/discussions)

---

<p align="center">
  Made by <a href="https://x.com/gunjankarun">Gunjan Karun</a> from <a href="https://github.com/quadralyst">Quadralyst</a>
</p>
