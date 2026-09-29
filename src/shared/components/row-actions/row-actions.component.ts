import { Component, computed, inject, input, output } from '@angular/core';
import { NgClass } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { BreakpointObserver } from '@angular/cdk/layout';
import { MatMenuModule } from '@angular/material/menu';
import { TranslocoPipe } from '@jsverse/transloco';
import { map } from 'rxjs';
import { TranslatablePipe } from '../../../app/core/i18n/translatable.pipe';
import { RowAction, RowActionSlot, RowActionsPlan, isDangerAction, planRowActions, slotAction } from './row-actions';

/** Below this width tables keep fewer icons inline. */
export const ROW_ACTIONS_COMPACT_QUERY = '(max-width: 767.98px)';

/**
 * The actions cell of a list row: a few icons, and a "more" menu when a table
 * has more actions than fit. See row-actions.ts for the rule.
 *
 * `app-global-table` renders this for every `actions` column. Hand-built
 * tables use it directly; pass `rows` (every row on the page) so all rows get
 * the same layout:
 *
 *   <arc-row-actions [actions]="actions" [row]="p" [rows]="items()"></arc-row-actions>
 *
 * An action with `onAction` runs it; one without emits `actionClick`.
 */
@Component({
    selector: 'arc-row-actions',
    standalone: true,
    imports: [NgClass, MatMenuModule, TranslocoPipe, TranslatablePipe],
    // Default change detection on purpose: `hide`, `iconFn` and `labelFn` often
    // read page state or a row changed in place, which OnPush would not notice
    // (a Block icon still showing after the user is blocked).
    template: `
        <div class="row-actions">
            @for (slot of resolvedPlan().inline; track slot.key; let i = $index) {
                @if (slot.danger && i > 0 && !resolvedPlan().inline[i - 1].danger) {
                    <span class="danger-gap" aria-hidden="true"></span>
                }
                @if (actionFor(slot); as a) {
                    <button type="button" class="action-btn" [ngClass]="a.class || ''"
                        [attr.title]="labelOf(a) | translatable" [attr.aria-label]="labelOf(a) | translatable"
                        (click)="run(a, $event)">
                        <i [class]="iconOf(a)" aria-hidden="true"></i>
                    </button>
                } @else {
                    <span class="action-slot" aria-hidden="true"></span>
                }
            }
            @if (resolvedPlan().menu.length) {
                @let items = menuItems();
                @if (items.safe.length || items.danger.length) {
                    <button type="button" class="action-btn more-btn" [matMenuTriggerFor]="moreMenu"
                        [attr.title]="'common.actions.more' | transloco"
                        [attr.aria-label]="'common.actions.more' | transloco"
                        (click)="$event.stopPropagation()">
                        <i class="fas fa-ellipsis-vertical" aria-hidden="true"></i>
                    </button>
                    <mat-menu #moreMenu="matMenu" xPosition="before" class="arc-row-actions-menu">
                        @for (a of items.safe; track a.action) {
                            <button mat-menu-item type="button" (click)="run(a)">
                                <i [class]="'menu-icon ' + menuIconOf(a)" aria-hidden="true"></i>
                                <span>{{ labelOf(a) | translatable }}</span>
                            </button>
                        }
                        @if (items.safe.length && items.danger.length) {
                            <div class="menu-divider" role="separator"></div>
                        }
                        @for (a of items.danger; track a.action) {
                            <button mat-menu-item type="button" class="danger" (click)="run(a)">
                                <i [class]="'menu-icon ' + menuIconOf(a)" aria-hidden="true"></i>
                                <span>{{ labelOf(a) | translatable }}</span>
                            </button>
                        }
                    </mat-menu>
                } @else {
                    <span class="action-slot" aria-hidden="true"></span>
                }
            }
        </div>
    `,
    styles: [`
        :host { display: inline-block; }
        .row-actions {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            white-space: nowrap;
        }
        .action-btn,
        .action-slot {
            width: 32px;
            height: 32px;
            flex: 0 0 32px;
        }
        .action-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            background: none;
            border: none;
            border-radius: 6px;
            padding: 0;
            cursor: pointer;
            font-size: 1rem;
            color: gray;
            transition: background-color 0.15s, color 0.15s;
        }
        .action-btn:hover { background: rgba(0, 0, 0, 0.05); color: #3b82f6; }
        .action-btn:focus-visible { outline: 2px solid #3b82f6; outline-offset: 1px; }
        .action-btn .text-danger:hover, .action-btn.text-danger:hover { color: #ef4444 !important; }
        .danger-gap { width: 8px; flex: 0 0 8px; }
        .menu-icon {
            width: 20px;
            margin-right: 10px;
            text-align: center;
        }
        .menu-divider {
            height: 1px;
            margin: 4px 0;
            background: rgba(0, 0, 0, 0.08);
        }
        .menu-icon { color: #6b7280; }
        button.danger span, button.danger .menu-icon { color: #dc3545; }
    `],
})
export class RowActionsComponent {
    readonly actions = input<RowAction[] | undefined>([]);
    readonly row = input<any>();
    /** Every row on the page, so each row gets the same layout. Defaults to this row alone. */
    readonly rows = input<any[] | undefined>(undefined);
    /** A plan already worked out for the whole table (the global table passes one). */
    readonly plan = input<RowActionsPlan | undefined>(undefined);
    readonly maxInline = input<number | undefined>(undefined);

    readonly actionClick = output<{ action: string; row: any }>();

    private readonly compact = toSignal(
        inject(BreakpointObserver).observe(ROW_ACTIONS_COMPACT_QUERY).pipe(map(s => s.matches)),
        { initialValue: false },
    );

    readonly resolvedPlan = computed<RowActionsPlan>(() =>
        this.plan() ?? planRowActions(this.actions(), this.rows() ?? [this.row()], {
            compact: this.compact(),
            maxInline: this.maxInline(),
        }),
    );

    /** A method, not a computed: `hide` can change without any signal changing. */
    menuItems(): { safe: RowAction[]; danger: RowAction[] } {
        const row = this.row();
        const items = this.resolvedPlan().menu
            .map(s => slotAction(s, row))
            .filter((a): a is RowAction => !!a);
        return { safe: items.filter(a => !isDangerAction(a)), danger: items.filter(a => isDangerAction(a)) };
    }

    actionFor(slot: RowActionSlot): RowAction | undefined {
        return slotAction(slot, this.row());
    }

    labelOf(a: RowAction): string {
        return a.labelFn ? a.labelFn(this.row()) : (a.label || a.action);
    }

    iconOf(a: RowAction): string {
        return a.iconFn ? a.iconFn(this.row()) : a.icon;
    }

    /**
     * Menu icons drop the colour classes (`text-primary`, `text-warning`) the
     * inline icons use: a list of labelled items in six colours reads as noise.
     * Danger items are red from the item itself.
     */
    menuIconOf(a: RowAction): string {
        return this.iconOf(a).split(/\s+/).filter(c => !/^text-/.test(c)).join(' ');
    }

    run(a: RowAction, event?: Event): void {
        // The row itself is clickable; an action must not also trigger that.
        event?.stopPropagation();
        const row = this.row();
        if (a.onAction) {
            a.onAction(row);
        } else {
            this.actionClick.emit({ action: a.action, row });
        }
    }
}
