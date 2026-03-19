import { inject, Injectable } from '@angular/core';
import {
    collection,
    CollectionReference,
    DocumentData,
    Firestore,
    getDocs,
    getCountFromServer,
    query,
    limit,
    startAfter,
    QueryDocumentSnapshot,
} from '@angular/fire/firestore';
import { ContentTypesStore } from '../../contents/content-types/content-types.store';
import { getTagsCollectionName } from '../../contents/content-types/tags/tags.model';
import {
    CollectionConfig,
    CollectionGroup,
    ContentTypeBundle,
    ExportFormat,
    ExportProgress,
    KNOWN_COLLECTIONS,
    COLLECTION_GROUP_MAP,
    COLLECTION_GROUP_DEFS,
    DYNAMIC_COLLECTION_PATTERNS,
} from '../data-constants';
import { serializeFirestoreValue } from '../data-serialization';

@Injectable({ providedIn: 'root' })
export class ExportDataService {
    private db = inject(Firestore);
    private contentTypesStore = inject(ContentTypesStore);

    /**
     * Get the full list of available collections
     * (known + dynamic Tags_ + dynamic arc_* collections).
     */
    getAvailableCollections(): CollectionConfig[] {
        const collections = [...KNOWN_COLLECTIONS];
        const contentTypes = this.contentTypesStore.items();

        for (const ct of contentTypes) {
            if (ct.slug) {
                // Drafts collection: arc_{slug}_drafts
                collections.push({
                    name: `arc_${ct.slug}_drafts`,
                    displayName: `${ct.name} (Drafts)`,
                    isDynamic: true,
                    dynamicPattern: 'arc_',
                });

                // Published collection: arc_{slug}
                collections.push({
                    name: `arc_${ct.slug}`,
                    displayName: `${ct.name} (Published)`,
                    isDynamic: true,
                    dynamicPattern: 'arc_',
                });

                // Tags collection: Tags_{slug}
                collections.push({
                    name: getTagsCollectionName(ct.slug),
                    displayName: `Tags (${ct.name})`,
                    isDynamic: true,
                    dynamicPattern: DYNAMIC_COLLECTION_PATTERNS[0]?.pattern,
                });
            }
        }

        return collections;
    }

    /**
     * Get collections organized into logical groups for the UI.
     * Each content type becomes a bundle (draft + published + tags).
     */
    getCollectionGroups(): CollectionGroup[] {
        const contentTypes = this.contentTypesStore.items();

        // Build content type bundles
        const bundles: ContentTypeBundle[] = contentTypes
            .filter((ct) => !!ct.slug)
            .map((ct) => {
                // Compute referenced slugs from collectionRef fields
                const referencedSlugs = (ct.fields || [])
                    .filter((f: any) => f.useCollectionRef && f.collectionRef?.collectionSlug)
                    .map((f: any) => f.collectionRef!.collectionSlug as string)
                    .filter((slug: string, idx: number, arr: string[]) => arr.indexOf(slug) === idx);

                return {
                    contentTypeSlug: ct.slug,
                    contentTypeName: ct.name,
                    contentTypeIcon: (ct as any).icon,
                    draftsCollection: {
                        name: `arc_${ct.slug}_drafts`,
                        displayName: `${ct.name} (Drafts)`,
                        isDynamic: true,
                    },
                    publishedCollection: {
                        name: `arc_${ct.slug}`,
                        displayName: `${ct.name} (Published)`,
                        isDynamic: true,
                    },
                    tagsCollection: {
                        name: getTagsCollectionName(ct.slug),
                        displayName: `Tags (${ct.name})`,
                        isDynamic: true,
                    },
                    referencedSlugs,
                };
            });

        // Build groups from definitions
        return COLLECTION_GROUP_DEFS.map((def) => {
            const staticCollections = KNOWN_COLLECTIONS.filter(
                (c) => COLLECTION_GROUP_MAP[c.name] === def.id,
            );

            const group: CollectionGroup = {
                id: def.id,
                label: def.label,
                icon: def.icon,
                collections: staticCollections,
            };

            if (def.id === 'content') {
                group.contentTypeBundles = bundles;
            }

            return group;
        });
    }

    /**
     * Expand content type bundle selections into a flat CollectionConfig[].
     * The existing exportCollections() method stays unchanged — it receives flat configs.
     */
    expandBundleSelections(
        selectedCollections: CollectionConfig[],
        selectedBundles: ContentTypeBundle[],
    ): CollectionConfig[] {
        const flat = [...selectedCollections];
        for (const bundle of selectedBundles) {
            flat.push(bundle.draftsCollection);
            flat.push(bundle.publishedCollection);
            flat.push(bundle.tagsCollection);
        }
        return flat;
    }

    /**
     * Get the document count for a specific collection.
     */
    async getCollectionCount(collectionName: string): Promise<number> {
        const colRef = collection(this.db, collectionName);
        const snapshot = await getCountFromServer(colRef);
        return snapshot.data().count;
    }

    /**
     * Export selected collections to an ExportFormat object.
     */
    async exportCollections(
        selectedCollections: CollectionConfig[],
        progressCallback: (progress: ExportProgress) => void,
    ): Promise<ExportFormat> {
        const exportData: ExportFormat = {
            version: '1.0',
            exportedAt: new Date().toISOString(),
            collections: {},
            metadata: {
                totalDocuments: 0,
                collectionSummary: [],
            },
        };

        let collectionsCompleted = 0;
        let totalDocsExported = 0;

        for (const config of selectedCollections) {
            progressCallback({
                currentCollection: config.displayName,
                collectionsCompleted,
                totalCollections: selectedCollections.length,
                documentsExported: totalDocsExported,
            });

            // Export root collection
            const docs = await this.exportRootCollection(config.name);
            exportData.collections[config.name] = docs;
            const docCount = Object.keys(docs).length;
            totalDocsExported += docCount;

            exportData.metadata.collectionSummary.push({
                name: config.name,
                count: docCount,
            });

            // Export subcollections if any
            if (config.subcollections && config.subcollections.length > 0) {
                const parentDocIds = Object.keys(docs);

                for (const subConfig of config.subcollections) {
                    for (const parentId of parentDocIds) {
                        const subPath = `${config.name}/${parentId}/${subConfig.name}`;

                        progressCallback({
                            currentCollection: `${config.displayName} > ${subConfig.displayName} (${parentId})`,
                            collectionsCompleted,
                            totalCollections: selectedCollections.length,
                            documentsExported: totalDocsExported,
                        });

                        const subDocs = await this.exportSubcollection(config.name, parentId, subConfig.name);
                        if (Object.keys(subDocs).length > 0) {
                            exportData.collections[subPath] = subDocs;
                            const subDocCount = Object.keys(subDocs).length;
                            totalDocsExported += subDocCount;

                            exportData.metadata.collectionSummary.push({
                                name: subPath,
                                count: subDocCount,
                            });
                        }
                    }
                }
            }

            collectionsCompleted++;
        }

        exportData.metadata.totalDocuments = totalDocsExported;

        progressCallback({
            currentCollection: 'Complete',
            collectionsCompleted: selectedCollections.length,
            totalCollections: selectedCollections.length,
            documentsExported: totalDocsExported,
        });

        return exportData;
    }

    /**
     * Export all documents from a root collection.
     * Paginates in chunks of 1000 to handle large collections.
     */
    private async exportRootCollection(collectionName: string): Promise<Record<string, any>> {
        const result: Record<string, any> = {};
        const colRef = collection(this.db, collectionName) as CollectionReference<DocumentData>;
        const PAGE_SIZE = 1000;

        let lastDoc: QueryDocumentSnapshot<DocumentData> | null = null;
        let hasMore = true;

        while (hasMore) {
            const constraints: any[] = [limit(PAGE_SIZE)];
            if (lastDoc) {
                constraints.push(startAfter(lastDoc));
            }

            const q = query(colRef, ...constraints);
            const snapshot = await getDocs(q);

            for (const docSnap of snapshot.docs) {
                const data = docSnap.data();
                result[docSnap.id] = serializeFirestoreValue(data);
            }

            if (snapshot.docs.length < PAGE_SIZE) {
                hasMore = false;
            } else {
                lastDoc = snapshot.docs[snapshot.docs.length - 1];
            }
        }

        return result;
    }

    /**
     * Export all documents from a subcollection.
     */
    private async exportSubcollection(
        parentCollection: string,
        parentDocId: string,
        subcollectionName: string,
    ): Promise<Record<string, any>> {
        const result: Record<string, any> = {};
        const colRef = collection(this.db, parentCollection, parentDocId, subcollectionName);
        const snapshot = await getDocs(colRef);

        for (const docSnap of snapshot.docs) {
            const data = docSnap.data();
            result[docSnap.id] = serializeFirestoreValue(data);
        }

        return result;
    }

    /**
     * Download the export data as a JSON file.
     */
    downloadAsJson(data: ExportFormat, filename: string): void {
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}
