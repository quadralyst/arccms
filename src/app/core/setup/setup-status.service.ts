/**
 * Runs every setup item's check (setup-items.ts) and keeps the rows still pending, for
 * the dashboard's "Finish setting up" panel. Reads once each time it loads: the
 * panel is a pointer to Settings, not a live monitor.
 */
import { Injectable, Injector, PLATFORM_ID, inject, runInInjectionContext, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { CUSTOM_SETUP_ITEMS } from '../../../custom/setup-items';
import { isOn } from '../features/features';
import { orderRows, setupItemsFor, type SettingsReader, type SetupItem, type SetupRow } from './setup-items';

/** Each check's rows, in order; a check that throws is left out rather than raising a false alarm. */
export async function pendingRows(items: readonly SetupItem[], read: SettingsReader): Promise<SetupRow[]> {
    const results = await Promise.all(items.map(async (item) => {
        try {
            const need = await item.pending(read);
            return need ? { item, need } : null;
        } catch (error) {
            console.error(`Setup item "${item.id}" could not be checked:`, error);
            return null;
        }
    }));
    return orderRows(results.filter((r): r is SetupRow => r !== null));
}

/** A reader that asks for each Settings document once, however many items read it. */
export function onceEach(fetch: SettingsReader): SettingsReader {
    const cache = new Map<string, ReturnType<SettingsReader>>();
    return (id) => {
        if (!cache.has(id)) cache.set(id, fetch(id));
        return cache.get(id)!;
    };
}

@Injectable({ providedIn: 'root' })
export class SetupStatusService {
    private firestore = inject(Firestore);
    private injector = inject(Injector);
    private browser = isPlatformBrowser(inject(PLATFORM_ID));

    /** What is still to do, needed rows first. Empty until loaded. */
    readonly rows = signal<SetupRow[]>([]);
    /** True once a load has finished; the panel waits for it rather than flickering. */
    readonly loaded = signal(false);

    private items = setupItemsFor(CUSTOM_SETUP_ITEMS, isOn);

    /** Checks every item again. Server render: nothing, as the documents are admin-only. */
    async load(): Promise<void> {
        if (!this.browser) return;
        const read = onceEach(async (id) => {
            const snap = await runInInjectionContext(this.injector, () => getDoc(doc(this.firestore, 'Settings', id)));
            return snap.exists() ? snap.data() : undefined;
        });
        this.rows.set(await pendingRows(this.items, read));
        this.loaded.set(true);
    }
}
