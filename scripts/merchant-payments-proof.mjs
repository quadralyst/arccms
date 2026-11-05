/**
 * npm run payments:proof: try a connector on the provider's own account, with real keys, from
 * Arc CMS itself (docs/app/merchant-payments.html#proof). A connector goes on the list a
 * merchant picks from only when this has passed for every way of paying.
 *
 *   npm run payments:proof -- --provider=worldline-connect --mode=test
 *   npm run payments:proof -- --provider=payrexx --mode=live --project=<id>
 *   npm run payments:proof -- --provider=payrexx --mode=live --remove      takes the keys out
 *
 * Keys are typed at a prompt that shows nothing, go through the same call an app's function
 * makes, and are never printed, logged or kept anywhere else. Build the functions first, with
 * the merchant-payments feature on, and deploy them for the events to arrive: this runs the
 * real code against the real project's database, so nothing here is a stand-in.
 *
 * It reports what it saw, marked against what the rules ask. It never sets `proven`.
 */
import readline from 'node:readline';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { runAdminScript } from './arc-admin-script.mjs';

/** Every 10 seconds, so 30 minutes for a page or the sweep, and 2 minutes for an event. */
const LONG_WAIT_TRIES = 180;
const EVENT_WAIT_TRIES = 12;
/** The shortest limit a provider gives an answer (rule 8). */
const ANSWER_LIMIT_MS = 10_000;
const PROOF_BY = 'payments-proof';

/** A value from `--name=value`, or undefined. */
export function flag(args, name) {
    const found = args.find((arg) => arg.startsWith(`--${name}=`));
    return found ? found.slice(name.length + 3) : undefined;
}

/** A key that looks right and is not: the same length, with its end changed. */
export function wrongKey(value) {
    const end = value.endsWith('wrong') ? 'right' : 'wrong';
    return `${value.slice(0, -end.length)}${end}`;
}

/** Tries a forged event on the deployed webhook, and times the answer (rules 2, 8). */
export async function tryForgedEvents({ address, signed, reference, fetchImpl = fetch, now = Date.now }) {
    const body = JSON.stringify(signed
        ? { id: `forged-${now()}`, type: 'payment.paid', payment: { id: 'forged', paymentOutput: { references: { merchantReference: reference } } } }
        : { transaction: { id: 1, status: 'confirmed', referenceId: reference } });
    const started = now();
    const response = await fetchImpl(address, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(signed ? { 'X-GCS-Signature': 'Zm9yZ2Vk', 'X-GCS-KeyId': 'forged' } : {}) }, body });
    return { status: response.status, ms: now() - started };
}

/** Asks `next` until it answers something `done` accepts, or `tries` run out, saying each new thing. */
async function waitFor({ next, done, log, wait, now, tries }) {
    const from = now();
    let said = '';
    let view = null;
    for (let i = 0; i < tries; i++) {
        view = await next();
        if (!view || view.ok === false) return view;
        const word = `${view.status}, the provider says ${view.providerStatus ?? 'nothing yet'}`;
        if (word !== said) log(`  ${Math.round((now() - from) / 1000)} s: ${word}`);
        said = word;
        if (done(view)) return view;
        await wait();
    }
    return view;
}

/** Waits until the payment has left `open`, reading the provider as an app would. */
export function watchPayment({ kit, accountId, reference, log, wait, now = Date.now, tries = LONG_WAIT_TRIES }) {
    return waitFor({ next: () => kit.readPayment({ accountId, reference }), done: (view) => view.status !== 'open', log, wait, now, tries });
}

/** A record's status alone: a payment left to the deployed functions, with nothing read here. */
function watchRecord({ peek, paymentId, log, wait, now, tries = LONG_WAIT_TRIES }) {
    return waitFor({ next: () => peek(paymentId), done: (record) => record.status !== 'open', log, wait, now, tries });
}

function describeView(view) {
    if (!view) return 'nothing to read';
    if (view.ok === false) return `not read: ${view.reason}`;
    return [view.status, view.providerStatus ? `the provider says ${view.providerStatus}` : '', view.method ?? '', view.late ? 'late' : '', view.heldReasons?.length ? `held for ${view.heldReasons.join(', ')}` : ''].filter(Boolean).join(', ');
}

/** The steps of a run, with what they share. */
function steps(run) {
    const { kit, accountId, connector, currency, args, ask, log, wait, peek, fetchImpl, now, rows } = run;
    const note = (check, saw, expected) => {
        rows.push({ check, saw, expected });
        log(`${expected === false ? 'NOT WHAT THE RULES ASK. ' : ''}${check}: ${saw}`);
    };

    const openPage = async (label, amountMinor = 100) => {
        const reference = `proof-${label}-${now().toString(36)}`;
        const started = await kit.startPayment({ accountId, amountMinor, currency, reference, returnUrl: flag(args, 'return') ?? 'https://example.com/', lifeMinutes: connector.pageLife.settable ? 15 : undefined });
        return { reference, started };
    };
    const askAmount = async () => Number((await ask(`Amount in minor units, ${currency} [100]: `)).trim() || '100');
    const showPage = (started) => log(`\nPay here: ${started.pageUrl}\nThe page closes at ${started.closesAtIso}. After paying you land on the return address, example.com unless you set --return.`);
    const awaitEvent = async (view) => {
        if (!view?.ok || view.eventSeen) return view;
        log("Waiting up to 2 minutes for the provider's event...");
        return waitFor({ next: () => kit.readPayment({ accountId, reference: view.reference }), done: (read) => read.eventSeen, log, wait, now, tries: EVENT_WAIT_TRIES });
    };

    /** A refund or two, so a live payment need not stay paid. Part first, then what is left. */
    const offerRefund = async (reference, paid) => {
        if (paid?.status !== 'paid') return;
        let left = paid.amountMinor - (paid.refundedMinor ?? 0);
        while (left > 0) {
            const choice = (await ask(`Refund through Arc? ${left} minor units left. part, whole, or empty for no: `)).trim().toLowerCase();
            if (choice !== 'part' && choice !== 'whole') return;
            const half = Math.max(1, Math.floor(left / 2));
            const amountMinor = choice === 'part' ? Number((await ask(`How much of it, in minor units [${half}]: `)).trim() || half) : undefined;
            // Never undefined by accident, which would refund the whole of it.
            if (choice === 'part' && (!Number.isSafeInteger(amountMinor) || amountMinor <= 0)) {
                log('That is not a whole number of minor units, so nothing was refunded.');
                continue;
            }
            const refunded = await kit.refundPayment({ accountId, reference, by: PROOF_BY, ...(choice === 'part' ? { amountMinor } : {}) });
            note(`refund, ${choice}`, refunded.ok ? `the provider says ${refunded.providerStatus}` : `not refunded: ${refunded.reason}`, refunded.ok);
            if (!refunded.ok) return;
            left = paid.amountMinor - refunded.refundedMinor;
        }
    };

    return {
        note,

        /** A key changed by a few characters must be refused. Nothing is kept, as a refused key saves nothing. */
        async wrongKeyCheck(fields) {
            const field = connector.fields.find((f) => f.secret && f.preview) ?? connector.fields.find((f) => f.secret);
            if (!field) return note('wrong key', 'this provider has no secret to get wrong', null);
            const wrongAccount = `${accountId}-wrong`;
            const answer = await kit.connectPaymentAccount({ accountId: wrongAccount, provider: connector.id, mode: run.mode, fields: { ...fields, [field.id]: wrongKey(fields[field.id]) }, by: PROOF_BY });
            if (answer.ok) {
                await kit.disconnectPaymentAccount({ accountId: wrongAccount, by: PROOF_BY, force: true });
                return note('wrong key', `the provider took a wrong ${field.label}`, false);
            }
            return note('wrong key', `answered ${answer.reason}`, answer.reason === 'key-refused' ? true : null);
        },

        /**
         * A forged event, first thing, so its timing can be a cold start: before the provider's
         * own address check wakes the function. Where the provider signs, the signature refuses
         * it. Where it does not, it has to go all the way and change nothing, on a page kept for
         * this, so it never counts as an event on a payment you make.
         */
        async forgedCheck(address) {
            log(`\nForging an event at the webhook. Its time counts as a cold start only if the function has been idle for about 20 minutes.`);
            const signed = connector.signsEvents;
            let page = null;
            if (!signed) {
                page = await openPage('forged');
                if (!page.started.ok) return note('forged event', `no page to try it on: ${page.started.reason}`, false);
            }
            const forged = await tryForgedEvents({ address, signed, reference: page?.reference ?? 'proof-forged', fetchImpl, now }).catch((error) => ({ status: 0, ms: 0, error: String(error.message ?? error) }));
            const quick = forged.ms <= ANSWER_LIMIT_MS;
            const timing = `answered ${forged.status} in ${forged.ms} ms${quick ? '' : ', over the 10 second limit'}`;
            if (forged.status === 404 || forged.status === 0) log('The webhook did not answer: are the four functions deployed, with the feature on?');
            if (signed) return note('forged event', timing, forged.status === 401 && quick);

            let seen = false;
            for (let i = 0; i < EVENT_WAIT_TRIES && !seen; i++) {
                seen = !!(await peek(page.started.paymentId))?.eventSeen;
                if (!seen) await wait();
            }
            const after = await kit.readPayment({ accountId, reference: page.reference });
            const ended = await kit.endPayment({ accountId, reference: page.reference });
            if (!ended.ok) log(`The page kept for this was not ended (${ended.reason}): it closes by itself.`);
            const unchanged = after?.ok && after.status === 'open';
            return note('forged event', `${timing}, ${seen ? 'reached the record' : 'never reached the record'}, and the payment ${unchanged ? 'stayed open' : `is now ${describeView(after)}`}`, forged.status === 200 && quick && seen && unchanged);
        },

        checks: [
            {
                id: 'pay',
                short: 'pay',
                rowsStartWith: 'pay',
                label: 'Pay, read the result, see the event arrive, then refund. Once for each way of paying',
                async run() {
                    const way = (await ask('Which way of paying (such as card or twint)? ')).trim() || 'unnamed';
                    const { reference, started } = await openPage('pay', await askAmount());
                    if (!started.ok) return note(`pay, ${way}`, `not started: ${started.reason}`, false);
                    showPage(started);
                    log('Waiting for the provider...');
                    const view = await awaitEvent(await watchPayment({ kit, accountId, reference, log, wait, now }));
                    const event = view?.ok ? (view.eventSeen ? 'event arrived' : 'NO EVENT in 2 minutes: look in the provider\'s webhook log, and at its shape') : '';
                    const finishedBadly = view?.ok && (view.status === 'failed' || view.status === 'cancelled');
                    note(`pay, ${way}`, [describeView(view), event].filter(Boolean).join('. '), finishedBadly ? null : !!(view?.ok && view.status === 'paid' && view.eventSeen));
                    await offerRefund(reference, view);
                },
            },
            {
                id: 'end',
                short: 'ending a page',
                rowsStartWith: 'end a page',
                label: 'End a page nobody has paid',
                async run() {
                    const { reference, started } = await openPage('end');
                    if (!started.ok) return note('end a page', `not started: ${started.reason}`, false);
                    log(`\nOpen this page, to see what a buyer sees: ${started.pageUrl}`);
                    await ask('Press Enter to end it. ');
                    const ended = await kit.endPayment({ accountId, reference });
                    const buyerSees = (await ask('Reload the page. What does it show now, in a few words? ')).trim();
                    note('end a page', `${describeView(ended)}. A buyer sees: ${buyerSees || 'not said'}`, !!(ended?.ok && ended.status === 'cancelled'));
                },
            },
            {
                id: 'late',
                short: 'late money',
                rowsStartWith: 'late money',
                label: 'Pay just as the page is ended, so the money comes late',
                async run() {
                    const { reference, started } = await openPage('late', await askAmount());
                    if (!started.ok) return note('late money', `not started: ${started.reason}`, false);
                    log(`\nOpen this page, fill everything in, and stop just before the last button: ${started.pageUrl}`);
                    await ask('Press Enter when you are there. ');
                    const ended = await kit.endPayment({ accountId, reference });
                    if (!ended?.ok) return note('late money', `the page was not ended: ${ended?.reason}`, false);
                    log(`The page is ended: ${describeView(ended)}.`);
                    const took = (await ask('Now press the button. Did the provider take the payment? (y/N) ')).trim().toLowerCase() === 'y';
                    if (!took) {
                        const read = await kit.readPayment({ accountId, reference });
                        return note('late money', `the provider refused to take it on an ended page, and Arc says ${describeView(read)}`, !!(read?.ok && read.status === 'cancelled'));
                    }
                    log('Waiting for the provider...');
                    const view = await waitFor({ next: () => kit.readPayment({ accountId, reference }), done: (read) => read.status === 'paid' || read.status === 'held', log, wait, now, tries: LONG_WAIT_TRIES });
                    note('late money', describeView(view), !!(view?.ok && view.status === 'paid' && view.late));
                    await offerRefund(reference, view);
                },
            },
            {
                id: 'sweep',
                short: 'the sweep',
                rowsStartWith: 'sweep',
                label: 'Pay with the webhook removed, so only the sweep can find it',
                async run() {
                    if (connector.webhookByHand) await ask("Remove the webhook address in the provider's own admin, then press Enter. ");
                    const { reference, started } = await openPage('sweep', await askAmount());
                    if (!started.ok) return note('sweep', `not started: ${started.reason}`, false);
                    showPage(started);
                    log('Nothing here reads the provider now. The sweep does, 2 to 15 minutes apart, so this can take a while...');
                    const record = await watchRecord({ peek, paymentId: started.paymentId, log, wait, now });
                    const eventCame = !!record?.eventSeen;
                    note('sweep', `${describeView(record)}${eventCame ? '. An event arrived, so the webhook was still on' : ''}`, !!(record?.status === 'paid' && !eventCame));
                    await offerRefund(reference, record?.status === 'paid' ? { ...record, ok: true } : null);
                    if (connector.webhookByHand) await ask('Add the webhook address back if you will try more, then press Enter. ');
                },
            },
        ],
    };
}

function printSummary({ rows, checks, log }) {
    log('\nWhat this run saw:');
    for (const row of rows) log(`  ${row.expected === true ? 'as the rules ask' : row.expected === false ? 'NOT AS THE RULES ASK' : 'for you to judge'}. ${row.check}: ${row.saw}`);
    const missing = checks.filter((check) => !rows.some((row) => row.check.startsWith(check.rowsStartWith)));
    if (missing.length) log(`\nNot tried in this run: ${missing.map((check) => check.short).join(', ')}.`);
    log("\nBy hand, as no call does it: a part capture in the provider's own admin, which must read as held. Each way of paying needs its own pay row. This command never sets `proven`; you do, in the connector.");
}

/** One proof run. `kit` is the app kit's calls; every outside thing is passed in, so a test runs it. */
export async function runProof({ kit, args, ask, askHidden, log, wait, peek, fetchImpl = fetch, now = Date.now }) {
    const provider = flag(args, 'provider');
    const mode = flag(args, 'mode');
    if (!provider || (mode !== 'test' && mode !== 'live')) {
        log('Say which: --provider=worldline-connect or --provider=payrexx, and --mode=test or --mode=live.');
        return { ok: false };
    }
    const accountId = flag(args, 'account') ?? `proof-${provider}`;
    if (args.includes('--remove')) {
        const gone = await kit.disconnectPaymentAccount({ accountId, by: PROOF_BY, force: true });
        log(gone.ok ? 'Disconnected: the keys are removed.' : `Not disconnected (${gone.reason}): ${gone.detail}`);
        return { ok: gone.ok };
    }
    const connector = kit.paymentConnectors().find((c) => c.id === provider);
    if (!connector || !connector.modes.includes(mode)) {
        log(`${provider} cannot be tried in ${mode} mode.`);
        return { ok: false };
    }
    const currency = flag(args, 'currency') ?? 'CHF';
    log(`Connecting ${connector.name}, ${mode}, as account ${accountId}. What you type for a secret is not shown.`);
    if (mode === 'live') log('This is a live account: a payment you make here moves real money.');

    const fields = {};
    for (const field of connector.fields) {
        const label = `${field.label}${field.required ? '' : ' (optional)'}${field.help ? ` [${field.help}]` : ''}: `;
        fields[field.id] = field.secret ? await askHidden(label) : await ask(label);
    }
    const connected = await kit.connectPaymentAccount({ accountId, provider, mode, fields, by: PROOF_BY });
    if (!connected.ok) {
        log(`Not connected (${connected.reason}): ${connected.detail}`);
        return { ok: false };
    }
    log(`The provider took the keys. A page may read: ${connected.account.publicName}, ending ${connected.account.last4}.`);
    log(`If you stop this with Ctrl+C the keys stay stored. To take them out afterwards, run this again with --remove.`);

    const rows = [];
    const run = { kit, accountId, connector, mode, currency, args, ask, log, wait, peek, fetchImpl, now, rows };
    const { wrongKeyCheck, forgedCheck, checks } = steps(run);
    await wrongKeyCheck(fields);
    await forgedCheck(connected.account.webhookAddress);

    log(`\nWebhook address: ${connected.account.webhookAddress}`);
    if (connector.webhookByHand) await ask("Add it in the provider's own admin, and see that it passes the provider's check, then press Enter. ");

    for (;;) {
        log(`\nWhat next?\n${checks.map((check, i) => `  ${i + 1}  ${check.label}`).join('\n')}`);
        const choice = (await ask('A number, or empty to finish: ')).trim();
        if (!choice) break;
        const check = checks[Number(choice) - 1];
        if (check) await check.run();
        else log('That is not on the list.');
    }

    printSummary({ rows, checks, log });
    log('');
    if ((await ask('Disconnect this account and remove its keys now? (Y/n) ')).trim().toLowerCase() !== 'n') {
        const gone = await kit.disconnectPaymentAccount({ accountId, by: PROOF_BY, force: true });
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
        const built = (path) => pathToFileURL(resolve(fileURLToPath(new URL('..', import.meta.url)), `functions/lib/${path}`)).href;
        const kit = await import(built('app-kit/index.js'));
        if (typeof kit.paymentConnectors !== 'function') throw new Error('The built functions have no merchant payments: run npm run build --prefix functions first.');
        // Before any key is typed, not after.
        const { isFeatureOn } = await import(built('feature-flags.js'));
        if (!isFeatureOn('merchant-payments')) throw new Error("Merchant payments are off in this build: add on: ['merchant-payments'] to src/custom/features.ts, then run npm run build --prefix functions.");
        // The kit's own database handle, as a script that loads the built functions needs no other.
        const [{ db }, { PAYMENTS }] = await Promise.all([import(built('init.js')), import(built('merchant-payments/store.js'))]);
        const peek = async (paymentId) => (await db.collection(PAYMENTS).doc(paymentId).get()).data() ?? null;
        const answer = await runProof({ kit, args, ask: askWith(false), askHidden: askWith(true), log: console.log, peek, wait: () => new Promise((done) => setTimeout(done, 10_000)) });
        if (!answer.ok) process.exitCode = 1;
    });
}
