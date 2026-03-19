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

  try {
    await sendMail(emailLogsData as EmailLogData, emailLogsId);
  } catch (error) {
    console.error(`Error sending email for log ${emailLogsId}:`, error);
  }
});
