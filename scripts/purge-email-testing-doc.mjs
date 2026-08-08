#!/usr/bin/env node
/**
 * One-off migration: delete `Settings/emailTestingConnection`.
 *
 * Arc CMS used to test an email provider by writing the provider configuration —
 * including `smtp.password`, `gmail.password` and `resend.apiKey` — into this
 * document and letting a Firestore trigger act on it. The trigger only ever wrote
 * `status`, `message` and `updatedAt` back, so the credentials stayed there
 * indefinitely. The connection test is now the `testSmtpConfigConnection`
 * callable, which keeps the payload in the request body and persists nothing.
 *
 * Any deployment that ran a connection test before upgrading still has those
 * credentials sitting in Firestore. Run this once after deploying.
 *
 * Reading the document requires admin rights, so run this with service-account
 * credentials, not from a browser:
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
 *     node scripts/purge-email-testing-doc.mjs --project=<your-project-id>
 *
 * Pass --dry-run to report what would be deleted without deleting it.
 *
 * Deleting the document does NOT rotate the secrets it held. If it existed and
 * carried a password or API key, treat that credential as exposed to anyone who
 * had read access to it and rotate it at the provider.
 */

import { cert, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const projectArg = args.find((a) => a.startsWith('--project='));
const keyArg = args.find((a) => a.startsWith('--key='));

const projectId = projectArg?.split('=')[1] || process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT;

if (!projectId) {
    console.error('Missing project id. Pass --project=<project-id> or set GCLOUD_PROJECT.');
    process.exit(1);
}

const keyPath = keyArg?.split('=')[1] || process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!keyPath) {
    console.error(
        'Missing service-account credentials. Set GOOGLE_APPLICATION_CREDENTIALS or pass --key=<path>.',
    );
    process.exit(1);
}

initializeApp({
    credential: keyArg
        ? cert(JSON.parse(readFileSync(keyPath, 'utf8')))
        : applicationDefault(),
    projectId,
});

const db = getFirestore();

/** Field paths that held a credential, reported so operators know what to rotate. */
const SECRET_PATHS = [
    ['config', 'smtp', 'password'],
    ['config', 'gmail', 'password'],
    ['config', 'resend', 'apiKey'],
];

function readPath(obj, path) {
    return path.reduce((acc, key) => (acc && typeof acc === 'object' ? acc[key] : undefined), obj);
}

async function main() {
    const ref = db.doc('Settings/emailTestingConnection');
    const snap = await ref.get();

    if (!snap.exists) {
        console.log('✓ Settings/emailTestingConnection does not exist. Nothing to purge.');
        return;
    }

    const data = snap.data() ?? {};
    const found = SECRET_PATHS.filter((path) => {
        const value = readPath(data, path);
        return typeof value === 'string' && value.length > 0;
    }).map((path) => path.join('.'));

    console.log(`Found Settings/emailTestingConnection on project "${projectId}".`);
    if (found.length > 0) {
        console.log('It carries these credential fields — ROTATE THEM at the provider:');
        for (const path of found) console.log(`  • ${path}`);
    } else {
        console.log('No populated credential fields found (it may hold only status/message).');
    }

    if (dryRun) {
        console.log('\n--dry-run given; document left in place.');
        return;
    }

    await ref.delete();
    console.log('\n✓ Deleted Settings/emailTestingConnection.');
    if (found.length > 0) {
        console.log('Deletion does not undo the exposure. Rotate the credentials listed above.');
    }
}

main().catch((error) => {
    console.error('Purge failed:', error);
    process.exit(1);
});
