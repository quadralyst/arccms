import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import type { EmailSettings } from '../types.js';
import { verifyUnsubscribeToken } from './unsubscribeToken.js';
import { setContactConsent } from './contacts.js';
import { exitAllEnrollments } from './dripEnrollment.js';

/**
 * One-click unsubscribe endpoint: `/unsubscribe?e={emailHash}&t={hmac}`.
 *
 * - GET  → validates the token, unsubscribes the recipient, returns an HTML
 *          confirmation page (the link a human clicks in the email footer).
 * - POST → RFC 8058 one-click (`List-Unsubscribe-Post: List-Unsubscribe=One-Click`);
 *          same processing, returns 200 with no page.
 *
 * The token is an HMAC of the emailHash under `Settings/email.unsubscribeSecret`,
 * so links can't be forged and work for non-user contacts too (no Firestore
 * access from the client). This replaces the old empty-userId unsubscribe link.
 */
export const handleUnsubscribe = onRequest(async (req, res) => {
  const emailHash = String(req.query['e'] || (req.body && req.body.e) || '');
  const token = String(req.query['t'] || (req.body && req.body.t) || '');
  const isPost = req.method === 'POST';

  const settings = await readEmailSettings();
  const secret = settings?.unsubscribeSecret;

  if (!verifyUnsubscribeToken(emailHash, token, secret || '')) {
    logger.warn('handleUnsubscribe: invalid or unverifiable token');
    if (isPost) {
      res.status(400).send('invalid token');
      return;
    }
    res.status(400).send(renderPage('invalid'));
    return;
  }

  try {
    await unsubscribeByEmailHash(emailHash);
  } catch (err) {
    logger.error('handleUnsubscribe: failed to process unsubscribe', err);
    if (isPost) {
      res.status(500).send('error');
      return;
    }
    res.status(500).send(renderPage('error'));
    return;
  }

  if (isPost) {
    res.status(200).send('unsubscribed');
    return;
  }
  res.status(200).send(renderPage('success'));
});

/**
 * Suppress future email for a recipient and flip legacy `isSubscribed` flags.
 * Idempotent: safe to call repeatedly.
 *
 * Exported so the legacy `/unsubscribe/:waitlistId/:userId` links (already sitting
 * in inboxes, and unable to carry an HMAC token) can reach the identical logic via
 * a callable instead of writing consent from the browser (U5).
 */
export async function unsubscribeByEmailHash(emailHash: string): Promise<void> {
  // Recover the raw email from the recipient's most recent EmailLogs doc.
  // Used to populate the Suppression record and to locate waitlist docs.
  let email = '';
  try {
    const logSnap = await db
      .collection('EmailLogs')
      .where('emailHash', '==', emailHash)
      .limit(1)
      .get();
    if (!logSnap.empty) {
      email = (logSnap.docs[0].data()['toEmail'] as string) || '';
    }
  } catch (err) {
    logger.warn('handleUnsubscribe: could not recover email from EmailLogs', err);
  }

  // Durable enforcement: a Suppression doc keyed by emailHash is what
  // queueEmail checks on every future send.
  await db.collection('Suppression').doc(emailHash).set(
    {
      email,
      emailHash,
      reason: 'unsubscribe',
      at: Timestamp.now(),
    },
    { merge: true },
  );

  // Update the unified Contacts consent (Phase 3) so the preference center and
  // marketing gate agree. Non-fatal if the contact doesn't exist yet.
  try {
    await setContactConsent(emailHash, 'unsubscribed', email || undefined);
  } catch (err) {
    logger.warn('handleUnsubscribe: could not update Contact consent', err);
  }

  // Unsubscribing exits all active drip enrollments (D4).
  try {
    await exitAllEnrollments(emailHash, 'unsubscribed');
  } catch (err) {
    logger.warn('handleUnsubscribe: could not exit drip enrollments', err);
  }

  // Best-effort: keep legacy waitlist readers in sync (isSubscribed:false).
  if (email) {
    try {
      const snap = await db
        .collection('WaitlistedUsers')
        .where('email', '==', email)
        .get();
      await Promise.all(snap.docs.map((d) => d.ref.update({ isSubscribed: false })));
    } catch (err) {
      logger.warn('handleUnsubscribe: could not update WaitlistedUsers', err);
    }

    try {
      const subSnap = await db
        .collectionGroup('users')
        .where('email', '==', email)
        .get();
      await Promise.all(subSnap.docs.map((d) => d.ref.update({ isSubscribed: false })));
    } catch (err) {
      logger.warn('handleUnsubscribe: could not update waitlist subcollection users', err);
    }
  }
}

async function readEmailSettings(): Promise<EmailSettings | undefined> {
  try {
    const snap = await db.collection('Settings').doc('email').get();
    return snap.data() as EmailSettings | undefined;
  } catch (err) {
    logger.error('handleUnsubscribe: failed to read Settings/email', err);
    return undefined;
  }
}

function renderPage(kind: 'success' | 'invalid' | 'error'): string {
  const content: Record<typeof kind, { icon: string; title: string; body: string }> = {
    success: {
      icon: '✓',
      title: 'Successfully Unsubscribed',
      body: 'You have been removed from our mailing list. You may still receive essential transactional messages (such as receipts).',
    },
    invalid: {
      icon: '❌',
      title: 'Invalid Unsubscribe Link',
      body: 'This unsubscribe link appears to be invalid or expired.',
    },
    error: {
      icon: '⚠',
      title: 'Something went wrong',
      body: 'We were unable to process your unsubscribe request. Please try again later.',
    },
  };
  const c = content[kind];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${c.title}</title>
<style>
  body { margin:0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: linear-gradient(135deg, #f6f8fb 0%, #eef1f5 100%); min-height:100vh;
    display:flex; align-items:center; justify-content:center; padding:20px; }
  .card { background:#fff; border-radius:16px; padding:50px 40px; text-align:center;
    max-width:500px; width:100%; box-shadow:0 4px 20px rgba(0,0,0,.08); }
  .icon { font-size:4rem; margin-bottom:20px; }
  h1 { font-size:1.5rem; font-weight:700; margin:0 0 15px; color:#1a202c; }
  p { color:#64748b; margin:0; line-height:1.5; }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">${c.icon}</div>
    <h1>${c.title}</h1>
    <p>${c.body}</p>
  </div>
</body>
</html>`;
}
