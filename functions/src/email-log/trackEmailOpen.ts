import { FieldValue } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { db } from '../init.js';

// 1x1 transparent GIF binary data (Base64 Encoding)
const transparentGif = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');

/**
 * Tracks email opens by serving a transparent 1x1 GIF pixel.
 * When an email client loads this image, we record the open event.
 */
export const trackEmailOpen = onRequest(async (request, response) => {
  // Set response headers for the GIF
  response.set('Content-Type', 'image/gif');
  response.set('Cache-Control', 'no-cache, no-store, must-revalidate');

  const emailId = request.query.emailId as string | undefined;

  if (!emailId) {
    logger.error('Tracking ID (emailId) missing from URL query.');
    response.status(400).send(transparentGif);
    return;
  }

  try {
    const docRef = db.collection('EmailLogs').doc(emailId);
    const docSnapshot = await docRef.get();

    if (!docSnapshot.exists) {
      logger.warn(`EmailLog document not found for ID: ${emailId}`);
      response.status(200).send(transparentGif);
      return;
    }

    const currentData = docSnapshot.data();

    // Skip if already marked as opened
    if (currentData?.isOpened === true) {
      logger.info(`Email ID ${emailId} already tracked as opened.`);
      response.status(200).send(transparentGif);
      return;
    }

    // Update the document to mark as opened
    await docRef.update({
      isOpened: true,
      openedAt: FieldValue.serverTimestamp(),
      ipAddress: request.ip,
    });

    logger.info(`Email ID ${emailId} tracked as opened. IP: ${request.ip}`);
    response.status(200).send(transparentGif);
  } catch (error) {
    logger.error(`Error tracking email ID ${emailId}:`, error);
    // Return success with pixel to avoid broken image in email
    response.status(200).send(transparentGif);
  }
});
