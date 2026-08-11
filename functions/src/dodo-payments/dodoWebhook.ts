import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import { getDodoSettings, buildDodoClient } from './dodoClient.js';
import { DodoWebhookPayload, WebhookEventDoc, PAYMENT_PROVIDER } from './types.js';

/**
 * HTTP endpoint that receives Dodo Payments webhooks.
 *
 * Responsibilities are deliberately minimal: verify the Standard-Webhooks
 * signature, then persist the raw event to `WebhookEvents` keyed by the
 * `webhook-id` header (so duplicate deliveries are idempotently deduped).
 * All business side-effects run in the `handlePaymentEvent` Firestore trigger.
 *
 * This keeps the endpoint fast and ensures the raw payload is never lost — it
 * is the forensic log used to debug payment failures.
 */
export const dodoWebhook = onRequest(async (request, response) => {
  const webhookId = (request.headers['webhook-id'] as string) || '';
  const webhookSignature = (request.headers['webhook-signature'] as string) || '';
  const webhookTimestamp = (request.headers['webhook-timestamp'] as string) || '';

  if (!webhookId || !webhookSignature || !webhookTimestamp) {
    logger.warn('Dodo webhook missing required headers');
    response.status(400).send('Missing webhook headers');
    return;
  }

  // Load config first, and on its own: a configuration or connectivity problem
  // must surface as a 5xx (Dodo retries) rather than being reported inside the
  // signature check as a 401, which reads as "this endpoint is permanently bad".
  let client: ReturnType<typeof buildDodoClient>;
  try {
    const settings = await getDodoSettings();
    if (!settings.webhookSecret) {
      logger.error('Dodo webhook secret is not configured');
      response.status(500).send('Webhook not configured');
      return;
    }
    client = buildDodoClient(settings);
  } catch (error) {
    logger.error('Dodo webhook could not load payment settings', error);
    response.status(500).send('Webhook configuration unavailable');
    return;
  }

  // Verify signature against the configured webhook secret.
  let payload: DodoWebhookPayload;
  try {
    const rawBody = request.rawBody ? request.rawBody.toString('utf8') : JSON.stringify(request.body);

    payload = client.webhooks.unwrap(rawBody, {
      headers: {
        'webhook-id': webhookId,
        'webhook-signature': webhookSignature,
        'webhook-timestamp': webhookTimestamp,
      },
    }) as unknown as DodoWebhookPayload;
  } catch (error) {
    logger.warn('Dodo webhook signature verification failed', error);
    response.status(401).send('Invalid signature');
    return;
  }

  // Persist raw event idempotently (doc id = webhook-id).
  const eventDoc: WebhookEventDoc = {
    provider: PAYMENT_PROVIDER,
    eventType: payload?.type ?? 'unknown',
    rawPayload: payload,
    headers: {
      'webhook-id': webhookId,
      'webhook-timestamp': webhookTimestamp,
    },
    signatureValid: true,
    receivedAt: Timestamp.now(),
    processed: false,
  };

  try {
    await db.collection('WebhookEvents').doc(webhookId).create(eventDoc);
  } catch (error) {
    // create() throws ALREADY_EXISTS on duplicate delivery — that's a successful no-op.
    if (isAlreadyExists(error)) {
      logger.info(`Dodo webhook ${webhookId} already recorded; skipping.`);
      response.status(200).send('Already processed');
      return;
    }
    // Anything else (transient Firestore failure, quota, outage) means the event
    // was NOT persisted. A 200 here would tell Dodo it was delivered and the
    // payment event would be lost for good — 5xx so it is redelivered.
    logger.error(`Failed to persist Dodo webhook ${webhookId}`, error);
    response.status(500).send('Failed to record event');
    return;
  }

  response.status(200).send('Received');
});

/** True for a Firestore ALREADY_EXISTS error (gRPC status 6). */
function isAlreadyExists(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  return code === 6 || code === 'already-exists';
}
