import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';

/**
 * The outcome of an app's email, back to the app (specs/app-email-spec.md, AE-D11).
 * When a log whose source is `app` is sent, fails for good (or is blocked) or
 * bounces, an `AppEvents` entry says so with the app's reference, so the app's own
 * trigger can show "Sent" or "Not delivered" on its screen:
 *
 *   email.sent     { logId, ref, to, template, simulated? }
 *   email.failed   { logId, ref, to, template, reason }
 *   email.bounced  { logId, ref, to, template, reason }
 *
 * Written like emitAppEvent (appEvents.ts) with the id `{type}__{logId}`, so one log
 * gives each event once however often a send is retried or a webhook repeats. Not
 * through emitAppEvent itself: appEvents.ts queues email, and this runs inside sending.
 */

export const APP_EMAIL_EVENTS = ['email.sent', 'email.failed', 'email.bounced'] as const;
export type AppEmailEvent = (typeof APP_EMAIL_EVENTS)[number];

/** The event a log's status stands for, or null while it is still on its way. */
export function outcomeEvent(status: unknown): AppEmailEvent | null {
  if (status === 'success') return 'email.sent';
  if (status === 'failed' || status === 'skipped' || status === 'suppressed') return 'email.failed';
  if (status === 'bounced') return 'email.bounced';
  return null;
}

/**
 * Write the outcome event for an app email's log, as it now stands. Does nothing
 * for core's emails or a log still on its way. A failure is logged, never thrown:
 * the email's own record must not be lost over its event.
 */
export async function emitEmailOutcome(logId: string, log: Record<string, unknown>, extra: { reason?: string } = {}): Promise<void> {
  if (log['source'] !== 'app') return;
  const type = outcomeEvent(log['status']);
  if (!type) return;
  const reason = extra.reason ?? (typeof log['skipReason'] === 'string' ? log['skipReason'] : undefined)
    ?? (typeof log['errorMessage'] === 'string' ? log['errorMessage'] : undefined);
  const data: Record<string, unknown> = {
    logId,
    ref: log['appRef'] ?? null,
    to: log['toEmail'] ?? '',
    template: log['appTemplate'] ?? null,
  };
  if (type !== 'email.sent' && reason) data['reason'] = String(reason).slice(0, 500);
  if (type === 'email.sent' && log['logOnly'] === true) data['simulated'] = true;
  try {
    await db.collection('AppEvents').doc(`${type}__${logId}`).create({ type, createdAt: Timestamp.now(), processed: false, data });
  } catch (err) {
    // 6 = ALREADY_EXISTS: this outcome was written before.
    if ((err as { code?: unknown }).code !== 6) console.error(`emitEmailOutcome: ${type} for ${logId} not written`, err);
  }
}
