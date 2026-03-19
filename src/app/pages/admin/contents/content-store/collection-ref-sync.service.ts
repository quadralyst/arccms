import { Injectable, inject } from '@angular/core';
import { Firestore, collection, getDocs, query, where, writeBatch, doc } from '@angular/fire/firestore';
import { ContentTypesStore } from '../content-types/content-types.store';
import { ContentTypeField } from '../content-types/content-types.model';

@Injectable({ providedIn: 'root' })
export class CollectionRefSyncService {
    private db = inject(Firestore);
    private contentTypesStore = inject(ContentTypesStore);

    // Guard against circular sync loops
    private activeSyncs = new Set<string>();

    /**
     * When a document in a source collection is updated, find all documents
     * in other collections that reference it and update the denormalized data.
     *
     * @param sourceCollectionSlug - The content type slug of the updated document
     * @param sourceDocId - The Firestore document ID that was updated
     * @param updatedData - The full updated document data (to extract sync fields)
     * @param originalData - The original document data before update (optional, for optimization)
     */
    async syncReferencedData(
        sourceCollectionSlug: string,
        sourceDocId: string,
        updatedData: Record<string, any>,
        originalData?: Record<string, any>
    ): Promise<void> {
        // Circular reference guard: prevent re-entrant sync for the same doc
        const syncKey = `${sourceCollectionSlug}:${sourceDocId}`;
        if (this.activeSyncs.has(syncKey)) {
            return;
        }
        this.activeSyncs.add(syncKey);

        try {
            // 1. Find all content types that have fields referencing this collection
            const allContentTypes = this.contentTypesStore.items();
            const referencingTypes = allContentTypes.filter(ct =>
                ct.fields?.some(f =>
                    f.useCollectionRef &&
                    f.collectionRef?.collectionSlug === sourceCollectionSlug
                )
            );

            if (referencingTypes.length === 0) return;

            // 2. For each referencing content type, query for documents that reference this ID
            for (const ct of referencingTypes) {
                const referencingFields = ct.fields.filter(f =>
                    f.useCollectionRef &&
                    f.collectionRef?.collectionSlug === sourceCollectionSlug
                );

                for (const field of referencingFields) {
                    // OPTIMIZATION: Check if relevant fields actually changed
                    if (originalData && field.collectionRef) {
                        const displayField = field.collectionRef.displayField;
                        const syncFields = field.collectionRef.syncFields || [];
                        const fieldsToCheck = [displayField, ...syncFields, 'title', 'urlSlug', 'coverImage'].filter(k => k !== 'id');

                        let hasChange = false;
                        for (const key of fieldsToCheck) {
                            const newVal = this.getValue(updatedData, key);
                            const oldVal = this.getValue(originalData, key);
                            if (JSON.stringify(newVal) !== JSON.stringify(oldVal)) {
                                hasChange = true;
                                break;
                            }
                        }

                        if (!hasChange) {
                            continue;
                        }
                    }

                    await this.updateReferencesForField(field, sourceDocId, updatedData, ct.slug);
                }
            }
        } finally {
            this.activeSyncs.delete(syncKey);
        }
    }

    /** Extract a value from either top-level properties or customFields */
    getValue(data: Record<string, any>, key: string): any {
        if (data[key] !== undefined) return data[key];
        if (data['customFields'] && data['customFields'][key] !== undefined) return data['customFields'][key];
        return undefined;
    }

    /** Build the denormalized reference data object for a given field and source document */
    buildRefData(
        field: ContentTypeField,
        sourceDocId: string,
        updatedData: Record<string, any>
    ): Record<string, any> {
        const syncData: Record<string, any> = {
            id: sourceDocId,
            [field.collectionRef!.displayField]: updatedData[field.collectionRef!.displayField] || updatedData['title'] || sourceDocId
        };

        for (const syncKey of field.collectionRef!.syncFields) {
            if (updatedData[syncKey] !== undefined) {
                syncData[syncKey] = updatedData[syncKey];
            } else if (updatedData['customFields'] && updatedData['customFields'][syncKey] !== undefined) {
                syncData[syncKey] = updatedData['customFields'][syncKey];
            }
        }

        return {
            ...syncData,
            _refCollection: field.collectionRef!.collectionSlug,
            _refId: sourceDocId,
            _refDisplayValue: syncData[field.collectionRef!.displayField]
        };
    }

    private async updateReferencesForField(
        field: ContentTypeField,
        sourceDocId: string,
        updatedData: Record<string, any>,
        referencingTypeSlug: string
    ): Promise<void> {
        const fullRefData = this.buildRefData(field, sourceDocId, updatedData);

        // Sync both draft and published collections for the referencing type
        await this.updateCollectionReferences(`arc_${referencingTypeSlug}_drafts`, field, sourceDocId, fullRefData);
        await this.updateCollectionReferences(`arc_${referencingTypeSlug}`, field, sourceDocId, fullRefData);
    }

    private async updateCollectionReferences(
        collectionName: string,
        field: ContentTypeField,
        sourceDocId: string,
        fullRefData: Record<string, any>
    ): Promise<void> {
        const collectionRef = collection(this.db, collectionName);

        let q;
        if (field.type === 'checkbox') {
            q = query(collectionRef, where(`customFields.${field.key}`, 'array-contains', sourceDocId));
        } else {
            q = query(collectionRef, where(`customFields.${field.key}`, '==', sourceDocId));
        }

        const snapshot = await getDocs(q);
        if (snapshot.empty) {
            return;
        }

        // Batch update all referencing documents, chunks of 400 (Firestore limit is 500)
        const docs = snapshot.docs;
        for (let i = 0; i < docs.length; i += 400) {
            const chunk = docs.slice(i, i + 400);
            const batch = writeBatch(this.db);

            chunk.forEach(docSnap => {
                const docRef = doc(this.db, collectionName, docSnap.id);
                const existingData = docSnap.data();
                const refKey = `_ref_${field.key}`;

                if (field.type === 'checkbox') {
                    const existingCustomFields = existingData['customFields'] || {};
                    const refArray = existingCustomFields[refKey] || [];

                    const updatedRefArray = refArray.map((entry: any) =>
                        entry.id === sourceDocId ? fullRefData : entry
                    );

                    batch.update(docRef, {
                        [`customFields.${refKey}`]: updatedRefArray,
                        modifiedAt: new Date(),
                    });
                } else {
                    batch.update(docRef, {
                        [`customFields.${refKey}`]: fullRefData,
                        modifiedAt: new Date(),
                    });
                }
            });

            await batch.commit();
        }
    }
}
