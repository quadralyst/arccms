import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { sendMail } from '../mail-config/mailConfig.js';
import type { EmailLogData } from '../types.js';

/**
 * Triggered when an EmailLog document is created.
 * Sends the email using the configured mail provider.
 */
export const onEmailLogCreate = onDocumentCreated('EmailLogs/{EmailLogsId}', async (event) => {
  const emailLogsData = event.data?.data();
  const emailLogsId = event.params.EmailLogsId;

  if (!emailLogsData) {
    console.error('No email log data found');
    return;
  }

  // Only newly-queued docs are sendable. queueEmail() writes blocked sends with
  // a terminal status (skipped/suppressed) and those must never be delivered.
  // Retries of retrying/deferred docs are handled by retryPendingEmails, not here.
  const status = (emailLogsData as EmailLogData).status;
  if (status && status !== 'pending') {
    console.log(`onEmailLogCreate: ${emailLogsId} has status '${status}', not sending.`);
    return;
  }

  try {
    await sendMail(emailLogsData as EmailLogData, emailLogsId);
  } catch (error) {
    console.error(`Error sending email for log ${emailLogsId}:`, error);
  }
});
