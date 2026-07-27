import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

export interface TableAction {
    icon: string; // fallback icon class
    action: string;
    label?: string; // fallback tooltip
    class?: string; // fallback class
    hide?: (row: any) => boolean;
    iconFn?: (row: any) => string;
    labelFn?: (row: any) => string;
    onAction?: (row: any) => void;
    isRowClick?: boolean;
}

export interface TableColumn {
    key: string;
    header: string;
    type?: 'text' | 'badge' | 'actions' | 'code' | 'index' | 'date' | 'tags' | 'html' | 'icon' | 'image'; // Added 'html', 'icon' and 'image'
    sortable?: boolean;

    // Config-driven options replacing TemplateRef
    dateFormat?: string; // for 'date' type
    transformFn?: (row: any) => any;
    classFn?: (row: any) => string;
    clickable?: boolean;

    actions?: TableAction[];
    badgeConfig?: {
        trueClass?: string;
        falseClass?: string;
        trueText?: string;
        falseText?: string;
        /**
         * Multi-state badges. When set, the label comes from here instead of the
         * true/false pair and the boolean `active`/`inactive` classes are left off,
         * so `classFn` alone decides the tone. Needed for anything with more than
         * two states — an email log is sent, failed, retrying, deferred, skipped,
         * suppressed or pending, and collapsing that to a green/red pair is a lie.
         */
        textFn?: (row: any) => string;
    };
    tagConfig?: {
        labelKey?: string;
        colorKey?: string;
        class?: string;
    };
    /** For 'image' columns — a thumbnail is far more readable than a raw URL. */
    imageConfig?: {
        /** Rendered thumbnail height in px (default 40). */
        height?: number;
        /** Row field to use as alt text; falls back to the column header. */
        altKey?: string;
    };
}

@Component({
    selector: 'app-global-table',
    templateUrl: './global-table.component.html',
    styleUrls: ['./global-table.component.scss'],
    standalone: true,
    imports: [CommonModule]
})
export class GlobalTableComponent {
    /**
     * Truthiness behind a `badge` column.
     *
     * Badge was the only column type that read `row[col.key]` directly and ignored
     * `transformFn`. That silently inverted any column whose raw field is a non-boolean:
     * an email log with `status: 'skipped'` is a truthy string, so the table showed a
     * green "Success" for a message that had in fact been gated and never sent.
     */
    badgeValue(col: TableColumn, row: any): boolean {
        return !!(col.transformFn ? col.transformFn(row) : row[col.key]);
    }

    /** Label for a `badge` column, honouring a multi-state `textFn` when present. */
    badgeText(col: TableColumn, row: any): string {
        if (col.badgeConfig?.textFn) return col.badgeConfig.textFn(row);
        return this.badgeValue(col, row)
            ? (col.badgeConfig?.trueText || 'Active')
            : (col.badgeConfig?.falseText || 'Inactive');
    }

    @Input() data: any[] = [];
    @Input() columns: TableColumn[] = [];
    @Input() loading = false;

    // Pagination Inputs (Required for 'index' type)
    @Input() pageIndex = 0;
    @Input() pageSize = 10;

    // Empty State Inputs
    @Input() emptyTitle = 'No Items Yet';
    @Input() emptyDescription = 'Create your first item to get started.';
    @Input() emptyIcon = 'fas fa-list-alt'; // Font Awesome class
    @Input() showEmptyAction = true;
    @Input() emptyActionLabel = 'Create Item';
    @Input() emptyActionIcon = 'fas fa-plus';

    @Input() trackByFn: (index: number, item: any) => any = (index, item) => item.id || index;

    @Output() actionClick = new EventEmitter<{ action: string, row: any }>();
    @Output() cellClick = new EventEmitter<{ key: string, row: any }>();
    @Output() emptyActionClick = new EventEmitter<void>();

    @Input() sortField: string = '';
    @Input() sortOrder: 'asc' | 'desc' = 'desc';
    @Output() sortChange = new EventEmitter<string>();

    onActionClick(action: TableAction, row: any) {
        if (action.onAction) {
            action.onAction(row);
        } else {
            this.actionClick.emit({ action: action.action, row });
        }
    }

    onCellClick(col: TableColumn, row: any) {
        if (col.clickable) {
            this.cellClick.emit({ key: col.key, row });
        }
    }

    onHeaderClick(col: TableColumn) {
        if (col.sortable) {
            this.sortChange.emit(col.key);
        }
    }

    onEmptyActionClick() {
        this.emptyActionClick.emit();
    }

    onRowClick(row: any, event: Event) {
        // Find the actions column
        const actionsColumn = this.columns.find(c => c.type === 'actions');
        if (!actionsColumn?.actions) return;

        // 1. Try to find an action explicitly marked for row click
        let targetAction = actionsColumn.actions.find(action => action.isRowClick);

        // 2. If valid target action found but it is hidden, we shouldn't click it?
        // Or should we fallback? The requirement says "default behaviour... must open first action".
        // If isRowClick is set, we should probably respect it if visible, or do nothing? 
        // User said: "clicking it opens the edit button. This must not be hardcoded".
        
        // Let's first check visibility of the target action if it exists
        if (targetAction && targetAction.hide && targetAction.hide(row)) {
            targetAction = undefined; // It's hidden, so we can't use it
        }

        // 3. Fallback: Find the first visible action if no specific row click action is defined or valid
        if (!targetAction) {
             targetAction = actionsColumn.actions.find(action => {
                // If isRowClick was explicitly set on ANOTHER action (that was hidden), 
                // should we fallback to absolute first?
                // Standard behavior: Default to first visible.
                // Configured behavior: Use configured.
                
                // If we are here, it means we didn't find a visible `isRowClick` action.
                // We should only pick the first visible one if NO action has `isRowClick` set at all?
                // Or just always fallback?
                // "The default behaviour... is that clicking it must open the first action item."
                
                if (!action.hide) return true;
                return !action.hide(row);
            });
        }

        if (targetAction) {
            // Stop propagation to prevent any parent handlers
            event.stopPropagation();
            this.onActionClick(targetAction, row);
        }
    }

    resolveDate(date: any): any {
        if (!date) return null;

        // Handle Firestore Timestamp
        if (typeof date === 'object') {
            if (typeof date.toDate === 'function') {
                return date.toDate();
            } else if ('seconds' in date && typeof date.seconds === 'number') {
                return new Date(date.seconds * 1000);
            }
        }

        return date;
    }

    /**
     * Image URL for an 'image' column. Returns '' for anything that is not a
     * usable src, so the template falls back to a dash instead of rendering a
     * broken image.
     */
    resolveImageUrl(col: TableColumn, row: any): string {
        const value = col.transformFn ? col.transformFn(row) : row[col.key];
        return typeof value === 'string' && value.trim() ? value.trim() : '';
    }

    resolveImageAlt(col: TableColumn, row: any): string {
        const altKey = col.imageConfig?.altKey;
        const alt = altKey ? row[altKey] : '';
        return typeof alt === 'string' && alt.trim() ? alt : col.header;
    }
}
