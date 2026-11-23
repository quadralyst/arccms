/**
 * What the dashboard's "Finish setting up" panel can list: each outside service an
 * admin connects in Settings, and how to tell it still needs doing
 * (docs/features/setup-panel.html). The panel shows only what is pending, and only
 * for the features this app has on.
 *
 * Every check reads only what the settings pages read already, and never needs a
 * secret's value: whether a key is saved is enough.
 */
import type { FeatureId } from '../features/feature-registry';
import { environment } from '../../../environments/environment';
import { arcConfig, type AnalyticsConsentMode } from '../config/arc-config';
import { analyticsTrackingState } from '../analytics/analytics-status';

/** The `Settings/<id>` document, or undefined when there is none. Each document is read once per panel. */
export type SettingsReader = (id: string) => Promise<Record<string, unknown> | undefined>;

/** What is still to do for one item. */
export interface SetupNeed {
    /** Something the site needs (email), rather than a service it may never use. */
    required: boolean;
    /** The row's name, as written. With `titleKey`, the text when the key has no translation. */
    title: string;
    /** A translation key for the name: Arc CMS's own, or one in the app's src/custom/i18n files. */
    titleKey?: string;
    /** One line on why to set it up: what works once it is set, or what is off until it is. */
    why: string;
    whyKey?: string;
    /** Set up but not working (a test provider, a failing key): shown as a warning. */
    warning?: boolean;
    /** Where the button goes for this need, when it is not the item's own `route`. */
    route?: string;
}

export interface SetupItem {
    /** Unique among all items, Arc CMS's and the app's. */
    id: string;
    /** Left out when this feature is off. No feature: always checked. */
    feature?: FeatureId;
    /** A Font Awesome class, such as 'fa-solid fa-envelope'. */
    icon: string;
    /** Where "Set up" goes. */
    route: string;
    /** What is still to do, or null when nothing is. A check that throws is left out of the panel. */
    pending(read: SettingsReader): Promise<SetupNeed | null>;
}

type Doc = Record<string, unknown> | undefined;

const need = (key: string, required: boolean, title: string, why: string, warning = false, whyKey = `admin.dashboard.setup.${key}`): SetupNeed => ({
    required,
    title,
    titleKey: `admin.dashboard.setup.${key.split('_')[0]}_title`,
    why,
    whyKey,
    ...(warning ? { warning: true } : {}),
});

/** Email: off until a provider is set up, and sends nothing on the test (log only) provider. */
export function emailNeed(status: Doc): SetupNeed | null {
    if (!status?.['isEnabled']) {
        return need('email_off', true, 'Email', 'Sign-up codes, password resets and form emails are off until email is set up.');
    }
    if (status['debugMode']) {
        return need('email_test', true, 'Email', 'The test provider only logs emails, so none reach anyone. Choose a real provider before going live.', true);
    }
    return null;
}

/** Payments: a key for the mode and the webhook secret saved, payments on, and live. */
export function paymentsNeed(dodo: Doc): SetupNeed | null {
    const live = dodo?.['mode'] === 'live';
    const ready = !!dodo?.['enabled'] && !!dodo[live ? 'liveApiKey' : 'testApiKey'] && !!dodo['webhookSecret'];
    if (!ready) return need('payments_off', false, 'Payments', 'Sell products and take payments on the site.');
    if (!live) return need('payments_test', false, 'Payments', 'Payments are in test mode, so no real money is taken. Switch to live before selling.', true);
    return null;
}

/**
 * SMS: the MSG91 provider with its key saved. Needed, not optional, once phone
 * sign-in is on (`Settings/users.phoneSignIn`), since sign-in codes go by text.
 */
export function smsNeed(sms: Doc, users: Doc): SetupNeed | null {
    if (sms?.['provider'] === 'msg91' && sms['msg91AuthKey']) return null;
    const phoneSignIn = users?.['phoneSignIn'] === true;
    return phoneSignIn
        ? need('sms_signin', true, 'SMS', 'Phone sign-in is on, but texts are only logged, so sign-in codes reach no one.', true)
        : need('sms_off', false, 'SMS', 'Send sign-in codes and messages by text.');
}

/** An AI connection that can answer: its key is saved, or it needs none (Vertex AI uses the functions' own account). */
function usable(c: Record<string, unknown>): boolean {
    return !!c['keyPreview'] || c['preset'] === 'vertex';
}

/** The connection's last call failed after its last success. */
function failing(c: Record<string, unknown>): boolean {
    if (!c['lastError']) return false;
    const ok = typeof c['lastOkAt'] === 'string' ? c['lastOkAt'] : '';
    const error = typeof c['lastErrorAt'] === 'string' ? c['lastErrorAt'] : '';
    return !ok || (!!error && error > ok);
}

/** AI: a connection that can answer, in live mode, and none whose key stopped working. */
export function aiNeed(ai: Doc): SetupNeed | null {
    const raw = ai?.['connections'];
    const connections = raw && typeof raw === 'object' && !Array.isArray(raw)
        ? Object.values(raw as Record<string, unknown>).filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
        : [];
    const ready = connections.filter(usable);
    if (!ready.length) return need('ai_off', false, 'AI', 'Write, translate and describe images with AI.');
    if (ready.some(failing)) return need('ai_error', false, 'AI', 'An AI key stopped working. Check it in AI settings.', true);
    if (ai?.['mode'] !== 'live') return need('ai_test', false, 'AI', 'AI is in test mode and gives sample answers. Switch to live to use it.', true);
    return null;
}

/** How this build tracks visitors: the consent mode and the web config's measurement ID. */
export interface AnalyticsBuild {
    mode: AnalyticsConsentMode;
    measurementId: string | undefined;
}

const ANALYTICS_BUILD: AnalyticsBuild = {
    mode: arcConfig.analyticsConsent,
    measurementId: (environment.firebaseConfig as { measurementId?: string })?.measurementId,
};

/**
 * Google Analytics. First, amber, when nobody can be tracked: the site waits for cookie
 * consent and the cookie notice (`Settings/site-usage.isEnabled`) is off, so no visitor can
 * accept; its button opens the cookie notice. Otherwise pending until it is connected to a
 * property (`Settings/analytics_status.isConnected`), so the dashboard shows its numbers.
 */
export function analyticsNeed(status: Doc, siteUsage: Doc, build: AnalyticsBuild = ANALYTICS_BUILD): SetupNeed | null {
    const tracking = analyticsTrackingState({ featureOn: true, ...build, bannerEnabled: siteUsage?.['isEnabled'] === true });
    if (tracking === 'nobody-banner-off') {
        return { ...need('analytics_nobody', false, 'Google Analytics', 'No one is tracked: the site waits for cookie consent, and the cookie notice is off.', true), route: '/admin/settings/site-usage' };
    }
    return status?.['isConnected'] ? null : need('analytics_off', false, 'Google Analytics', 'See visitors and page views on the dashboard.');
}

/** Unsplash: an access key saved. */
export function unsplashNeed(integrations: Doc): SetupNeed | null {
    const unsplash = integrations?.['unsplash'] as Doc;
    return unsplash?.['accessKey'] ? null : need('unsplash_off', false, 'Free stock photos', 'Search Unsplash photos from the media library.');
}

/**
 * Arc CMS's own items, in the order the panel lists them (needed ones first, then
 * the rest in this order). Geolocation is not one: it works without a key.
 */
export const CORE_SETUP_ITEMS: readonly SetupItem[] = [
    { id: 'email', icon: 'fa-solid fa-envelope', route: '/admin/settings/email', pending: async (read) => emailNeed(await read('email_status')) },
    { id: 'analytics', feature: 'analytics', icon: 'fa-solid fa-chart-line', route: '/admin/settings/analytics', pending: async (read) => analyticsNeed(await read('analytics_status'), await read('site-usage')) },
    { id: 'sms', feature: 'sms', icon: 'fa-solid fa-comment-sms', route: '/admin/settings/sms', pending: async (read) => smsNeed(await read('sms'), await read('users')) },
    { id: 'payments', feature: 'payments', icon: 'fa-solid fa-credit-card', route: '/admin/settings/payments', pending: async (read) => paymentsNeed(await read('dodo-payments')) },
    { id: 'ai', feature: 'ai', icon: 'fa-solid fa-wand-magic-sparkles', route: '/admin/settings/ai', pending: async (read) => aiNeed(await read('ai')) },
    { id: 'unsplash', icon: 'fa-solid fa-image', route: '/admin/settings/integrations', pending: async (read) => unsplashNeed(await read('integrations')) },
];

/**
 * Arc CMS's items and the app's, for the features that are on. An app item with an id
 * already taken is left out, with a console error naming it.
 */
export function setupItemsFor(custom: readonly SetupItem[], isOn: (id: FeatureId) => boolean): SetupItem[] {
    const items: SetupItem[] = [];
    const ids = new Set<string>();
    for (const item of [...CORE_SETUP_ITEMS, ...custom]) {
        if (ids.has(item.id)) {
            console.error(`Setup item "${item.id}" is listed twice; the second one is left out (src/custom/setup-items.ts).`);
            continue;
        }
        ids.add(item.id);
        if (!item.feature || isOn(item.feature)) items.push(item);
    }
    return items;
}

/** A row the panel shows: the item and what is still to do. */
export interface SetupRow {
    item: SetupItem;
    need: SetupNeed;
}

/** Needed rows first, then the rest; each group keeps the items' order. */
export function orderRows(rows: readonly SetupRow[]): SetupRow[] {
    return [...rows.filter((r) => r.need.required), ...rows.filter((r) => !r.need.required)];
}
