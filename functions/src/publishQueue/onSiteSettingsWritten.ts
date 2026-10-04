import { Timestamp } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { db } from '../init.js';
import { arcDocument, arcHostingSite } from '../arc-config.js';

/**
 * The Settings documents the published home page is built from: the site's name,
 * description, logo and address (`about`, `site`), its languages (`localization`)
 * and the powered-by line (`misc`). The setup wizard writes them too, so the home
 * page published during setup is rebuilt once setup is done.
 */
export const HOME_SETTINGS = ['about', 'site', 'localization', 'misc'];

/** The same data, whatever the order of its keys. */
function stable(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    const record = value as Record<string, unknown>;
    if (typeof (record as { toMillis?: unknown }).toMillis === 'function') return String((record as unknown as Timestamp).toMillis());
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(',')}}`;
}

/** Whether a change to this Settings document changes the home page. */
export function changesHomePage(settingId: string, before: unknown, after: unknown): boolean {
    return HOME_SETTINGS.includes(settingId) && after !== undefined && stable(before ?? null) !== stable(after);
}

/**
 * Republishes the home page when a setting it shows changes (docs/website/home-page.html).
 * It queues the work rather than releasing here: every Hosting release goes through
 * the publish queue, one release per item, so two cannot drop each other's files.
 */
export const onSiteSettingsWritten = onDocumentWritten(arcDocument('Settings/{settingId}'), async (event) => {
    if (!arcHostingSite()) return;
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!changesHomePage(event.params.settingId, before, after)) return;
    await db.collection('_publish_queue').add({ action: 'home', timestamp: Timestamp.now() });
});
