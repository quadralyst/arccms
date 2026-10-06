#!/usr/bin/env node

/**
 * CLI script to run seedStaticPages directly via firebase-admin.
 * Called automatically after deploy, or manually via:
 *   npm run seed:dev
 *   npm run seed:prod
 *   npm run seed -- staging          (any .firebaserc alias, or a project id)
 *
 * The project, the install's database and the credentials (Firebase CLI login, or
 * GOOGLE_APPLICATION_CREDENTIALS) come from runAdminScript (scripts/arc-admin-script.mjs).
 */

// The project: `dev` (the default alias), `prod` (the production alias), or any other
// alias or project id, the same way npm run deploy takes it (specs/app-project-settings-spec.md).
const envArg = process.argv[2] || 'dev';
if (envArg.startsWith('-')) {
    console.error(`Error: give the project as a plain word: npm run seed -- <alias or id>, not "${envArg}".`);
    process.exit(1);
}
/** runAdminScript's arguments for the project asked for. */
function projectArgv(arg) {
    if (arg === 'dev') return [];
    if (arg === 'prod') return ['--prod'];
    return [`--project=${arg}`];
}

async function seed() {
    // Hosting off (arc:configure --site=none): there is no site to seed, and the
    // seed would only mark every page as skipped.
    if (process.env.ARC_HOSTING_SITE === 'none') {
        console.log(`Hosting is off for ${process.env.GCLOUD_PROJECT} (arc:configure --site=none): no static pages to seed.`);
        return;
    }
    const hostingSite = process.env.ARC_HOSTING_SITE || process.env.GCLOUD_PROJECT;

    // Dynamic import() because the compiled output is ESM ("type": "module"), and
    // only now: init.ts calls initializeApp() on import, which needs the credentials.
    const { runSeed } = await import('../lib/pages/seedStaticPages.js');
    const startTime = Date.now();

    console.log(`  Hosting:      https://${hostingSite}.web.app`);
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

        let result;
        try {
            result = await runSeed();
        } finally {
            clearInterval(spinner);
        }
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

        if (!result.success) process.exitCode = 1;
    } catch (err) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        throw new Error(`Seed failed after ${elapsed}s: ${err.message || err}`);
    }
}

async function main() {
    console.log('');
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║        Arc CMS: Static Page Seeder           ║');
    console.log('╚══════════════════════════════════════════════╝');
    console.log('');

    const { runAdminScript } = await import('../../scripts/arc-admin-script.mjs');
    await runAdminScript(seed, { argv: projectArgv(envArg) });
    // The built functions keep their own Admin SDK connection open, so leave explicitly.
    process.exit(process.exitCode ?? 0);
}

main();
