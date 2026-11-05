/**
 * npm run payments:proof: try a connector on the provider's own account, with real keys, from
 * Arc CMS itself (docs/app/merchant-payments.html#proof). A connector goes on the list a
 * merchant picks from only when this has passed for every way of paying.
 *
 *   npm run payments:proof -- --provider=worldline-connect --mode=test
 *   npm run payments:proof -- --provider=payrexx --mode=live --project=<id>
 *
 * Keys are typed at a prompt that shows nothing, go through the same call an app's function
 * makes, and are never printed, logged or kept anywhere else. Build the functions first, with
 * the merchant-payments feature on, and deploy them for the events to arrive: this runs the
 * real code against the real project's database, so nothing here is a stand-in.
 */
import readline from 'node:readline';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { runAdminScript } from './arc-admin-script.mjs';

/** A value from `--name=value`, or undefined. */
export function flag(args, name) {
    const found = args.find((arg) => arg.startsWith(`--${name}=`));
    return found ? found.slice(name.length + 3) : undefined;
}

/** Tries forged events on the deployed webhook, and times the answer (rules 2, 8). */
export async function tryForgedEvents({ address, signed, reference, fetchImpl = fetch, now = Date.now }) {
    const body = JSON.stringify(signed
        ? { id: `forged-${now()}`, type: 'payment.paid', payment: { id: 'forged', paymentOutput: { references: { merchantReference: reference } } } }
        : { transaction: { id: 1, status: 'confirmed', referenceId: reference } });
    const started = now();
    const response = await fetchImpl(address, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(signed ? { 'X-GCS-Signature': 'Zm9yZ2Vk', 'X-GCS-KeyId': 'forged' } : {}) }, body });
    return { status: response.status, ms: now() - started };
}

/** Waits until the payment has left `open`, or `tries` run out, saying each new thing the provider says. */
export async function watchPayment({ kit, accountId, reference, log, wait, tries = 180 }) {
    let said = '';
    let view = null;
    for (let i = 0; i < tries; i++) {
        view = await kit.readPayment({ accountId, reference });
        if (!view.ok) return view;
        const word = `${view.status}, the provider says ${view.providerStatus ?? 'nothing yet'}`;
        if (word !== said) log(`  ${word}`);
        said = word;
        if (view.status !== 'open') return view;
        await wait();
    }
    return view;
}

/** One proof run. `kit` is the app kit's calls; every outside thing is passed in, so a test runs it. */
export async function runProof({ kit, args, ask, askHidden, log, wait, fetchImpl = fetch, now = Date.now }) {
    const provider = flag(args, 'provider');
    const mode = flag(args, 'mode');
    if (!provider || (mode !== 'test' && mode !== 'live')) {
        log('Say which: --provider=worldline-connect or --provider=payrexx, and --mode=test or --mode=live.');
        return { ok: false };
    }
    const connector = kit.paymentConnectors().find((c) => c.id === provider);
    if (!connector || !connector.modes.includes(mode)) {
        log(`${provider} cannot be tried in ${mode} mode.`);
        return { ok: false };
    }
    const accountId = flag(args, 'account') ?? `proof-${provider}`;
    const currency = flag(args, 'currency') ?? 'CHF';
    log(`Connecting ${connector.name}, ${mode}, as account ${accountId}. What you type for a secret is not shown.`);

    const fields = {};
    for (const field of connector.fields) {
        const label = `${field.label}${field.required ? '' : ' (optional)'}${field.help ? ` [${field.help}]` : ''}: `;
        fields[field.id] = field.secret ? await askHidden(label) : await ask(label);
    }
    const connected = await kit.connectPaymentAccount({ accountId, provider, mode, fields, by: 'payments-proof' });
    if (!connected.ok) {
        log(`Not connected (${connected.reason}): ${connected.detail}`);
        return { ok: false };
    }
    log(`The provider took the keys. A page may read: ${connected.account.publicName}, ending ${connected.account.last4}.`);
    log(`\nWebhook address: ${connected.account.webhookAddress}`);
    if (connector.webhookByHand) await ask("Add it in the provider's own admin, then press Enter. ");

    const rows = [];
    for (;;) {
        const way = (await ask('\nWhich way of paying to try now (such as card or twint)? Empty to finish: ')).trim();
        if (!way) break;
        const reference = `proof-${now().toString(36)}`;
        const amountMinor = Number((await ask(`Amount in minor units, ${currency} [100]: `)).trim() || '100');
        const started = await kit.startPayment({ accountId, amountMinor, currency, reference, returnUrl: flag(args, 'return') ?? 'https://example.com/', lifeMinutes: connector.pageLife.settable ? 15 : undefined });
        if (!started.ok) {
            log(`Not started (${started.reason}): ${started.detail}`);
            rows.push({ way, outcome: `not started: ${started.reason}` });
            continue;
        }
        const forged = await tryForgedEvents({ address: connected.account.webhookAddress, signed: connector.signsEvents, reference, fetchImpl, now }).catch((error) => ({ status: 0, ms: 0, error: String(error.message ?? error) }));
        const forgedOk = connector.signsEvents ? forged.status === 401 : forged.status === 200;
        log(`Forged event: answered ${forged.status} in ${forged.ms} ms${forgedOk ? '' : ' (NOT WHAT THE RULES ASK)'}. Answering inside 10 seconds is rule 8; run this after the function has been idle for a cold start.`);
        log(`\nPay here: ${started.pageUrl}\nThe page closes at ${started.closesAtIso}. Waiting for the provider...`);
        const view = await watchPayment({ kit, accountId, reference, log, wait });
        const events = view?.ok ? (view.eventSeen ? 'event arrived' : 'NO EVENT YET') : 'not read';
        rows.push({ way, outcome: view?.ok ? view.status : view?.reason, providerStatus: view?.providerStatus ?? '', method: view?.method ?? '', events, forged: `${forged.status} in ${forged.ms} ms` });
        if (view?.ok && view.status === 'paid' && (await ask('Refund it through Arc? (y/N) ')).trim().toLowerCase() === 'y') {
            const refunded = await kit.refundPayment({ accountId, reference, by: 'payments-proof' });
            log(refunded.ok ? `Refunded: the provider says ${refunded.providerStatus}.` : `Not refunded (${refunded.reason}): ${refunded.detail}`);
        }
    }
    log('\nWhat this run saw:');
    for (const row of rows) log(`  ${row.way}: ${row.outcome}. Provider: ${row.providerStatus ?? ''} (${row.method ?? ''}). ${row.events ?? ''}. Forged: ${row.forged ?? ''}.`);
    if ((await ask('\nDisconnect this account and remove its keys now? (Y/n) ')).trim().toLowerCase() !== 'n') {
        const gone = await kit.disconnectPaymentAccount({ accountId, by: 'payments-proof', force: true });
        log(gone.ok ? 'Disconnected: the keys are removed.' : `Not disconnected (${gone.reason}): ${gone.detail}`);
    }
    return { ok: true, rows };
}

function askWith(hidden) {
    return (question) => new Promise((done) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
        if (hidden) {
            process.stdout.write(question);
            // Nothing typed reaches the screen.
            rl._writeToOutput = () => undefined;
        }
        rl.question(hidden ? '' : question, (answer) => {
            rl.close();
            if (hidden) process.stdout.write('\n');
            done(answer);
        });
    });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    runAdminScript(async ({ args }) => {
        const provider = flag(args, 'provider') ?? '';
        const mode = flag(args, 'mode') ?? 'test';
        // For this process only: an app's own project is never on trial because of this.
        process.env.ARC_PAYMENTS_TRY = `${provider}:${mode}`;
        const kitUrl = pathToFileURL(resolve(fileURLToPath(new URL('..', import.meta.url)), 'functions/lib/app-kit/index.js')).href;
        const kit = await import(kitUrl);
        const answer = await runProof({ kit, args, ask: askWith(false), askHidden: askWith(true), log: console.log, wait: () => new Promise((done) => setTimeout(done, 10_000)) });
        if (!answer.ok) process.exitCode = 1;
    });
}
