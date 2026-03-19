import { inject, Injectable } from '@angular/core';
import {
    doc,
    Firestore,
    getDoc,
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

@Injectable({ providedIn: 'root' })
export class ImportDataService {
    private db = inject(Firestore);

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
                    reject(new Error('Invalid JSON file. Please upload a valid export file.'));
                }
            };
            reader.onerror = () => reject(new Error('Failed to read file.'));
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
            errors.push('Missing "version" field. This may not be a valid export file.');
        }

        // Check collections
        if (!data.collections || typeof data.collections !== 'object') {
            errors.push('Missing or invalid "collections" field.');
            return { isValid: false, version: data.version || 'unknown', errors, warnings, collectionSummary };
        }

        for (const [path, docs] of Object.entries(data.collections)) {
            const docCount = typeof docs === 'object' && docs !== null ? Object.keys(docs).length : 0;

            // Determine if known collection (static, Tags_, or arc_*)
            const isKnown = isKnownCollectionName(path);

            if (!isKnown) {
                warnings.push(`Unknown collection "${path}". It will still be imported.`);
            }

            collectionSummary.push({
                path,
                documentCount: docCount,
                isKnown,
            });
        }

        // Warn about users collection and Auth UID dependency
        if (data.collections['users']) {
            warnings.push(
                'The "users" collection contains Auth UID references (uid field). ' +
                'If importing to a different Firebase project, user login may not work until Auth accounts are re-created.',
            );
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
            currentCollection: 'Complete',
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

        const entries = Object.entries(documents);
        const BATCH_SIZE = 500;

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

                    if (options.overwriteExisting) {
                        batch.set(docRef, deserializedData);
                    } else {
                        batch.set(docRef, deserializedData, { merge: true });
                    }

                    batchCount++;
                    imported++;
                } catch (error: any) {
                    errors.push(`${collectionPath}/${docId}: ${error.message || 'Unknown error'}`);
                }
            }

            if (batchCount > 0) {
                try {
                    await batch.commit();
                } catch (error: any) {
                    errors.push(`Batch commit failed for ${collectionPath}: ${error.message}`);
                    // Adjust counts - documents weren't actually written
                    imported -= batchCount;
                }
            }
        }

        return { imported, skipped, errors };
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
