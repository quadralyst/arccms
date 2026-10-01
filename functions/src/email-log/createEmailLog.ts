import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { sendMail } from '../mail-config/mailConfig.js';
import type { EmailLogData } from '../types.js';
import { arcDocument } from '../arc-config.js';
import { claimEmailSend } from '../email-core/claimEmailSend.js';

/**
 * Triggered when an EmailLog document is created.
 * Sends the email using the configured mail provider.
 */
export const onEmailLogCreate = onDocumentCreated(arcDocument('EmailLogs/{EmailLogsId}'), async (event) => {
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

  // A `sendNow` email (a sign-in code) is sent by the call that queued it; this
  // sends it only when that call did not claim it first.
  if ((emailLogsData as EmailLogData).sendNow && !(await claimEmailSend(emailLogsId))) {
    console.log(`onEmailLogCreate: ${emailLogsId} was sent by the call that queued it.`);
    return;
  }

  try {
    await sendMail(emailLogsData as EmailLogData, emailLogsId);
  } catch (error) {
    console.error(`Error sending email for log ${emailLogsId}:`, error);
  }
});
