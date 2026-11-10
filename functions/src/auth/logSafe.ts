/**
 * An email address as function logs may show it: never the address, only the start
 * of its hash, enough to match two log lines about the same person.
 */
import { computeEmailHash } from '../email-core/unsubscribeToken.js';

export function emailForLog(email: unknown): string {
    const text = typeof email === 'string' ? email : '';
    return text ? `email#${computeEmailHash(text).slice(0, 8)}` : 'no email';
}
