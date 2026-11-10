/**
 * A daily limit on text messages for the whole site (Settings, SMS, "Texts a day"; 300
 * unless an admin changes it), so a flood of sign-in requests cannot run up the SMS bill.
 *
 * Texts are counted in one document per day, `_sms_daily/{YYYY-MM-DD}`, in a
 * transaction. A day is the site's (Settings, Localization's time zone, else UTC). Once
 * the day's count reaches the limit nothing more is sent until the next day, and the
 * admins are told once that day (notifyAdmins, `admin_sms_limit`). Only a provider that
 * really sends counts: the Test provider sends nothing.
 */
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import { getLocalizationSettings } from '../shared/site-settings.js';
import { siteTimeZone } from '../shared/time-zone.js';
import { notifyAdmins } from '../email-core/adminAlerts.js';

export const SMS_DAILY = '_sms_daily';
export const DEFAULT_SMS_DAILY_LIMIT = 300;
/** The highest limit the settings take. */
export const MAX_SMS_DAILY_LIMIT = 100_000;

/** The site's date at `now`, `YYYY-MM-DD`, in its time zone. */
export function siteDate(now: Date, timeZone: string): string {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now).map((p) => [p.type, p.value]));
    return `${parts['year']}-${parts['month']}-${parts['day']}`;
}

async function today(now: Date): Promise<string> {
    let zone = 'UTC';
    try {
        zone = siteTimeZone(await getLocalizationSettings());
    } catch {
        // UTC, as a site without a zone has.
    }
    return siteDate(now, zone);
}

/** One text counted (`release` gives it back), or the day's limit reached. */
export type DailySms = { ok: true; release: () => Promise<void> } | { ok: false };

/** Count one text against today's limit. The first refusal of the day tells the admins. */
export async function countDailySms(limit: number, now = new Date()): Promise<DailySms> {
    const day = await today(now);
    const ref = db.collection(SMS_DAILY).doc(day);
    const outcome = await db.runTransaction(async (tx) => {
        const data = (await tx.get(ref)).data() ?? {};
        const count = Number(data['count'] ?? 0);
        if (count >= limit) {
            if (data['alerted'] === true) return 'over';
            tx.set(ref, { alerted: true }, { merge: true });
            return 'first-over';
        }
        tx.set(ref, { day, count: count + 1, updatedAt: Timestamp.fromMillis(now.getTime()) }, { merge: true });
        return 'ok';
    });
    if (outcome === 'first-over') await alertAdmins(limit);
    if (outcome !== 'ok') return { ok: false };
    return {
        ok: true,
        release: async () => {
            try {
                await db.runTransaction(async (tx) => {
                    const count = Number((await tx.get(ref)).data()?.['count'] ?? 0);
                    if (count > 0) tx.update(ref, { count: count - 1 });
                });
            } catch (err) {
                logger.warn('sendSms: a text that was not sent was not given back to the daily count.', err);
            }
        },
    };
}

async function alertAdmins(limit: number): Promise<void> {
    logger.warn(`sendSms: the daily limit of ${limit} texts is reached; no more are sent today.`);
    await notifyAdmins('admin_sms_limit', {
        title: 'Text messages stopped for today',
        body: `The site sent ${limit} text messages today, its daily limit. No more go out until tomorrow, so signing in by text waits until then. To send more today, raise the limit in Settings, SMS.`,
        link: '/admin/settings/sms',
    });
}
