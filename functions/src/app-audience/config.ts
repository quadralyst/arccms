/**
 * Where the host app's users live, and how ArcCMS reads a document of theirs
 * (the App audience, specs/coexistence-spec.md section 5b, CO6.2).
 *
 * Two layers:
 * - The database and collection are deploy-time params, set by `arc:configure`
 *   (`--app-users-database`, `--app-users-path`), because the trigger that
 *   watches the collection is bound when functions are deployed. Unset, the
 *   path points at a collection nothing writes to, so installs without a host
 *   app pay nothing.
 * - How to read a document (unique key, email, phone, name, watched fields) is
 *   `Settings/app_audience` in ArcCMS's own database, editable in the admin at
 *   any time.
 */
import { defineString } from 'firebase-functions/params';
import { DEFAULT_DATABASE_ID, arcDatabaseId } from '../arc-config.js';

/** The path pattern used when no host collection is configured. Nothing writes here. */
export const APP_USERS_UNCONFIGURED = '_arccms_app_users_not_configured/{id}';

export const appUsersDatabaseParam = defineString('ARC_APP_USERS_DATABASE', {
    default: DEFAULT_DATABASE_ID,
    description: "Firestore database holding the host app's users (App audience). (default) unless configured.",
});

export const appUsersPathParam = defineString('ARC_APP_USERS_PATH', {
    default: APP_USERS_UNCONFIGURED,
    description: "The host app's user documents, as <collection>/{id}. Leave unset when ArcCMS has no host app.",
});

type Env = Record<string, string | undefined>;

/** `<collection>/{wildcard}`: one top-level collection, which is what CO6 supports. */
export const APP_USERS_PATH_PATTERN = /^([A-Za-z0-9_-]+)\/\{([A-Za-z0-9_]+)\}$/;

export interface AppUsersLocation {
    configured: boolean;
    database: string;
    path: string;
    /** The collection id, when the path is valid. */
    collection: string;
    /**
     * The audience is this install's own `users` collection (CO6.8): a standalone
     * site or an app built on ArcCMS, not another app sharing the project.
     */
    own: boolean;
}

/** The host collection as deployed. Read at call time, from the same values the trigger uses. */
export function appUsersLocation(env: Env = process.env): AppUsersLocation {
    const database = env.ARC_APP_USERS_DATABASE?.trim() || DEFAULT_DATABASE_ID;
    const path = env.ARC_APP_USERS_PATH?.trim() || APP_USERS_UNCONFIGURED;
    const match = APP_USERS_PATH_PATTERN.exec(path);
    const configured = path !== APP_USERS_UNCONFIGURED && !!match;
    const collection = configured && match ? match[1] : '';
    return { configured, database, path, collection, own: collection === 'users' && database === arcDatabaseId(env) };
}

/** How the unique key of a host document is found. */
export type AppUserKey = { source: 'docId' } | { source: 'field'; field: string };

/** `Settings/app_audience`: how to read a host document. */
export interface AppAudienceSettings {
    key: AppUserKey;
    emailField?: string;
    phoneField?: string;
    nameField?: string;
    /** Fields whose changes are events; only their last values are stored. */
    watchedFields: string[];
}

export const DEFAULT_APP_AUDIENCE_SETTINGS: AppAudienceSettings = { key: { source: 'docId' }, watchedFields: [] };

/** Settings from a stored document, with anything malformed dropped. */
export function normalizeAppAudienceSettings(raw: unknown): AppAudienceSettings {
    const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const field = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
    const rawKey = data['key'] as Record<string, unknown> | undefined;
    const key: AppUserKey = rawKey?.['source'] === 'field' && field(rawKey['field'])
        ? { source: 'field', field: field(rawKey['field'])! }
        : { source: 'docId' };
    const watched = Array.isArray(data['watchedFields'])
        ? [...new Set((data['watchedFields'] as unknown[]).map(field).filter((f): f is string => !!f))]
        : [];
    return {
        key,
        emailField: field(data['emailField']),
        phoneField: field(data['phoneField']),
        nameField: field(data['nameField']),
        watchedFields: watched,
    };
}
