# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Arc CMS, please report it responsibly. **Do not open a public GitHub issue for security vulnerabilities.**

### How to Report

Email your findings to: **gunjan@quadralyst.com**

Please include:

1. Description of the vulnerability
2. Steps to reproduce
3. Potential impact
4. Suggested fix (if any)

### What to Expect

- **Acknowledgment** within 48 hours of your report
- **Assessment** of the vulnerability within 5 business days
- **Resolution timeline** communicated once the issue is confirmed
- **Credit** in the changelog and release notes (unless you prefer to remain anonymous)

### Scope

The following are in scope:

- Arc CMS application code (frontend and Cloud Functions)
- Firestore security rules
- Cloud Storage security rules
- Authentication flows
- Template rendering system

The following are out of scope:

- Third-party dependencies (report these to the respective maintainers)
- Firebase platform vulnerabilities (report to Google)
- Issues in user-deployed instances caused by misconfiguration

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.x     | Yes       |

## Security Best Practices for Deployers

- Never commit real Firebase credentials to public repositories
- Use `environment.example.ts` as a template and keep actual environment files in `.gitignore`
- Deploy Firestore and Storage security rules before going live
- Regularly update dependencies with `npm audit fix`
- Enable Firebase App Check for additional API protection
- Use strong passwords for admin accounts
