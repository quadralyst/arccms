/**
 * The per-key daily allowance and the monthly budget (specs/ai-spec.md, AI-D14). A day and
 * a month are the site's (Settings, Localization's time zone), so "20 a day" ends at the
 * site's midnight. Allowances are counted before the call and given back when it fails
 * before a provider answered: one that answered was paid for, so it counts.
 */
import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../init.js';
import { getLocalizationSettings } from '../shared/site-settings.js';
import { siteTimeZone } from '../shared/time-zone.js';
import type { AiSettings } from './settings.js';

export const AI_USAGE = 'AiUsage';

export interface SiteDay {
    /** `2026-10`. */
    month: string;
    /** `28`. */
    day: string;
    /** Seconds until the site's next day. */
    secondsLeftToday: number;
    /** Seconds until the site's next month. */
    secondsLeftThisMonth: number;
}

/** The site's day and month at `now`, in its time zone. */
export function siteDay(now: Date, timeZone: string): SiteDay {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(now).map((p) => [p.type, p.value]));
    const y = Number(parts['year']);
    const m = Number(parts['month']);
    const d = Number(parts['day']);
    const elapsed = Number(parts['hour']) * 3600 + Number(parts['minute']) * 60 + Number(parts['second']);
    const secondsLeftToday = Math.max(1, 86_400 - elapsed);
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return {
        month: `${y}-${String(m).padStart(2, '0')}`,
        day: String(d).padStart(2, '0'),
        secondsLeftToday,
        secondsLeftThisMonth: secondsLeftToday + (daysInMonth - d) * 86_400,
    };
}

/** The site's day now. */
export async function currentSiteDay(now = new Date()): Promise<SiteDay> {
    let zone = 'UTC';
    try {
        zone = siteTimeZone(await getLocalizationSettings());
    } catch {
        // UTC, as a site without a zone has.
    }
    return siteDay(now, zone);
}

/** A key's short, stable id in document ids: the key itself is kept as a field. */
export function keyId(limitKey: string): string {
    return createHash('sha256').update(limitKey).digest('hex').slice(0, 24);
}

/** `release()` gives back every unit counted; `release(n)` gives back n of them. */
export type AllowanceUse = { ok: true; release: (units?: number) => Promise<void> } | { ok: false; wait: number };

/** Count `units` against a key's allowance for a purpose today, or say how long until it renews. */
export async function consumeAllowance(purpose: string, limitKey: string, units: number, perDay: number, now = new Date()): Promise<AllowanceUse> {
    const day = await currentSiteDay(now);
    const ref = db.collection(AI_USAGE).doc(day.month).collection('days').doc(`${day.day}__${purpose}__${keyId(limitKey)}`);
    const allowed = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const used = Number(snap.data()?.['units'] ?? 0);
        if (used + units > perDay) return false;
        tx.set(ref, { purpose, limitKey, day: `${day.month}-${day.day}`, units: used + units }, { merge: true });
        return true;
    });
    if (!allowed) return { ok: false, wait: day.secondsLeftToday };
    return {
        ok: true,
        release: async (back = units) => {
            try {
                await ref.update({ units: FieldValue.increment(-Math.min(units, Math.max(0, back))) });
            } catch (err) {
                console.error(`askAi: ${units} units of ${purpose} were not given back`, err);
            }
        },
    };
}

/** Whether the month's budget has room, from the month's cost so far. */
export async function checkBudget(settings: AiSettings, now = new Date()): Promise<{ ok: true; spent: number } | { ok: false; wait: number }> {
    const day = await currentSiteDay(now);
    const snap = await db.collection(AI_USAGE).doc(day.month).get();
    const spent = Number(snap.data()?.['costUsd'] ?? 0);
    return spent < settings.budget.monthlyUsd ? { ok: true, spent } : { ok: false, wait: day.secondsLeftThisMonth };
}

/** How much of a key's allowance for a purpose is used today, for a "left today" line. */
export async function allowanceUsed(purpose: string, limitKey: string, now = new Date()): Promise<number> {
    const day = await currentSiteDay(now);
    const snap = await db.collection(AI_USAGE).doc(day.month).collection('days').doc(`${day.day}__${purpose}__${keyId(limitKey)}`).get();
    return Math.max(0, Number(snap.data()?.['units'] ?? 0));
}

/** The month's cost so far, for a "left this month" line. */
export async function monthSpent(now = new Date()): Promise<number> {
    const day = await currentSiteDay(now);
    const snap = await db.collection(AI_USAGE).doc(day.month).get();
    return Number(snap.data()?.['costUsd'] ?? 0);
}
