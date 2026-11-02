/**
 * Every day: AI records older than 60 days with their files, monthly totals older than 24
 * months, the allowance counters of months that are over, and keys whose connection is gone
 * (specs/ai-spec.md, AI-D12); files left in `ai-files/` past their purpose's days, test files
 * after a day, cache entries past their days, and each connection's balance where its key
 * can read one (specs/ai-media-spec.md, AM-D10, AM-D16, AM-D32).
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { Timestamp } from 'firebase-admin/firestore';
import { arcStorageBucket } from '../../arc-config.js';
import { db, storage } from '../../init.js';
import { AI_JOBS } from '../jobs.js';
import { AI_KEYS } from '../keys.js';
import { AI_USAGE, currentSiteDay } from '../limits.js';
import { AI_CALLS, aiCallFolder, contentDoc, KEEP_DAYS } from '../records.js';
import { readAiSettings, forgetAiSettings, purposeSettings } from '../settings.js';
import { refreshBalance } from '../balances.js';
import { purgeAiCache } from '../cache.js';
import { purgeAiFiles } from '../files.js';
import { findPreset } from '../presets.js';
import { aiPurposes, isFileKind, purposeKind, MEDIA_IMAGE_PURPOSE } from '../purposes.js';

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

/** Delete long jobs that ended more than KEEP_DAYS ago, with their records' time (AM-D12). */
export async function purgeAiJobs(now = new Date()): Promise<number> {
    const cutoff = Timestamp.fromMillis(now.getTime() - KEEP_DAYS * 86_400_000);
    const old = await db.collection(AI_JOBS).where('endedAt', '<', cutoff).limit(500).get();
    await Promise.all(old.docs.map((d) => d.ref.delete()));
    return old.size;
}

/** Each file purpose's days before its files in `ai-files/` go: the admin's, else the purpose's. */
export async function fileDaysByPurpose(): Promise<Record<string, number>> {
    const settings = await readAiSettings();
    const days: Record<string, number> = {};
    for (const [id, p] of Object.entries(aiPurposes())) {
        if (!isFileKind(purposeKind(p))) continue;
        const d = purposeSettings(settings, id).deleteAfterDays ?? p.deleteAfterDays;
        if (d) days[id] = d;
    }
    // An app purpose offered in the Media Manager keeps its tab's pictures in ai-files/ (never
    // its saveTo): without days of its own, they go when Media image's would (AM-D20).
    const media = days[MEDIA_IMAGE_PURPOSE];
    for (const [id, p] of Object.entries(aiPurposes())) {
        if (p.mediaManager === true && days[id] === undefined && media) days[id] = media;
    }
    return days;
}

/** Read every connection's balance that its key can read; one failing never stops the others. */
export async function refreshBalances(): Promise<number> {
    forgetAiSettings();
    const settings = await readAiSettings();
    let read = 0;
    for (const connection of Object.values(settings.connections)) {
        if (!findPreset(connection.preset)?.balance || !connection.keyPreview) continue;
        const r = await refreshBalance(connection).catch((err: unknown) => ({ ok: false as const, detail: String(err) }));
        if (r.ok) read++;
        else console.log(`cleanUpAi: the balance of ${connection.id} was not read: ${r.detail}`);
    }
    return read;
}

export const cleanUpAi = onSchedule({ schedule: 'every day 03:15', timeZone: 'UTC' }, async () => {
    const records = await purgeAiCalls();
    await purgeAiUsage();
    const keys = await purgeOrphanKeys();
    await purgeAiJobs().catch((err: unknown) => console.error('cleanUpAi: jobs not purged', err));
    const files = await purgeAiFiles(await fileDaysByPurpose()).catch((err: unknown) => (console.error('cleanUpAi: files not purged', err), 0));
    const cached = await purgeAiCache().catch((err: unknown) => (console.error('cleanUpAi: cache not purged', err), 0));
    const balances = await refreshBalances().catch((err: unknown) => (console.error('cleanUpAi: balances not read', err), 0));
    console.log(`cleanUpAi: ${records} records, ${keys} unused keys, ${files} files and ${cached} cache entries deleted; ${balances} balances read`);
});
