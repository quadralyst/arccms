import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';

/**
 * Claim a `sendNow` email for sending (queueEmail's `sendNow`). Both the call
 * that queued it and onEmailLogCreate try to send it; only the first claim
 * wins, so it goes out once. The trigger's claim wins only when the call never
 * got to it (it failed between writing the log and sending).
 */
export async function claimEmailSend(id: string): Promise<boolean> {
  const ref = db.collection('EmailLogs').doc(id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (!snap.exists || !data || data['status'] !== 'pending' || data['sendClaimedAt']) return false;
    tx.update(ref, { sendClaimedAt: Timestamp.now() });
    return true;
  });
}
