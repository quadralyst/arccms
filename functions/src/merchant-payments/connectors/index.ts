/**
 * The connectors, and which of them an app may offer.
 *
 * A connector goes on the list only when it has passed every rule on the provider's own test
 * account: its `proven` is set in code, with the proof written in the docs, so a merchant can
 * never pick an untried one. To run that proof, a project names a connector in
 * ARC_PAYMENTS_TRY (functions/.env.<project>): `worldline-connect` for its test mode,
 * `payrexx:live` for live. It is the developer's switch, per project, and is never on by
 * itself.
 *
 * Adding a provider: a file here that implements PaymentConnector, and a line in CONNECTORS.
 * No app changes.
 */
import type { PaymentConnector, PaymentConnectorInfo, PaymentMode } from '../types.js';
import { payrexx } from './payrexx.js';
import { pretendAllowed, pretendConnector, PRETEND_ID } from './pretend.js';
import { worldlineConnect } from './worldlineConnect.js';

const CONNECTORS: readonly PaymentConnector[] = [worldlineConnect, payrexx, pretendConnector];

let replaced: PaymentConnector | null = null;

/** For tests: this connector answers to its own id and is offered, until called with null. */
export function replaceConnectorForTest(connector: PaymentConnector | null): void {
    replaced = connector;
}

export function connectorFor(id: unknown): PaymentConnector | null {
    if (replaced && replaced.info.id === id) return replaced;
    return CONNECTORS.find((c) => c.info.id === id) ?? null;
}

/** The modes ARC_PAYMENTS_TRY lets a project try a connector in; a mistake in it allows nothing. */
export function triedModes(id: string, env: Record<string, string | undefined> = process.env): PaymentMode[] {
    const modes = new Set<PaymentMode>();
    for (const item of (env['ARC_PAYMENTS_TRY'] ?? '').split(',').map((part) => part.trim())) {
        const [name, mode] = item.split(':');
        if (name !== id) continue;
        if (mode === undefined || mode === 'test') modes.add('test');
        else if (mode === 'live') modes.add('live');
    }
    return [...modes];
}

/**
 * The modes an account may connect in: every mode of a proven connector, the modes a project
 * tries an unproven one in, and the pretend one's only where it is allowed.
 */
export function offeredModes(connector: PaymentConnector, env: Record<string, string | undefined> = process.env): PaymentMode[] {
    if (replaced && connector === replaced) return [...connector.info.modes];
    if (connector.info.id === PRETEND_ID) return pretendAllowed(env) ? ['test'] : [];
    if (connector.info.proven) return [...connector.info.modes];
    return triedModes(connector.info.id, env).filter((mode) => connector.info.modes.includes(mode));
}

/** A connector as the app's screen reads it. A pattern goes as its source, so it can check as you type. */
export interface OfferedConnector extends Omit<PaymentConnectorInfo, 'fields' | 'modes'> {
    fields: Array<Omit<PaymentConnectorInfo['fields'][number], 'pattern'> & { pattern?: string }>;
    /** The modes a merchant may connect in here, which may be fewer than the provider has. */
    modes: PaymentMode[];
    /** Offered only because this project is trying it: it has not been proven yet. */
    trying: boolean;
}

/** The connectors the app may offer here, with what its one screen needs. */
export function paymentConnectors(env: Record<string, string | undefined> = process.env): OfferedConnector[] {
    const all = replaced ? [...CONNECTORS.filter((c) => c.info.id !== replaced!.info.id), replaced] : CONNECTORS;
    return all.flatMap((connector) => {
        const modes = offeredModes(connector, env);
        if (!modes.length) return [];
        return [{
            ...connector.info,
            modes,
            trying: !connector.info.proven && connector.info.id !== PRETEND_ID,
            fields: connector.info.fields.map(({ pattern, ...field }) => ({ ...field, ...(pattern ? { pattern: pattern.source } : {}) })),
        }];
    });
}
