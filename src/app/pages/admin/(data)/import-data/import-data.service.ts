import { inject, Injectable } from '@angular/core';
import {
    collection,
    doc,
    Firestore,
    getDoc,
    getDocsFromServer,
    setDoc,
    writeBatch,
} from '@angular/fire/firestore';
import {
    ExportFormat,
    ImportOptions,
    ImportProgress,
    ImportResult,
    ImportValidationResult,
    isKnownCollectionName,
    sortByImportOrder,
} from '../data-constants';
import { deserializeFirestoreValue } from '../data-serialization';
import { ContentTypesService } from '../../contents/content-types/content-types.service';
import { injectT } from '../../../../core/i18n/inject-t';

/** A file the import cannot read, with a plain sentence for the admin as its message. */
export class ImportFileError extends Error {}

@Injectable({ providedIn: 'root' })
export class ImportDataService {
    private db = inject(Firestore);
    private contentTypes = inject(ContentTypesService);
    /** What the admin reads is in their language and plain; the technical detail goes to the console. */
    private t = injectT();

    /**
     * Parse an uploaded JSON file into an ExportFormat object.
     */
    async parseExportFile(file: File): Promise<ExportFormat> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const text = e.target?.result as string;
                    const data = JSON.parse(text) as ExportFormat;
                    resolve(data);
                } catch {
                    reject(new ImportFileError(this.t('admin.data.import.err_not_json')));
                }
            };
            reader.onerror = () => reject(new ImportFileError(this.t('admin.data.import.err_read')));
            reader.readAsText(file);
        });
    }

    /**
     * Validate the structure of an export data object.
     */
    validateExportData(data: any): ImportValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];
        const collectionSummary: { path: string; documentCount: number; isKnown: boolean }[] = [];

        // Check version
        if (!data.version) {
            errors.push(this.t('admin.data.import.err_no_version'));
        }

        // Check collections
        if (!data.collections || typeof data.collections !== 'object') {
            errors.push(this.t('admin.data.import.err_no_collections'));
            return { isValid: false, version: data.version || 'unknown', errors, warnings, collectionSummary };
        }

        for (const [path, docs] of Object.entries(data.collections)) {
            const docCount = typeof docs === 'object' && docs !== null ? Object.keys(docs).length : 0;

            // Determine if known collection (static, Tags_, or arc_*)
            const isKnown = isKnownCollectionName(path);

            if (!isKnown) {
                warnings.push(this.t('admin.data.import.warn_unknown', { path }));
            }

            collectionSummary.push({
                path,
                documentCount: docCount,
                isKnown,
            });
        }

        // Warn about users collection and Auth UID dependency
        if (data.collections['users']) {
            warnings.push(this.t('admin.data.import.warn_users'));
        }

        return {
            isValid: errors.length === 0,
            version: data.version || 'unknown',
            errors,
            warnings,
            collectionSummary,
        };
    }

    /**
     * Import collections into Firestore, preserving document IDs.
     * Uses setDoc (not addDoc) to maintain original IDs.
     */
    async importCollections(
        data: ExportFormat,
        selectedCollections: string[],
        options: ImportOptions,
        progressCallback: (progress: ImportProgress) => void,
    ): Promise<ImportResult> {
        // Sort collections by recommended import order
        const sortedCollections = sortByImportOrder(selectedCollections);

        const result: ImportResult = {
            totalImported: 0,
            totalSkipped: 0,
            totalErrored: 0,
            errors: [],
            collectionResults: [],
        };

        let collectionsCompleted = 0;

        for (const collectionPath of sortedCollections) {
            const documents = data.collections[collectionPath];
            if (!documents) continue;

            progressCallback({
                currentCollection: collectionPath,
                collectionsCompleted,
                totalCollections: sortedCollections.length,
                documentsImported: result.totalImported,
                documentsSkipped: result.totalSkipped,
                documentsErrored: result.totalErrored,
            });

            const collectionResult = await this.importCollection(collectionPath, documents, options);

            result.totalImported += collectionResult.imported;
            result.totalSkipped += collectionResult.skipped;
            result.totalErrored += collectionResult.errors.length;
            result.errors.push(...collectionResult.errors);
            result.collectionResults.push({
                name: collectionPath,
                imported: collectionResult.imported,
                skipped: collectionResult.skipped,
                errors: collectionResult.errors.length,
            });

            collectionsCompleted++;
        }

        progressCallback({
            currentCollection: this.t('admin.data.progress_done'),
            collectionsCompleted: sortedCollections.length,
            totalCollections: sortedCollections.length,
            documentsImported: result.totalImported,
            documentsSkipped: result.totalSkipped,
            documentsErrored: result.totalErrored,
        });

        return result;
    }

    /**
     * Import a single collection using setDoc to preserve document IDs.
     * Processes in batches of 500 (Firestore writeBatch limit).
     */
    private async importCollection(
        collectionPath: string,
        documents: Record<string, any>,
        options: ImportOptions,
    ): Promise<{ imported: number; skipped: number; errors: string[] }> {
        let imported = 0;
        let skipped = 0;
        const errors: string[] = [];

        let entries = Object.entries(documents);
        if (collectionPath === 'ContentTypes') {
            const refused = await this.refuseSlugChanges(entries, options);
            errors.push(...refused.errors);
            entries = refused.entries;
        }
        const BATCH_SIZE = 500;
        // Users records not on this site, which an import cannot add (keepUserAccess).
        let newUsers = 0;

        for (let i = 0; i < entries.length; i += BATCH_SIZE) {
            const chunk = entries.slice(i, i + BATCH_SIZE);
            const batch = writeBatch(this.db);
            let batchCount = 0;

            for (const [docId, rawData] of chunk) {
                try {
                    const docRef = this.buildDocRef(collectionPath, docId);
                    const deserializedData = deserializeFirestoreValue(rawData, this.db);

                    if (options.skipExisting) {
                        const existingDoc = await getDoc(docRef);
                        if (existingDoc.exists()) {
                            skipped++;
                            continue;
                        }
                    }

                    if (collectionPath === USERS_COLLECTION) {
                        const existingUser = await getDoc(docRef);
                        if (!existingUser.exists()) {
                            newUsers++;
                            skipped++;
                            continue;
                        }
                        keepUserAccess(deserializedData as Record<string, unknown>, existingUser.data() as Record<string, unknown> | undefined);
                    }

                    if (options.overwriteExisting) {
                        batch.set(docRef, deserializedData);
                    } else {
                        batch.set(docRef, deserializedData, { merge: true });
                    }

                    batchCount++;
                    imported++;
                } catch (error: any) {
                    console.error(`Import of ${collectionPath}/${docId} failed:`, error);
                    errors.push(this.t('admin.data.import.err_doc', { path: `${collectionPath}/${docId}` }));
                }
            }

            if (batchCount > 0) {
                try {
                    await batch.commit();
                } catch (error: any) {
                    console.error(`Writing ${collectionPath} failed:`, error);
                    errors.push(this.t('admin.data.import.err_batch', { collection: collectionPath, count: batchCount }));
                    // Adjust counts - documents weren't actually written
                    imported -= batchCount;
                }
            }
        }

        if (newUsers) {
            errors.push(this.t('admin.data.import.err_new_users', { count: newUsers }));
        }

        return { imported, skipped, errors };
    }

    /**
     * Drops each content type that would change a slug, and says why. A type's
     * entries live under its slug (`arc_{slug}`, `arc_{slug}_drafts`,
     * `Tags_{slug}`), so:
     * - a type whose slug another type already uses, here or earlier in the
     *   file, is refused: two types with one slug would share their entries,
     *   and deleting either would delete them (see `onContentTypeDeleted`);
     * - a type that is already on the site, by document id, under another slug
     *   is refused while anything is stored under its current slug: the
     *   import would leave those behind, gone from the admin and the site.
     *   The edit form locks the slug for the same reason.
     * The same type under the same slug is imported as usual. When the site's
     * types cannot be read from the server, no type is imported; when a
     * type's stored items cannot be checked, that type is not imported.
     */
    private async refuseSlugChanges(
        entries: [string, any][],
        options: ImportOptions,
    ): Promise<{ entries: [string, any][]; errors: string[] }> {
        const owner = new Map<string, string>();
        const siteSlug = new Map<string, string>();
        try {
            const snapshot = await getDocsFromServer(collection(this.db, 'ContentTypes'));
            for (const existing of snapshot.docs) {
                const slug = existing.data()['slug'];
                if (typeof slug !== 'string' || !slug) continue;
                siteSlug.set(existing.id, slug);
                if (!owner.has(slug)) owner.set(slug, existing.id);
            }
        } catch (error: any) {
            console.error('Reading the content types to check their addresses failed:', error);
            return { entries: [], errors: [this.t('admin.data.import.err_types_unread')] };
        }
        const kept: [string, any][] = [];
        const errors: string[] = [];
        for (const [docId, rawData] of entries) {
            const slug = typeof rawData?.slug === 'string' && rawData.slug ? rawData.slug as string : '';
            const holder = slug ? owner.get(slug) : undefined;
            if (holder && holder !== docId) {
                errors.push(this.t('admin.data.import.err_address_taken', { id: docId, holder, address: slug }));
                continue;
            }
            const renameError = await this.renameError(docId, slug, siteSlug.get(docId), options);
            if (renameError) {
                errors.push(renameError);
                continue;
            }
            // A type that moves frees its old slug for a later type in the file.
            const currentSlug = siteSlug.get(docId);
            if (!options.skipExisting && slug && currentSlug && slug !== currentSlug && owner.get(currentSlug) === docId) owner.delete(currentSlug);
            if (slug) owner.set(slug, docId);
            kept.push([docId, rawData]);
        }
        return { entries: kept, errors };
    }

    /**
     * Why importing a type over the site's copy of it must not go ahead, or
     * `null` when it may: its slug stays, the type is new, the import skips
     * existing documents, or nothing is stored under the current slug. A
     * merge keeps the site's slug when the file has none; an overwrite
     * removes it.
     */
    private async renameError(
        docId: string,
        slug: string,
        currentSlug: string | undefined,
        options: ImportOptions,
    ): Promise<string | null> {
        if (!currentSlug || options.skipExisting) return null;
        const nextSlug = slug || (options.overwriteExisting ? '' : currentSlug);
        if (nextSlug === currentSlug) return null;
        const change = nextSlug
            ? this.t('admin.data.import.change_address', { from: currentSlug, to: nextSlug })
            : this.t('admin.data.import.remove_address', { address: currentSlug });
        try {
            if (!(await this.contentTypes.hasStoredItems(currentSlug))) return null;
        } catch (error: any) {
            console.error(`Checking the entries under "${currentSlug}" failed:`, error);
            return this.t('admin.data.import.err_address_unchecked', { id: docId, change, address: currentSlug });
        }
        return this.t('admin.data.import.err_address_change', { id: docId, change, address: currentSlug });
    }

    /**
     * Build a Firestore DocumentReference from a collection path and document ID.
     * Handles both root collections (e.g., "DraftContents/docId") and
     * subcollections (e.g., "Waitlists/parentId/users/docId").
     */
    private buildDocRef(collectionPath: string, docId: string): any {
        // Split path: "Waitlists/parentId/users" -> ["Waitlists", "parentId", "users"]
        const segments = collectionPath.split('/');

        if (segments.length === 1) {
            // Root collection
            return doc(this.db, segments[0], docId);
        } else if (segments.length === 3) {
            // Subcollection: parent/parentId/subcollection
            return doc(this.db, segments[0], segments[1], segments[2], docId);
        } else {
            // Deeper nesting (shouldn't happen, but handle gracefully)
            return doc(this.db, collectionPath + '/' + docId);
        }
    }
}

const USERS_COLLECTION = 'users';

/**
 * Who a user is, how they sign in and what they may do: the rules refuse these from
 * every browser, an admin's too, so they only change through Users, which keeps the
 * site an active admin and checks a new number (functions/src/users/adminUserAccess.ts,
 * adminSetPhone.ts).
 */
export const USER_ACCESS_FIELDS = ['role', 'uid', 'isActive', 'status', 'phone', 'phoneVerified', 'by', 'authOwner', 'adminPasswordAt'] as const;

/**
 * An imported users record keeps the access it has on this site: the file's role,
 * sign-in, phone and block are replaced by the site's own, so the write changes none of them.
 * A record the site does not have is not imported at all (the rules refuse a new
 * record from the browser: every record is made with its sign-in, on the server).
 */
export function keepUserAccess(data: Record<string, unknown>, existing: Record<string, unknown> | undefined): void {
    for (const field of USER_ACCESS_FIELDS) {
        if (existing && field in existing) data[field] = existing[field];
        else delete data[field];
    }
}
