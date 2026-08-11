import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import type { EmailSettings } from '../types.js';
import { verifyUnsubscribeToken } from './unsubscribeToken.js';
import { setContactConsent, getContactConsent } from './contacts.js';

/**
 * Public preference center (spec §Phase-3.4): `/email-preferences?e={hash}&t={hmac}`.
 *
 * Shows the recipient's current marketing consent and lets them toggle it — no
 * Firestore access from the client, works for non-user contacts. Notification
 * per-type toggles are layered on in Phase 5.
 *
 * `?action=unsubscribe` / `?action=subscribe` applies the change (idempotent),
 * keeping `Contacts.consent` and the `Suppression` list in agreement.
 */
export const handleEmailPreferences = onRequest(async (req, res) => {
  const emailHash = String(req.query['e'] || '');
  const token = String(req.query['t'] || '');
  const action = String(req.query['action'] || '');

  const settings = await readEmailSettings();
  const secret = settings?.unsubscribeSecret;

  if (!verifyUnsubscribeToken(emailHash, token, secret || '')) {
    logger.warn('handleEmailPreferences: invalid token');
    res.status(400).send(renderPage({ state: 'invalid' }));
    return;
  }

  const email = await recoverEmail(emailHash);

  try {
    if (action === 'unsubscribe') {
      await setContactConsent(emailHash, 'unsubscribed', email);
      await db.collection('Suppression').doc(emailHash).set(
        { email, emailHash, reason: 'unsubscribe', at: Timestamp.now() },
        { merge: true },
      );
    } else if (action === 'subscribe') {
      await setContactConsent(emailHash, 'subscribed', email);
      // Only lift a self-service unsubscribe — never a hard bounce/complaint.
      const supp = await db.collection('Suppression').doc(emailHash).get();
      if (supp.exists && supp.data()?.['reason'] === 'unsubscribe') {
        await db.collection('Suppression').doc(emailHash).delete();
      }
    }
  } catch (err) {
    logger.error('handleEmailPreferences: failed to apply action', err);
    res.status(500).send(renderPage({ state: 'error' }));
    return;
  }

  const consent = (await getContactConsent(emailHash)) || 'subscribed';
  res.status(200).send(renderPage({ state: 'ok', subscribed: consent === 'subscribed', emailHash, token }));
});

async function recoverEmail(emailHash: string): Promise<string> {
  try {
    const snap = await db.collection('Contacts').doc(emailHash).get();
    if (snap.exists && snap.data()?.['email']) return snap.data()!['email'];
  } catch { /* ignore */ }
  try {
    const logSnap = await db.collection('EmailLogs').where('emailHash', '==', emailHash).limit(1).get();
    if (!logSnap.empty) return (logSnap.docs[0].data()['toEmail'] as string) || '';
  } catch { /* ignore */ }
  return '';
}

async function readEmailSettings(): Promise<EmailSettings | undefined> {
  try {
    const snap = await db.collection('Settings').doc('email').get();
    return snap.data() as EmailSettings | undefined;
  } catch (err) {
    logger.error('handleEmailPreferences: failed to read Settings/email', err);
    return undefined;
  }
}

function renderPage(opts: {
  state: 'ok' | 'invalid' | 'error';
  subscribed?: boolean;
  emailHash?: string;
  token?: string;
}): string {
  if (opts.state === 'invalid' || opts.state === 'error') {
    const title = opts.state === 'invalid' ? 'Invalid link' : 'Something went wrong';
    const body =
      opts.state === 'invalid'
        ? 'This preferences link appears to be invalid or expired.'
        : 'We were unable to update your preferences. Please try again later.';
    return page(title, `<p>${body}</p>`);
  }

  const q = `e=${opts.emailHash}&t=${opts.token}`;
  const status = opts.subscribed
    ? `<p><strong>You are subscribed</strong> to marketing emails.</p>
       <a class="btn danger" href="?${q}&action=unsubscribe">Unsubscribe from marketing</a>`
    : `<p><strong>You are unsubscribed</strong> from marketing emails. You still receive essential messages (like receipts).</p>
       <a class="btn primary" href="?${q}&action=subscribe">Re-subscribe to marketing</a>`;
  return page('Email preferences', status);
}

function page(title: string, inner: string): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex"/><title>${title}</title>
<style>
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    background:linear-gradient(135deg,#f6f8fb,#eef1f5);min-height:100vh;display:flex;
    align-items:center;justify-content:center;padding:20px;}
  .card{background:#fff;border-radius:16px;padding:44px 40px;max-width:520px;width:100%;
    box-shadow:0 4px 20px rgba(0,0,0,.08);text-align:center;}
  h1{font-size:1.4rem;color:#1a202c;margin:0 0 18px;}
  p{color:#475569;line-height:1.6;margin:0 0 18px;}
  .btn{display:inline-block;padding:12px 22px;border-radius:8px;font-weight:600;
    text-decoration:none;margin-top:8px;}
  .btn.primary{background:#3b82f6;color:#fff;}
  .btn.danger{background:#fee2e2;color:#b91c1c;}
</style></head>
<body><div class="card"><h1>${title}</h1>${inner}</div></body></html>`;
}
