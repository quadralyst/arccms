/**
 * Row actions: the buttons at the end of a list row (view, edit, block, delete).
 *
 * Tables have anything from one action to six, so the layout is decided by a
 * rule rather than per page:
 *
 * - Up to 3 actions in the table (2 on a narrow screen): all show as icons.
 * - More than that: the top 2 (1 on a narrow screen) show as icons and the rest
 *   go into a "more" menu, where each has its label.
 * - Danger actions (delete, remove, archive, cancel) always come last: after a
 *   small gap inline, or below a divider in the menu.
 * - The count is of actions some row on the page actually shows, and every row
 *   gets the same layout. A row that hides an action keeps an empty slot, so
 *   icons stay lined up down the column and the column never grows past 3.
 *
 * Pages only describe their actions; `priority`, `danger`, `slot` and
 * `placement` are there for the rare case the defaults get it wrong.
 */
export interface RowAction {
    icon: string; // fallback icon class
    action: string;
    label?: string; // fallback tooltip
    class?: string; // fallback class
    hide?: (row: any) => boolean;
    iconFn?: (row: any) => string;
    labelFn?: (row: any) => string;
    onAction?: (row: any) => void;
    isRowClick?: boolean;
    /**
     * Destructive action: shown last, and in red in the menu. Inferred when
     * unset from the action name (delete, remove, archive, cancel) or a
     * `class` of `delete`.
     */
    danger?: boolean;
    /**
     * Lower comes first. Defaults: edit 10; view, open and preview 20; others
     * 50 in the order given; danger actions 90.
     */
    priority?: number;
    /**
     * Actions that never show on the same row (activate / pause / resume) share
     * a slot name so they take one position instead of three. The slot's place
     * and danger come from its first action.
     */
    slot?: string;
    /** Force an action inline or into the menu. Rarely needed. */
    placement?: 'auto' | 'inline' | 'menu';
}

/** One position in the actions column: a single action, or alternates sharing a `slot`. */
export interface RowActionSlot {
    key: string;
    actions: RowAction[];
    danger: boolean;
}

export interface RowActionsPlan {
    inline: RowActionSlot[];
    menu: RowActionSlot[];
}

export interface RowActionsOptions {
    /** Narrow screen: fewer icons inline. */
    compact?: boolean;
    /** Icons kept inline once the menu is in use (default 2, 1 when compact). */
    maxInline?: number;
}

const DANGER_NAMES = ['delete', 'remove', 'archive', 'cancel'];
const PRIMARY_VIEW_NAMES = ['view', 'open', 'preview'];

export function isDangerAction(a: RowAction): boolean {
    if (a.danger !== undefined) return a.danger;
    return DANGER_NAMES.includes(a.action) || (a.class || '').split(/\s+/).includes('delete');
}

function priorityOf(a: RowAction): number {
    if (a.priority !== undefined) return a.priority;
    if (isDangerAction(a)) return 90;
    if (a.action === 'edit') return 10;
    if (PRIMARY_VIEW_NAMES.includes(a.action)) return 20;
    return 50;
}

export function isActionVisible(a: RowAction, row: any): boolean {
    return !a.hide || !a.hide(row);
}

/** The action a slot shows on this row, or undefined when all its actions are hidden. */
export function slotAction(slot: RowActionSlot, row: any): RowAction | undefined {
    return slot.actions.find(a => isActionVisible(a, row));
}

/** Decide which actions show as icons and which go into the menu, for a whole table. */
export function planRowActions(actions: RowAction[] | undefined, rows: any[], options: RowActionsOptions = {}): RowActionsPlan {
    const compact = !!options.compact;

    // Group alternates into slots, ordered by priority (stable on config order).
    const slots: (RowActionSlot & { priority: number; index: number; placement: RowAction['placement'] })[] = [];
    (actions || []).forEach((a, index) => {
        const key = a.slot || a.action;
        const existing = slots.find(s => s.key === key);
        if (existing) {
            existing.actions.push(a);
            return;
        }
        slots.push({ key, actions: [a], danger: isDangerAction(a), priority: priorityOf(a), index, placement: a.placement });
    });
    slots.sort((x, y) => x.priority - y.priority || x.index - y.index);

    // Only slots some row on this page actually shows. Counting these rather
    // than the most on any one row keeps the column to 3 positions: rows that
    // show different actions would otherwise need a slot for each.
    const used = slots.filter(s => rows.some(r => !!slotAction(s, r)));

    const allInlineUpTo = compact ? 2 : 3;
    const forcedMenu = used.filter(s => s.placement === 'menu');
    if (used.length <= allInlineUpTo && forcedMenu.length === 0) {
        return { inline: used.map(strip), menu: [] };
    }

    const budget = options.maxInline ?? (compact ? 1 : 2);
    const inline = used.filter(s => s.placement === 'inline');
    for (const s of used) {
        if (inline.length >= budget) break;
        if (!inline.includes(s) && !s.danger && s.placement !== 'menu') inline.push(s);
    }
    const inlineInOrder = used.filter(s => inline.includes(s));
    const menu = used.filter(s => !inline.includes(s));
    return { inline: inlineInOrder.map(strip), menu: menu.map(strip) };
}

function strip(s: RowActionSlot): RowActionSlot {
    return { key: s.key, actions: s.actions, danger: s.danger };
}
