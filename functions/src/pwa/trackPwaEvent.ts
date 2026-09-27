/**
 * App install tracking (docs/pwa.md).
 *
 * The browser reports four events, each at most once per device (opened from the
 * home screen: once a day):
 *
 *   prompt_shown       the install button or guide was shown
 *   installed          the app was installed (or first opened from the home screen)
 *   dismissed          the person said "not now"
 *   opened_installed   the app was opened from the home screen
 *
 * Each goes into a daily counter by platform, `PwaStats/{YYYY-MM-DD}`, which the
 * admin dashboard reads. For a signed-in person, `installed` and
 * `opened_installed` also mark their record (`pwa`), which gives the install rate.
 * Visitors who are not signed in are counted too: people often install before
 * signing in.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../init.js';
import { findUserByUid } from '../auth/accounts.js';

export const PWA_STATS = 'PwaStats';
export const PWA_EVENTS = ['prompt_shown', 'installed', 'dismissed', 'opened_installed'] as const;
export const PWA_PLATFORMS = ['android', 'ios', 'desktop'] as const;
export type PwaEvent = (typeof PWA_EVENTS)[number];
export type PwaPlatform = (typeof PWA_PLATFORMS)[number];

/** The day a counter belongs to, in UTC: `2026-10-11`. */
export function statsDay(now = new Date()): string {
    return now.toISOString().slice(0, 10);
}

/** The merge that counts one event on its day's document. */
export function statsUpdate(event: PwaEvent, platform: PwaPlatform, day: string): Record<string, unknown> {
    return {
        date: day,
        [event]: { total: FieldValue.increment(1), [platform]: FieldValue.increment(1) },
        updatedAt: FieldValue.serverTimestamp(),
    };
}

export const trackPwaEvent = onCall(async (request) => {
    const data = (request.data ?? {}) as { event?: unknown; platform?: unknown };
    const event = PWA_EVENTS.find((e) => e === data.event);
    const platform = PWA_PLATFORMS.find((p) => p === data.platform);
    if (!event || !platform) throw new HttpsError('invalid-argument', 'Unknown event or platform.');

    const day = statsDay();
    await db.collection(PWA_STATS).doc(day).set(statsUpdate(event, platform, day), { merge: true });

    const uid = request.auth?.uid;
    if (uid && (event === 'installed' || event === 'opened_installed')) {
        const record = await findUserByUid(uid);
        if (record) {
            const pwa = (record.data['pwa'] ?? {}) as { installed?: boolean };
            await record.ref.set({
                pwa: {
                    installed: true,
                    platform,
                    ...(pwa.installed ? {} : { installedAt: FieldValue.serverTimestamp() }),
                    ...(event === 'opened_installed' ? { lastOpenedAt: FieldValue.serverTimestamp() } : {}),
                },
            }, { merge: true });
        }
    }
    return { ok: true };
});
