/**
 * Data Management Constants
 *
 * Collection registry and export format types for data import/export.
 */

export interface CollectionConfig {
    name: string;
    displayName: string;
    isDynamic?: boolean;
    dynamicPattern?: string;
    subcollections?: SubcollectionConfig[];
}

export interface SubcollectionConfig {
    name: string;
    displayName: string;
}

export interface ExportFormat {
    version: '1.0';
    exportedAt: string;
    collections: {
        [collectionPath: string]: {
            [docId: string]: any;
        };
    };
    metadata: {
        totalDocuments: number;
        collectionSummary: { name: string; count: number }[];
    };
}

export interface ExportProgress {
    currentCollection: string;
    collectionsCompleted: number;
    totalCollections: number;
    documentsExported: number;
}

export interface ImportProgress {
    currentCollection: string;
    collectionsCompleted: number;
    totalCollections: number;
    documentsImported: number;
    documentsSkipped: number;
    documentsErrored: number;
}

export interface ImportOptions {
    overwriteExisting: boolean;
    skipExisting: boolean;
}

export interface ImportValidationResult {
    isValid: boolean;
    version: string;
    errors: string[];
    warnings: string[];
    collectionSummary: { path: string; documentCount: number; isKnown: boolean }[];
}

export interface ImportResult {
    totalImported: number;
    totalSkipped: number;
    totalErrored: number;
    errors: string[];
    collectionResults: { name: string; imported: number; skipped: number; errors: number }[];
}

export interface StorageFileInfo {
    name: string;
    fullPath: string;
    size: number;
    contentType: string;
    timeCreated: string;
    updated: string;
}

/**
 * Media document from the Firestore `media` collection.
 * This is the source of truth for the Export Files page.
 */
export interface MediaDocInfo {
    id: string;
    name: string;
    downloadURL: string;
    storagePath: string;
    uploadTime: string;     // ISO string or Firestore Timestamp serialised
    type?: string;
}

export interface FileExportProgress {
    currentFile: string;
    filesCompleted: number;
    totalFiles: number;
    bytesDownloaded: number;
}

export interface FileImportProgress {
    currentFile: string;
    filesCompleted: number;
    totalFiles: number;
    bytesUploaded: number;
}

export interface UploadResult {
    fileName: string;
    storagePath: string;
    downloadURL: string;
    success: boolean;
    error?: string;
}

/**
 * Bundle of 3 collections for one content type (draft + published + tags).
 * Selecting a content type bundle selects all three sub-collections.
 */
export interface ContentTypeBundle {
    contentTypeSlug: string;
    contentTypeName: string;
    contentTypeIcon?: string;
    draftsCollection: CollectionConfig;     // arc_{slug}_drafts
    publishedCollection: CollectionConfig;  // arc_{slug}
    tagsCollection: CollectionConfig;       // Tags_{slug}
    referencedSlugs: string[];              // slugs of other content types referenced via collectionRef fields
}

/**
 * Logical group of collections displayed together in the UI.
 */
export interface CollectionGroup {
    id: CollectionGroupId;
    label: string;
    icon: string;
    collections: CollectionConfig[];         // Static collections in this group
    contentTypeBundles?: ContentTypeBundle[]; // Only used by the 'content' group
}

export type CollectionGroupId = 'content' | 'users-waitlists' | 'audience' | 'settings-media' | 'email';

// ---------------------------------------------------------------------------
// Static collection registry
// ---------------------------------------------------------------------------

export const KNOWN_COLLECTIONS: CollectionConfig[] = [
    { name: 'ContentTypes', displayName: 'Content Types' },
    { name: 'users', displayName: 'Users' },
    { name: 'Settings', displayName: 'Settings' },
    { name: 'media', displayName: 'Media Metadata' },
    { name: 'EmailTemplate', displayName: 'Email Templates' },
    { name: 'BroadcastEmails', displayName: 'Broadcast Emails' },
    { name: 'EmailLogs', displayName: 'Email Logs' },
    {
        name: 'Waitlists', displayName: 'Waitlists',
        subcollections: [{ name: 'users', displayName: 'Waitlist Users' }],
    },
    {
        name: 'WaitlistedUsers', displayName: 'Waitlisted Users',
        subcollections: [{ name: 'referrals', displayName: 'Referrals' }],
    },
    // Unified audience layer (U1/U2). Contacts carry consent, so exports of this
    // group contain marketing-permission state — treat as sensitive.
    { name: 'Contacts', displayName: 'Contacts' },
    { name: 'Lists', displayName: 'Lists' },
    { name: 'ContactTags', displayName: 'Contact Tags' },
    { name: 'Suppression', displayName: 'Suppression List' },
];

// ---------------------------------------------------------------------------
// Group definitions – maps each static collection to a UI group
// ---------------------------------------------------------------------------

/** Maps each static collection name to its group ID */
export const COLLECTION_GROUP_MAP: Record<string, CollectionGroupId> = {
    ContentTypes:    'content',
    users:           'users-waitlists',
    Waitlists:       'users-waitlists',
    WaitlistedUsers: 'users-waitlists',
    Contacts:        'audience',
    Lists:           'audience',
    ContactTags:     'audience',
    Suppression:     'audience',
    Settings:        'settings-media',
    media:           'settings-media',
    EmailTemplate:   'email',
    BroadcastEmails: 'email',
    EmailLogs:       'email',
};

/** Group display order and metadata */
export const COLLECTION_GROUP_DEFS: { id: CollectionGroupId; label: string; icon: string }[] = [
    { id: 'content',          label: 'admin.data.group_content',            icon: 'fa-solid fa-file-lines' },
    { id: 'users-waitlists',  label: 'admin.data.group_users',  icon: 'fa-solid fa-users' },
    { id: 'audience',         label: 'admin.data.group_audience',           icon: 'fa-solid fa-address-book' },
    { id: 'settings-media',   label: 'admin.data.group_settings',   icon: 'fa-solid fa-gear' },
    { id: 'email',            label: 'admin.data.group_email',              icon: 'fa-solid fa-envelope' },
];

// ---------------------------------------------------------------------------
// Dynamic collection patterns
// ---------------------------------------------------------------------------

export const DYNAMIC_COLLECTION_PATTERNS = [
    { pattern: 'Tags_', displayPrefix: 'Tags', dependsOn: 'ContentTypes', slugField: 'slug' },
];

// ---------------------------------------------------------------------------
// Collection name recognition
// ---------------------------------------------------------------------------

/**
 * Check whether a collection name is recognized (static or dynamic pattern).
 * Used by import validation to avoid spurious "unknown collection" warnings.
 */
export function isKnownCollectionName(name: string): boolean {
    const root = name.split('/')[0];

    // Static known collections
    if (KNOWN_COLLECTIONS.some((c) => c.name === root)) {
        return true;
    }

    // Dynamic Tags collections: Tags_{slug}
    if (root.startsWith('Tags_')) return true;

    // Dynamic content collections: arc_{slug}_drafts
    if (/^arc_.+_drafts$/.test(root)) return true;

    // Dynamic content collections: arc_{slug} (published, no _drafts suffix)
    if (/^arc_/.test(root) && !root.endsWith('_drafts')) return true;

    return false;
}

/**
 * Determine which group a collection path belongs to.
 * Used by both export and import pages for grouping.
 */
export function getCollectionGroupId(path: string): CollectionGroupId | 'unknown' {
    const root = path.split('/')[0];

    // Check static map first
    if (COLLECTION_GROUP_MAP[root]) {
        return COLLECTION_GROUP_MAP[root];
    }

    // Dynamic patterns → content group
    if (root.startsWith('Tags_')) return 'content';
    if (/^arc_.+_drafts$/.test(root)) return 'content';
    if (/^arc_/.test(root) && !root.endsWith('_drafts')) return 'content';

    return 'unknown';
}

// ---------------------------------------------------------------------------
// Import ordering
// ---------------------------------------------------------------------------

/**
 * Ordered list defining the recommended import order to minimize broken references.
 * Collections not in this list are imported last.
 */
export const IMPORT_ORDER: string[] = [
    'ContentTypes',
    'Settings',
    'users',
    'media',
    'EmailTemplate',
    // Tags_ and arc_* dynamic collections are matched by prefix in getImportPriority
    'Waitlists',
    'WaitlistedUsers',
    // Audience: Lists and ContactTags first — Contacts reference both by id, and
    // Contacts must exist before Suppression is meaningful.
    'Lists',
    'ContactTags',
    'Contacts',
    'Suppression',
    'BroadcastEmails',
    'EmailLogs',
];

/**
 * Sort collection paths by recommended import order.
 * Tags_ collections go after ContentTypes. Subcollections go after their parents.
 * arc_*_drafts go before arc_* (published).
 */
export function sortByImportOrder(collectionPaths: string[]): string[] {
    return [...collectionPaths].sort((a, b) => {
        const orderA = getImportPriority(a);
        const orderB = getImportPriority(b);
        return orderA - orderB;
    });
}

function getImportPriority(path: string): number {
    // Subcollection paths like "Waitlists/{id}/users" should come after parent
    const isSubcollection = path.includes('/');
    const rootCollection = path.split('/')[0];

    const baseIndex = IMPORT_ORDER.indexOf(rootCollection);

    // Tags go right after ContentTypes (index 0) but before other collections
    if (path.startsWith('Tags_')) {
        return 1.5;
    }

    // arc_{slug}_drafts → import before published content
    if (/^arc_.+_drafts$/.test(path)) {
        return 2.0;
    }

    // arc_{slug} (published) → import after drafts
    if (/^arc_/.test(path) && !path.endsWith('_drafts')) {
        return 2.5;
    }

    if (baseIndex >= 0) {
        // Subcollections get +0.5 so they come right after their parent
        return isSubcollection ? baseIndex + 0.5 : baseIndex;
    }

    // Unknown collections go at the end
    return 100;
}
