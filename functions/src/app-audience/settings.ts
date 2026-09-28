/**
 * Reading Settings, App audience (`Settings/app_audience`). Its own module so
 * code outside the admin callables (the unsubscribe handlers, say) can read the
 * settings without loading the callables.
 */
import { db } from '../init.js';
import {
    appUsersLocation, normalizeAppAudienceSettings, DEFAULT_APP_AUDIENCE_SETTINGS, type AppAudienceSettings,
} from './config.js';

/**
 * The settings for an audience of this install's own users (CO6.8), until an
 * admin saves others: their fields are known, so the App audience works from
 * the start without anyone filling in Settings, App audience. A standalone
 * setup turns this audience on by itself (docs/deploy.md).
 */
export const OWN_USERS_SETTINGS: AppAudienceSettings = {
    key: { source: 'docId' },
    emailField: 'email',
    nameField: 'name',
    phoneField: 'phone',
    watchedFields: [],
};

export async function readAppAudienceSettings(): Promise<AppAudienceSettings> {
    const snap = await db.collection('Settings').doc('app_audience').get();
    if (snap.exists) return normalizeAppAudienceSettings(snap.data());
    return appUsersLocation().own ? OWN_USERS_SETTINGS : DEFAULT_APP_AUDIENCE_SETTINGS;
}
