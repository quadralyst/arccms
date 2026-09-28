/**
 * Reading Settings, App audience (`Settings/app_audience`). Its own module so
 * code outside the admin callables (the unsubscribe handlers, say) can read the
 * settings without loading the callables.
 */
import { db } from '../init.js';
import { normalizeAppAudienceSettings, DEFAULT_APP_AUDIENCE_SETTINGS, type AppAudienceSettings } from './config.js';

export async function readAppAudienceSettings(): Promise<AppAudienceSettings> {
    const snap = await db.collection('Settings').doc('app_audience').get();
    return snap.exists ? normalizeAppAudienceSettings(snap.data()) : DEFAULT_APP_AUDIENCE_SETTINGS;
}
