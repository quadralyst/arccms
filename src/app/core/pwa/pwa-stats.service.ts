import { inject, Injectable, Injector, runInInjectionContext, signal } from '@angular/core';
import { Firestore, collection, getCountFromServer, getDocs, query, where } from '@angular/fire/firestore';
import type { PwaPlatform } from './pwa-platform';

/** One day's counters, `PwaStats/{YYYY-MM-DD}` (functions/src/pwa/trackPwaEvent.ts). */
type DayCounters = Partial<Record<'installed' | 'opened_installed', Partial<Record<'total' | PwaPlatform, number>>>>;

export interface PwaInstallSummary {
    /** Installs in the period, and by platform. */
    installs: number;
    byPlatform: Record<PwaPlatform, number>;
    /** Opens from the home screen in the period (each device once a day). */
    opened: number;
    /** People whose record says they installed, of everyone with a record. */
    installedUsers: number;
    totalUsers: number;
    /** installedUsers as a whole percentage of totalUsers. */
    rate: number;
}

export const STATS_DAYS = 30;

/** Adds up the daily counters and works out the install rate. */
export function summarise(days: DayCounters[], installedUsers: number, totalUsers: number): PwaInstallSummary {
    const byPlatform: Record<PwaPlatform, number> = { android: 0, ios: 0, desktop: 0 };
    let installs = 0;
    let opened = 0;
    for (const day of days) {
        installs += day.installed?.total ?? 0;
        opened += day.opened_installed?.total ?? 0;
        for (const platform of Object.keys(byPlatform) as PwaPlatform[]) {
            byPlatform[platform] += day.installed?.[platform] ?? 0;
        }
    }
    const rate = totalUsers ? Math.round((installedUsers / totalUsers) * 100) : 0;
    return { installs, byPlatform, opened, installedUsers, totalUsers, rate };
}

/** The first day of the period, as the counters name it: `2026-09-28`. */
export function periodStart(now = new Date(), days = STATS_DAYS): string {
    return new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** The admin dashboard's "App installs" numbers (docs/features/pwa.html). */
@Injectable({ providedIn: 'root' })
export class PwaStatsService {
    private firestore = inject(Firestore);
    private injector = inject(Injector);

    readonly summary = signal<PwaInstallSummary | null>(null);

    async load(): Promise<void> {
        const run = <T>(fn: () => T) => runInInjectionContext(this.injector, fn);
        try {
            const users = collection(this.firestore, 'users');
            const [days, installed, total] = await Promise.all([
                run(() => getDocs(query(collection(this.firestore, 'PwaStats'), where('date', '>=', periodStart())))),
                run(() => getCountFromServer(query(users, where('pwa.installed', '==', true)))),
                run(() => getCountFromServer(users)),
            ]);
            this.summary.set(summarise(
                days.docs.map((d) => d.data() as DayCounters),
                installed.data().count,
                total.data().count,
            ));
        } catch (err) {
            console.error('Could not load the app install numbers:', err);
        }
    }
}
