# Contributing to Arc CMS

Thank you for your interest in contributing to Arc CMS! This document provides guidelines and instructions for contributing.

---

## Getting Started

1. **Fork** the repository on GitHub
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/your-username/arccms.git
   cd arccms
   ```
3. **Install dependencies:**
   ```bash
   npm install
   cd functions && npm install && cd ..
   ```
4. **Set up your environment** — See [INSTALL.md](INSTALL.md) for detailed setup instructions

---

## Development Workflow

### Branch Naming

Create a branch from `main` using this naming convention:

| Prefix | Use Case | Example |
|--------|----------|---------|
| `feat/` | New features | `feat/dark-mode` |
| `fix/` | Bug fixes | `fix/login-redirect` |
| `docs/` | Documentation changes | `docs/api-guide` |
| `refactor/` | Code refactoring | `refactor/auth-service` |
| `test/` | Adding or updating tests | `test/waitlist-service` |

```bash
git checkout -b feat/your-feature-name
```

### Making Changes

1. Make your changes in small, focused commits
2. Follow the existing code style and patterns
3. Add or update tests for your changes
4. Ensure all tests pass before submitting

### Running Tests

```bash
# Run all tests (frontend + functions)
npm run test
```

> **Note:** All tests run from the project root using Vitest. The `functions/` directory does not have its own test script.

### Running the Dev Server

```bash
npm run dev
```

---

## Submitting a Pull Request

1. **Push** your branch to your fork:
   ```bash
   git push origin feat/your-feature-name
   ```
2. **Open a Pull Request** against the `main` branch
3. **Fill in the PR template** with:
   - A clear description of the changes
   - Related issue numbers (if any)
   - Screenshots for UI changes
4. **Wait for review** — maintainers will review your PR and may request changes

### PR Guidelines

- Keep PRs focused — one feature or fix per PR
- Write a clear PR title and description
- Reference related issues with `Fixes #123` or `Closes #123`
- Ensure CI checks pass
- Be responsive to review feedback

---

## Code Style

### TypeScript / Angular

- Follow existing patterns in the codebase
- Use Angular's dependency injection and service patterns
- Use NgRx Signals for state management
- Prefer standalone components (Angular 21 style)
- Use `vi.fn()` and `vi.mock()` for test mocking (Vitest, not Jest)

### HTML Templates

- Use semantic HTML elements
- Follow the `data-arc-*` attribute conventions for templates
- Include responsive styles with media queries

### CSS

- Use component-scoped styles where possible
- Follow the existing design system (Angular Material + Bootstrap 5)

---

## Reporting Bugs

Open an issue on [GitHub Issues](https://github.com/quadralyst/arccms/issues) with:

1. A clear, descriptive title
2. Steps to reproduce the bug
3. Expected vs actual behavior
4. Browser/environment information
5. Screenshots or error logs if applicable

---

## Suggesting Features

Open a discussion on [GitHub Discussions](https://github.com/quadralyst/arccms/discussions) with:

1. A clear description of the feature
2. The problem it solves
3. Any proposed implementation ideas

---

## Code of Conduct

Please read and follow our [Code of Conduct](CODE_OF_CONDUCT.md). We are committed to providing a welcoming and inclusive experience for everyone.

---

## License

By contributing to Arc CMS, you agree that your contributions will be licensed under the [MIT License](LICENSE).
