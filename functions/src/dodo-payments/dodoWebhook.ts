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

  // Verify signature against the configured webhook secret.
  let payload: DodoWebhookPayload;
  try {
    const settings = await getDodoSettings();
    if (!settings.webhookSecret) {
      logger.error('Dodo webhook secret is not configured');
      response.status(500).send('Webhook not configured');
      return;
    }
    const client = buildDodoClient(settings);
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
    logger.info(`Dodo webhook ${webhookId} already recorded; skipping.`);
    response.status(200).send('Already processed');
    return;
  }

  response.status(200).send('Received');
});
