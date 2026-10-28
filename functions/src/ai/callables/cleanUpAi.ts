/**
 * Every day: AI records older than 60 days with their files, monthly totals older than 24
 * months, the allowance counters of months that are over, and keys whose connection is gone
 * (specs/ai-spec.md, AI-D12).
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { Timestamp } from 'firebase-admin/firestore';
import { arcStorageBucket } from '../../arc-config.js';
import { db, storage } from '../../init.js';
import { AI_KEYS } from '../keys.js';
import { AI_USAGE, currentSiteDay } from '../limits.js';
import { AI_CALLS, aiCallFolder, contentDoc, KEEP_DAYS } from '../records.js';
import { readAiSettings, forgetAiSettings } from '../settings.js';

export const KEEP_TOTALS_MONTHS = 24;
const BATCH = 300;

function bucket() {
    const name = arcStorageBucket();
    return name ? storage.bucket(name) : storage.bucket();
}

/** The month `back` months before `month` (yyyy-mm). */
export function monthsBefore(month: string, back: number): string {
    const [y, m] = month.split('-').map(Number);
    const total = y * 12 + (m - 1) - back;
    return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** Delete records older than 60 days, and the files kept beside them. */
export async function purgeAiCalls(now = new Date()): Promise<number> {
    const cutoff = Timestamp.fromDate(new Date(now.getTime() - KEEP_DAYS * 24 * 60 * 60 * 1000));
    let deleted = 0;
    for (;;) {
        const snap = await db.collection(AI_CALLS).where('createdAt', '<', cutoff).limit(BATCH).get();
        if (snap.empty) break;
        // A record that kept content has its files and its content document to go with it.
        await Promise.all(snap.docs.filter((d) => d.data()['hasContent']).map(async (d) => {
            await bucket().deleteFiles({ prefix: aiCallFolder(d.id) }).catch((err) => console.error(`cleanUpAi: files of ${d.id} not deleted`, err));
            await contentDoc(d.id).delete();
        }));
        const batch = db.batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        deleted += snap.size;
        if (snap.size < BATCH) break;
    }
    return deleted;
}

/** Delete totals older than 24 months, and the allowance counters of every month before this one. */
export async function purgeAiUsage(now = new Date()): Promise<void> {
    const { month } = await currentSiteDay(now);
    const oldest = monthsBefore(month, KEEP_TOTALS_MONTHS - 1);
    const months = await db.collection(AI_USAGE).listDocuments();
    for (const ref of months) {
        if (ref.id < oldest) await db.recursiveDelete(ref);
        else if (ref.id < month) await db.recursiveDelete(ref.collection('days'));
    }
}

/** Delete keys whose connection is no longer in Settings, AI. */
export async function purgeOrphanKeys(): Promise<number> {
    forgetAiSettings();
    const settings = await readAiSettings();
    const keys = await db.collection(AI_KEYS).listDocuments();
    const orphans = keys.filter((k) => !settings.connections[k.id]);
    await Promise.all(orphans.map((k) => k.delete()));
    return orphans.length;
}

export const cleanUpAi = onSchedule({ schedule: 'every day 03:15', timeZone: 'UTC' }, async () => {
    const records = await purgeAiCalls();
    await purgeAiUsage();
    const keys = await purgeOrphanKeys();
    console.log(`cleanUpAi: ${records} records and ${keys} unused keys deleted`);
});
