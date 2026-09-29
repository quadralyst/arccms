/**
 * Send one SMS through the configured provider and record it in `SmsLogs`.
 *
 * Every message is logged, sent or not, so an admin can see what went out.
 * The log keeps the full text only for the `log` provider (nothing was sent,
 * and reading the code there is the point); for a real provider the code is
 * blanked out of the stored text.
 */
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import { maskPhone } from '../auth/phoneNumber.js';
import { SMS_PROVIDER_REGISTRY, type SmsMessage } from './providers.js';
import { readSmsSettings, type SmsSettings } from './smsSettings.js';

export const SMS_LOGS_COLLECTION = 'SmsLogs';

export interface SmsResult {
    status: 'logged' | 'sent' | 'failed';
    logId: string;
    error?: string;
}

/** The text as stored in the log. */
export function loggedText(message: SmsMessage, keepCode: boolean): string {
    if (keepCode || !message.code) return message.text;
    return message.text.split(message.code).join('••••••');
}

export async function sendSms(message: SmsMessage, settings?: SmsSettings): Promise<SmsResult> {
    const resolved = settings ?? (await readSmsSettings());
    const provider = SMS_PROVIDER_REGISTRY[resolved.provider];
    const ref = db.collection(SMS_LOGS_COLLECTION).doc();

    let status: SmsResult['status'] = provider.delivers ? 'sent' : 'logged';
    let error: string | undefined;
    let providerMessageId: string | undefined;
    try {
        ({ providerMessageId } = await provider.send(message, resolved));
    } catch (err) {
        status = 'failed';
        error = err instanceof Error ? err.message : String(err);
        logger.error(`sendSms: ${provider.id} failed for ${maskPhone(message.to)}: ${error}`);
    }

    await ref.set({
        to: message.to,
        purpose: message.purpose,
        provider: provider.id,
        text: loggedText(message, !provider.delivers),
        status,
        ...(error ? { error } : {}),
        ...(providerMessageId ? { providerMessageId } : {}),
        createdAt: Timestamp.now(),
    });

    return { status, logId: ref.id, ...(error ? { error } : {}) };
}
