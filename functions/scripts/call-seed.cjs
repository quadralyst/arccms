#!/usr/bin/env node

/**
 * CLI script to run seedStaticPages directly via firebase-admin.
 * Called automatically after deploy, or manually via:
 *   npm run seed:dev
 *   npm run seed:prod
 *
 * Requires GCLOUD_PROJECT env var (set by the npm scripts).
 * Uses Firebase CLI credentials (from `firebase login`).
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

// Determine environment from CLI arg (default: "dev")
const envArg = (process.argv[2] || 'dev').toLowerCase();
const envToAlias = { dev: 'default', prod: 'production' };
const alias = envToAlias[envArg];
if (!alias) {
    console.error(`Error: Unknown environment "${envArg}". Use "dev" or "prod".`);
    process.exit(1);
}

// Read project ID from .firebaserc
let projectId = process.env.GCLOUD_PROJECT;
if (!projectId) {
    try {
        const firebaserc = JSON.parse(fs.readFileSync(path.join(__dirname, '../../.firebaserc'), 'utf-8'));
        projectId = firebaserc.projects[alias];
    } catch { /* ignore */ }
}
if (!projectId) {
    console.error(`Error: Could not resolve project ID for "${envArg}" from .firebaserc.`);
    process.exit(1);
}

// Read Firebase CLI refresh token to build Application Default Credentials
let refreshToken;
try {
    const configPath = path.join(os.homedir(), '.config/configstore/firebase-tools.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    refreshToken = config.tokens && config.tokens.refresh_token;
} catch {
    // ignore
}

if (!refreshToken) {
    console.error('Error: No Firebase CLI credentials found. Run `firebase login` first.');
    process.exit(1);
}

// Write a temporary ADC file so firebase-admin's initializeApp() picks up credentials.
// Client ID/secret are the Firebase CLI's public OAuth2 credentials (from firebase-tools npm package).
const tmpAdc = path.join(os.tmpdir(), `firebase-adc-${process.pid}.json`);
fs.writeFileSync(tmpAdc, JSON.stringify({
    type: 'authorized_user',
    client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
    client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi',
    refresh_token: refreshToken,
}), { mode: 0o600 });

// Set env vars BEFORE importing compiled function code (which triggers init.ts → admin.initializeApp())
process.env.GOOGLE_APPLICATION_CREDENTIALS = tmpAdc;
process.env.GCLOUD_PROJECT = projectId;
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId });

async function main() {
    // Dynamic import() because the compiled output is ESM ("type": "module")
    const { runSeed } = await import('../lib/pages/seedStaticPages.js');
    const startTime = Date.now();

    console.log('');
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║        Arc CMS — Static Page Seeder          ║');
    console.log('╚══════════════════════════════════════════════╝');
    console.log('');
    console.log(`  Project:  ${projectId}`);
    console.log(`  Hosting:  https://${projectId}.web.app`);
    console.log('');
    console.log('  Initializing Firebase Admin SDK...');

    try {
        console.log('  Loading site settings and partials...');
        console.log('  Fetching content types from Firestore...');
        console.log('');

        // Spinner to show progress while deploying
        const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        let frameIdx = 0;
        const spinner = setInterval(() => {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
            process.stdout.write(`\r  ${spinnerFrames[frameIdx]} Deploying pages... (${elapsed}s)`);
            frameIdx = (frameIdx + 1) % spinnerFrames.length;
        }, 100);

        const result = await runSeed();

        clearInterval(spinner);
        process.stdout.write('\r  ✓ Deployment complete.                    \n');

        for (const line of result.details) {
            console.log(line);
        }

        if (result.errorDetails.length > 0) {
            console.error('\nErrors:');
            for (const err of result.errorDetails) {
                console.error(`  - ${err}`);
            }
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        console.log('');
        console.log('──────────────────────────────────────────────');
        console.log(`  Pages deployed:  ${result.deployed}`);
        console.log(`  Errors:          ${result.errors}`);
        console.log(`  Total time:      ${elapsed}s`);
        console.log(`  Status:          ${result.success ? '✓ Success' : '✗ Completed with errors'}`);
        console.log('──────────────────────────────────────────────');
        console.log('');

        process.exit(result.success ? 0 : 1);
    } catch (err) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.error(`\nSeed failed after ${elapsed}s:`, err.message || err);
        process.exit(1);
    } finally {
        try { fs.unlinkSync(tmpAdc); } catch { /* ignore */ }
    }
}

main();
