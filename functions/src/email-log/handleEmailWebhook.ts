import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { db } from '../init.js';
import { computeEmailHash } from '../email-core/unsubscribeToken.js';
import { emitEmailOutcome } from '../email-core/appEmailOutcome.js';

interface EmailWebhookPayload {
  eventType?: string;
  type?: string;
  event?: string;
  mail?: {
    messageId: string;
    timestamp: string;
    destination?: string[];
  };
  data?: {
    messageId?: string;
    message_id?: string;
    /** Resend's id for the email. */
    email_id?: string;
    recipient?: string;
    email?: string;
    to?: string[];
    timestamp?: string;
    created_at?: string;
    bounce?: { type?: string; subType?: string; message?: string };
  };
  email?: string;
  messageId?: string;
  message_id?: string;
  timestamp?: string;
  delivery?: {
    timestamp: string;
    processingTimeMillis: number;
    recipients: string[];
  };
  bounce?: {
    bounceType: string;
    bounceSubType: string;
    bouncedRecipients: Array<{
      emailAddress: string;
      action?: string;
      status?: string;
      diagnosticCode?: string;
    }>;
  };
  complaint?: {
    complaintFeedbackType: string;
    complainedRecipients: Array<{ emailAddress: string }>;
  };
  Message?: string;
  SubscribeURL?: string;
}

export const handleEmailWebhook = onRequest(async (request, response) => {
  logger.info('Email webhook received');

  try {
    // Handle SNS subscription confirmation
    if (request.headers['x-amz-sns-message-type'] === 'SubscriptionConfirmation') {
      const body = request.body as EmailWebhookPayload;
      if (body.SubscribeURL) {
        logger.info('SNS Subscription confirmation received:', body.SubscribeURL);
        response.status(200).send('Subscription confirmation received');
        return;
      }
    }

    // Parse the SNS message
    let eventData: EmailWebhookPayload;

    if (request.body.Message) {
      try {
        eventData = JSON.parse(request.body.Message);
      } catch (parseError) {
        logger.error('Failed to parse SNS Message:', parseError);
        response.status(400).send('Invalid SNS message format');
        return;
      }
    } else {
      eventData = request.body;
    }

    if (!eventData) {
      logger.error('No event data found');
      response.status(400).send('No event data');
      return;
    }

    // Handle different webhook formats
    let eventType: string | undefined;
    let messageId: string | undefined;
    let recipientEmail: string | undefined;

    // AWS SES format
    if (eventData.eventType && eventData.mail) {
      eventType = eventData.eventType;
      messageId = eventData.mail.messageId;
      recipientEmail = eventData.mail.destination?.[0];
    }
    // Alternative format, Resend's included (`email.bounced`, data.email_id, data.to)
    else if (eventData.type && eventData.data) {
      eventType = eventData.type.replace(/^email\./, '');
      messageId = eventData.data.messageId || eventData.data.message_id || eventData.data.email_id;
      recipientEmail = eventData.data.recipient || eventData.data.email || eventData.data.to?.[0];
    }
    // Direct format
    else if (eventData.event && eventData.email) {
      eventType = eventData.event;
      recipientEmail = eventData.email;
      messageId = eventData.messageId || eventData.message_id;
    } else {
      logger.error('Unknown webhook payload structure');
      response.status(400).send('Unknown payload structure');
      return;
    }

    if (!eventType) {
      logger.error('No event type found in payload');
      response.status(400).send('No event type');
      return;
    }
    // AWS SES names events in capitals (Bounce, Delivery, Complaint).
    eventType = eventType.toLowerCase();

    logger.info(`Processing webhook - eventType: ${eventType}, messageId: ${messageId}, recipient: ${recipientEmail}`);

    // Find email log by messageId first
    let emailLogDoc;
    // Only a log found by the provider's message id may suppress an address: the
    // match by address and time below could be faked by anyone who reaches this URL.
    let matchedByMessageId = false;
    if (messageId) {
      const messageIdQuery = await db.collection('EmailLogs').where('messageId', '==', messageId).limit(1).get();
      if (!messageIdQuery.empty) {
        emailLogDoc = messageIdQuery.docs[0];
        matchedByMessageId = true;
      }
    }

    // Fallback: find by recipient email and timestamp
    if (!emailLogDoc && recipientEmail) {
      const timestamp = eventData.mail?.timestamp || eventData.timestamp || eventData.data?.timestamp || new Date().toISOString();
      const emailTimestamp = new Date(timestamp);
      const twentyFourHoursAgo = new Date(emailTimestamp.getTime() - 24 * 60 * 60 * 1000);

      const emailLogQuery = await db
        .collection('EmailLogs')
        .where('toEmail', '==', recipientEmail)
        .where('createdAt', '>=', twentyFourHoursAgo)
        .orderBy('createdAt', 'desc')
        .limit(5)
        .get();

      if (!emailLogQuery.empty) {
        if (emailLogQuery.docs.length === 1) {
          emailLogDoc = emailLogQuery.docs[0];
        } else {
          // Find closest timestamp match
          let closestDoc = emailLogQuery.docs[0];
          let closestTimeDiff = Math.abs(emailTimestamp.getTime() - (closestDoc.data().createdAt?.toDate()?.getTime() || 0));

          for (const doc of emailLogQuery.docs) {
            const docTimestamp = doc.data().createdAt?.toDate();
            if (docTimestamp) {
              const timeDiff = Math.abs(emailTimestamp.getTime() - docTimestamp.getTime());
              if (timeDiff < closestTimeDiff) {
                closestTimeDiff = timeDiff;
                closestDoc = doc;
              }
            }
          }
          emailLogDoc = closestDoc;
        }
      }
    }

    if (!emailLogDoc) {
      logger.warn(`No EmailLog found for messageId: ${messageId} or recipient: ${recipientEmail}`);
      response.status(200).send('Email log not found');
      return;
    }

    const updateData: Record<string, unknown> = {
      lastWebhookEvent: eventType,
      lastWebhookAt: FieldValue.serverTimestamp(),
    };

    // Handle different event types
    switch (eventType) {
      case 'send':
      case 'sent':
        updateData.status = 'sent';
        updateData.sentAt = FieldValue.serverTimestamp();
        break;

      case 'delivery':
      case 'delivered':
        updateData.status = 'delivered';
        updateData.deliveredAt = FieldValue.serverTimestamp();
        if (eventData.delivery) {
          updateData.deliveryDetails = {
            timestamp: eventData.delivery.timestamp,
            processingTimeMillis: eventData.delivery.processingTimeMillis,
            recipients: eventData.delivery.recipients,
          };
        }
        break;

      case 'bounce':
      case 'bounced':
        updateData.status = 'bounced';
        updateData.bouncedAt = FieldValue.serverTimestamp();
        if (eventData.bounce) {
          updateData.bounceDetails = {
            bounceType: eventData.bounce.bounceType,
            bounceSubType: eventData.bounce.bounceSubType,
            bouncedRecipients: eventData.bounce.bouncedRecipients,
          };
          if (eventData.bounce.bounceType === 'Permanent') {
            updateData.isHardBounce = true;
          }
        } else if (eventData.data) {
          updateData.bounceDetails = eventData.data;
        }
        break;

      case 'complaint':
      case 'complained':
        updateData.status = 'complained';
        updateData.complainedAt = FieldValue.serverTimestamp();
        if (eventData.complaint) {
          updateData.complaintDetails = {
            complaintFeedbackType: eventData.complaint.complaintFeedbackType,
            complainedRecipients: eventData.complaint.complainedRecipients,
          };
        } else if (eventData.data) {
          updateData.complaintDetails = eventData.data;
        }
        break;

      case 'reject':
        updateData.status = 'rejected';
        updateData.rejectedAt = FieldValue.serverTimestamp();
        break;

      default:
        logger.warn(`Unknown event type: ${eventType}`);
        updateData.status = 'unknown_event';
        updateData.unknownEventData = eventData;
    }

    // Update the email log document
    await emailLogDoc.ref.update(updateData);

    // A hard bounce or a complaint stops mail to the address (specs/app-email-spec.md,
    // AE-D9): queueEmail's suppression gate blocks the next send, transactional too.
    const log = emailLogDoc.data() as Record<string, unknown>;
    const suppressAs = suppressionReason(updateData);
    const address = String(log['toEmail'] || recipientEmail || '');
    if (suppressAs && matchedByMessageId && address) {
      const emailHash = computeEmailHash(address);
      await db.collection('Suppression').doc(emailHash).set(
        { email: address.trim().toLowerCase(), emailHash, reason: suppressAs, at: Timestamp.now(), logId: emailLogDoc.id },
        { merge: true },
      );
    }
    if (updateData.status === 'bounced') {
      await emitEmailOutcome(emailLogDoc.id, { ...log, status: 'bounced' }, { reason: bounceReason(updateData) });
    }

    logger.info(`Email webhook processed for messageId: ${messageId}, eventType: ${eventType}`);
    response.status(200).send('Webhook processed successfully');
  } catch (error) {
    logger.error('Error processing email webhook:', error);
    response.status(500).send('Internal server error');
  }
});

/**
 * The Suppression reason a webhook event means, or null: a hard bounce (AWS's
 * Permanent, or a bounce that names no type, as Resend's do) is `bounce`, a
 * complaint is `complaint`. A soft bounce (mailbox full) suppresses nothing.
 */
export function suppressionReason(update: Record<string, unknown>): 'bounce' | 'complaint' | null {
  if (update['status'] === 'complained') return 'complaint';
  if (update['status'] !== 'bounced') return null;
  const details = update['bounceDetails'] as { bounceType?: string; bounce?: { type?: string } } | undefined;
  const type = details?.bounceType ?? details?.bounce?.type;
  return !type || /^(permanent|hard)/i.test(type) ? 'bounce' : null;
}

/** What a bounce event says about why, for the app's email.bounced event. */
function bounceReason(update: Record<string, unknown>): string {
  const details = update['bounceDetails'] as { bounceType?: string; bounceSubType?: string; bounce?: { type?: string; message?: string } } | undefined;
  return [details?.bounceType ?? details?.bounce?.type, details?.bounceSubType ?? details?.bounce?.message].filter(Boolean).join(': ') || 'bounced';
}
