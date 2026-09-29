/**
 * The proof that a person verified a one-time code (review F).
 *
 * Verifying a code returns a random ticket to the browser that entered it, and
 * only its hash is stored with the code. The step that acts on the code
 * (create the account, set a new PIN, mark the email verified) needs the
 * ticket back. Without it, anyone who knew the number or address could use the
 * code in the minutes after its owner verified it, and sign in as them.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function newOtpTicket(): { ticket: string; ticketHash: string } {
    const ticket = randomBytes(24).toString('base64url');
    return { ticket, ticketHash: hashTicket(ticket) };
}

function hashTicket(ticket: string): string {
    return createHash('sha256').update(ticket).digest('hex');
}

/** Whether `ticket` is the one whose hash is stored. */
export function ticketMatches(ticket: unknown, storedHash: unknown): boolean {
    if (typeof ticket !== 'string' || !ticket || typeof storedHash !== 'string' || !storedHash) return false;
    const expected = Buffer.from(storedHash, 'hex');
    const actual = Buffer.from(hashTicket(ticket), 'hex');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
}
