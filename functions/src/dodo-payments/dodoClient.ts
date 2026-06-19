import DodoPayments from 'dodopayments';
import { db } from '../init.js';
import { DodoPaymentsSettings } from './types.js';

const SETTINGS_COLLECTION = 'Settings';
const SETTINGS_DOC = 'dodo-payments';

/** Read the Dodo Payments configuration document from Firestore. */
export async function getDodoSettings(): Promise<DodoPaymentsSettings> {
  const snap = await db.collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC).get();
  if (!snap.exists) {
    throw new Error('Dodo Payments is not configured (Settings/dodo-payments missing).');
  }
  return snap.data() as DodoPaymentsSettings;
}

/** Pick the API key for the configured mode. */
export function resolveApiKey(settings: DodoPaymentsSettings): string {
  const key = settings.mode === 'live' ? settings.liveApiKey : settings.testApiKey;
  if (!key) {
    throw new Error(`Dodo Payments ${settings.mode ?? 'test'} API key is not set.`);
  }
  return key;
}

/**
 * Build a configured Dodo Payments SDK client from stored settings.
 * The webhook signing key is included so the same client can verify webhooks.
 */
export function buildDodoClient(settings: DodoPaymentsSettings): DodoPayments {
  return new DodoPayments({
    bearerToken: resolveApiKey(settings),
    environment: settings.mode === 'live' ? 'live_mode' : 'test_mode',
    webhookKey: settings.webhookSecret,
  });
}

/** Convenience: load settings and build a client in one call. */
export async function getDodoClient(): Promise<{ client: DodoPayments; settings: DodoPaymentsSettings }> {
  const settings = await getDodoSettings();
  if (!settings.enabled) {
    throw new Error('Dodo Payments integration is disabled.');
  }
  return { client: buildDodoClient(settings), settings };
}
