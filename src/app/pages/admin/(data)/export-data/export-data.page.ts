import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { TranslocoPipe } from '@jsverse/transloco';
import { TranslatablePipe } from '../../../../core/i18n/translatable.pipe';
import { Component, inject, OnInit, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { BaseComponent } from '../../../../../shared/components/base/base.component';
import { roleGuard } from '../../../../guards/role.guard';
import {
    CollectionConfig,
    CollectionGroup,
    ContentTypeBundle,
    ExportProgress,
} from '../data-constants';
import { ExportDataService } from './export-data.service';

export const routeMeta: RouteMeta = {
    title: 'Export Data | Arc CMS',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

// ---------------------------------------------------------------------------
// View-model interfaces
// ---------------------------------------------------------------------------

export interface SelectableCollection extends CollectionConfig {
    selected: boolean;
    count: number | null;
    loadingCount: boolean;
}

export interface SelectableBundle {
    bundle: ContentTypeBundle;
    selected: boolean;
    expanded: boolean;
    counts: { drafts: number | null; published: number | null; tags: number | null };
    loadingCounts: boolean;
}

export interface SelectableGroup {
    id: string;
    label: string;
    icon: string;
    expanded: boolean;
    collections: SelectableCollection[];
    bundles: SelectableBundle[];
}

export interface ExportPreset {
    id: string;
    label: string;
    icon: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

@Component({
    standalone: true,
    imports: [
        CommonModule,
        MatButtonModule,
        MatCheckboxModule,
        MatIconModule,
        MatProgressBarModule, TranslatablePipe, TranslocoPipe],
    templateUrl: './export-data.page.html',
    styleUrls: ['./export-data.page.scss'],
})
export default class ExportDataPageComponent extends BaseComponent implements OnInit {
    private exportService = inject(ExportDataService);

    groups = signal<SelectableGroup[]>([]);
    isExporting = signal(false);
    exportProgress = signal<ExportProgress | null>(null);
    exportComplete = signal(false);
    exportError = signal<string | null>(null);

    presets: ExportPreset[] = [
        { id: 'all', label: 'admin.data.preset_everything', icon: 'fa-solid fa-check-double' },
        { id: 'all-content', label: 'admin.data.preset_all_content', icon: 'fa-solid fa-file-lines' },
        { id: 'all-settings', label: 'admin.data.preset_all_settings', icon: 'fa-solid fa-gear' },
    ];

    // -----------------------------------------------------------------------
    // Computed helpers
    // -----------------------------------------------------------------------

    get totalSelectedCount(): number {
        let count = 0;
        for (const g of this.groups()) {
            count += g.collections.filter((c) => c.selected).length;
            // Each bundle counts as 3 collections (drafts + published + tags)
            count += g.bundles.filter((b) => b.selected).length * 3;
        }
        return count;
    }

    get allSelected(): boolean {
        const gs = this.groups();
        if (gs.length === 0) return false;
        return gs.every(
            (g) =>
                g.collections.every((c) => c.selected) &&
                g.bundles.every((b) => b.selected),
        );
    }

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    ngOnInit(): void {
        this.loadGroups();
    }

    // -----------------------------------------------------------------------
    // Initialisation
    // -----------------------------------------------------------------------

    private loadGroups(): void {
        const collectionGroups: CollectionGroup[] = this.exportService.getCollectionGroups();

        const selectableGroups: SelectableGroup[] = collectionGroups.map((g) => ({
            id: g.id,
            label: g.label,
            icon: g.icon,
            expanded: true,
            collections: g.collections.map((c) => ({
                ...c,
                selected: false,
                count: null,
                loadingCount: true,
            })),
            bundles: (g.contentTypeBundles || []).map((b) => ({
                bundle: b,
                selected: false,
                expanded: false,
                counts: { drafts: null, published: null, tags: null },
                loadingCounts: true,
            })),
        }));

        this.groups.set(selectableGroups);

        // Load counts for static collections
        for (const g of selectableGroups) {
            for (const col of g.collections) {
                this.loadCollectionCount(g.id, col.name);
            }
            for (const sb of g.bundles) {
                this.loadBundleCounts(g.id, sb.bundle);
            }
        }
    }

    private loadCollectionCount(groupId: string, collectionName: string): void {
        this.exportService
            .getCollectionCount(collectionName)
            .then((count) => {
                this.groups.update((gs) =>
                    gs.map((g) =>
                        g.id === groupId
                            ? {
                                  ...g,
                                  collections: g.collections.map((c) =>
                                      c.name === collectionName
                                          ? { ...c, count, loadingCount: false }
                                          : c,
                                  ),
                              }
                            : g,
                    ),
                );
            })
            .catch(() => {
                this.groups.update((gs) =>
                    gs.map((g) =>
                        g.id === groupId
                            ? {
                                  ...g,
                                  collections: g.collections.map((c) =>
                                      c.name === collectionName
                                          ? { ...c, count: 0, loadingCount: false }
                                          : c,
                                  ),
                              }
                            : g,
                    ),
                );
            });
    }

    private loadBundleCounts(groupId: string, bundle: ContentTypeBundle): void {
        const slug = bundle.contentTypeSlug;

        Promise.all([
            this.exportService.getCollectionCount(bundle.draftsCollection.name).catch(() => 0),
            this.exportService.getCollectionCount(bundle.publishedCollection.name).catch(() => 0),
            this.exportService.getCollectionCount(bundle.tagsCollection.name).catch(() => 0),
        ]).then(([drafts, published, tags]) => {
            this.groups.update((gs) =>
                gs.map((g) =>
                    g.id === groupId
                        ? {
                              ...g,
                              bundles: g.bundles.map((b) =>
                                  b.bundle.contentTypeSlug === slug
                                      ? {
                                            ...b,
                                            counts: { drafts, published, tags },
                                            loadingCounts: false,
                                        }
                                      : b,
                              ),
                          }
                        : g,
                ),
            );
        });
    }

    // -----------------------------------------------------------------------
    // Group toggles
    // -----------------------------------------------------------------------

    toggleGroupExpanded(groupId: string): void {
        this.groups.update((gs) =>
            gs.map((g) => (g.id === groupId ? { ...g, expanded: !g.expanded } : g)),
        );
    }

    toggleGroup(groupId: string, checked: boolean): void {
        this.groups.update((gs) =>
            gs.map((g) =>
                g.id === groupId
                    ? {
                          ...g,
                          collections: g.collections.map((c) => ({ ...c, selected: checked })),
                          bundles: g.bundles.map((b) => ({ ...b, selected: checked })),
                      }
                    : g,
            ),
        );
    }

    isGroupFullySelected(group: SelectableGroup): boolean {
        return (
            group.collections.every((c) => c.selected) &&
            group.bundles.every((b) => b.selected) &&
            (group.collections.length > 0 || group.bundles.length > 0)
        );
    }

    isGroupPartiallySelected(group: SelectableGroup): boolean {
        const anySelected =
            group.collections.some((c) => c.selected) ||
            group.bundles.some((b) => b.selected);
        return anySelected && !this.isGroupFullySelected(group);
    }

    /**
     * Get human-readable names for referenced content types by their slugs.
     */
    getReferencedNames(slugs: string[]): string {
        const names: string[] = [];
        for (const g of this.groups()) {
            for (const b of g.bundles) {
                if (slugs.includes(b.bundle.contentTypeSlug)) {
                    names.push(b.bundle.contentTypeName);
                }
            }
        }
        return names.join(', ');
    }

    // -----------------------------------------------------------------------
    // Collection toggles
    // -----------------------------------------------------------------------

    toggleCollection(groupId: string, name: string): void {
        this.groups.update((gs) =>
            gs.map((g) =>
                g.id === groupId
                    ? {
                          ...g,
                          collections: g.collections.map((c) =>
                              c.name === name ? { ...c, selected: !c.selected } : c,
                          ),
                      }
                    : g,
            ),
        );
    }

    // -----------------------------------------------------------------------
    // Bundle toggles
    // -----------------------------------------------------------------------

    toggleBundle(groupId: string, slug: string): void {
        this.groups.update((gs) => {
            // Find the bundle being toggled to determine intent
            const group = gs.find((g) => g.id === groupId);
            const bundle = group?.bundles.find((b) => b.bundle.contentTypeSlug === slug);
            const willSelect = bundle ? !bundle.selected : false;

            // Collect slugs that need to be auto-selected (only when selecting, not deselecting)
            const autoSelectSlugs = new Set<string>();
            if (willSelect && bundle) {
                for (const refSlug of bundle.bundle.referencedSlugs) {
                    autoSelectSlugs.add(refSlug);
                }
            }

            return gs.map((g) => ({
                ...g,
                bundles: g.bundles.map((b) => {
                    if (g.id === groupId && b.bundle.contentTypeSlug === slug) {
                        return { ...b, selected: !b.selected };
                    }
                    // Auto-select referenced bundles (only when selecting, not deselecting)
                    if (willSelect && autoSelectSlugs.has(b.bundle.contentTypeSlug) && !b.selected) {
                        return { ...b, selected: true };
                    }
                    return b;
                }),
            }));
        });
    }

    toggleBundleExpanded(groupId: string, slug: string): void {
        this.groups.update((gs) =>
            gs.map((g) =>
                g.id === groupId
                    ? {
                          ...g,
                          bundles: g.bundles.map((b) =>
                              b.bundle.contentTypeSlug === slug
                                  ? { ...b, expanded: !b.expanded }
                                  : b,
                          ),
                      }
                    : g,
            ),
        );
    }

    // -----------------------------------------------------------------------
    // Presets
    // -----------------------------------------------------------------------

    applyPreset(presetId: string): void {
        this.groups.update((gs) =>
            gs.map((g) => {
                let selectCollections = false;
                let selectBundles = false;

                switch (presetId) {
                    case 'all':
                        selectCollections = true;
                        selectBundles = true;
                        break;
                    case 'all-content':
                        selectCollections = g.id === 'content';
                        selectBundles = g.id === 'content';
                        break;
                    case 'all-settings':
                        selectCollections = g.id === 'settings-media';
                        selectBundles = false; // no bundles in settings
                        break;
                    default:
                        break;
                }

                return {
                    ...g,
                    collections: g.collections.map((c) => ({
                        ...c,
                        selected: selectCollections,
                    })),
                    bundles: g.bundles.map((b) => ({
                        ...b,
                        selected: selectBundles,
                    })),
                };
            }),
        );
    }

    // -----------------------------------------------------------------------
    // Export
    // -----------------------------------------------------------------------

    async startExport(): Promise<void> {
        // Gather selected static collections and bundles
        const selectedCollections: CollectionConfig[] = [];
        const selectedBundles: ContentTypeBundle[] = [];

        for (const g of this.groups()) {
            for (const c of g.collections) {
                if (c.selected) {
                    selectedCollections.push(c);
                }
            }
            for (const b of g.bundles) {
                if (b.selected) {
                    selectedBundles.push(b.bundle);
                }
            }
        }

        // Expand bundles into flat collection list
        const flatCollections = this.exportService.expandBundleSelections(
            selectedCollections,
            selectedBundles,
        );

        if (flatCollections.length === 0) return;

        this.isExporting.set(true);
        this.exportComplete.set(false);
        this.exportError.set(null);

        try {
            const result = await this.exportService.exportCollections(flatCollections, (progress) => {
                this.exportProgress.set(progress);
            });

            const timestamp = new Date().toISOString().split('T')[0];
            const filename = `arccms-export-${timestamp}.json`;
            this.exportService.downloadAsJson(result, filename);

            this.exportComplete.set(true);
            this.toastService.openCustomSnackbar(
                `Exported ${result.metadata.totalDocuments} documents from ${result.metadata.collectionSummary.length} collections.`,
                'success',
                'check_circle',
            );
        } catch (error: any) {
            this.exportError.set(error.message || 'Export failed');
            this.notify.error('admin.data.export.failed', { error: error.message || this.t('common.unknown_error') });
        } finally {
            this.isExporting.set(false);
        }
    }
}
