/**
 * Which row actions show as icons and which go into the "more actions" menu.
 *
 * Tables carry anywhere from one action to six, so the layout is a rule rather
 * than a per-page choice:
 *
 * - A table with up to `maxInline + 1` actions shows them all as icons: a menu
 *   holding a single item is worse than one more icon.
 * - Past that, the `maxInline` most useful actions stay as icons and the rest
 *   go into the menu, danger actions last behind a divider.
 * - The plan is made once per table, not per row, so every row puts the same
 *   action in the same position. An action hidden on one row leaves its space
 *   empty instead of shifting the icons after it.
 *
 * Pages only describe their actions; `priority`, `danger`, `slot` and
 * `placement` are there for the rare case the defaults get wrong.
 */

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
    /**
     * Actions that never show on the same row (Pause, Resume, Activate) share
     * one position by giving them the same slot name.
     */
    slot?: string;
    /**
     * Destructive: sorted last, red, and behind the divider in the menu.
     * Inferred from a `delete` class or a delete/remove/archive action name.
     */
    danger?: boolean;
    /** Lower comes first. Overrides the default order (see `actionPriority`). */
    priority?: number;
    /** Pin the action as an icon or into the menu. Leave unset to let the rule decide. */
    placement?: 'auto' | 'inline' | 'menu';
}

/** One position in the actions cell: an action, or alternatives that never show together. */
export interface RowActionSlot {
    key: string;
    actions: TableAction[];
    danger: boolean;
}

export interface RowActionsPlan {
    inline: RowActionSlot[];
    menu: RowActionSlot[];
}

/** Icons shown before the rest go into the menu. */
export const ROW_ACTIONS_MAX_INLINE = 2;
/** On a phone the actions cell gets one icon plus the menu. */
export const ROW_ACTIONS_MAX_INLINE_COMPACT = 1;

const DANGER_ACTIONS = new Set(['delete', 'remove', 'archive']);
const VIEW_ACTIONS = new Set(['view', 'open', 'preview']);

export function isActionVisible(action: TableAction, row: any): boolean {
    return !action.hide || !action.hide(row);
}

export function isDangerAction(action: TableAction): boolean {
    if (action.danger !== undefined) return action.danger;
    return DANGER_ACTIONS.has(action.action) || /(^|\s)delete(\s|$)/.test(action.class || '');
}

/**
 * Default order: the row-click action, then edit, then view-like actions, then
 * the rest as configured, and danger actions last.
 */
export function actionPriority(action: TableAction): number {
    if (action.priority !== undefined) return action.priority;
    if (isDangerAction(action)) return 900;
    if (action.isRowClick) return 0;
    if (action.action === 'edit') return 10;
    if (VIEW_ACTIONS.has(action.action)) return 20;
    return 100;
}

/** The action a slot shows on this row, if any. */
export function slotActionFor(slot: RowActionSlot, row: any): TableAction | undefined {
    return slot.actions.find((a) => isActionVisible(a, row));
}

export function planRowActions(
    actions: TableAction[] | undefined,
    rows: any[],
    maxInline: number = ROW_ACTIONS_MAX_INLINE,
): RowActionsPlan {
    const slots: (RowActionSlot & { order: number; priority: number })[] = [];
    (actions || []).forEach((action, order) => {
        const key = action.slot || action.action;
        let slot = slots.find((s) => s.key === key);
        if (!slot) {
            slot = { key, actions: [], danger: true, order, priority: Infinity };
            slots.push(slot);
        }
        slot.actions.push(action);
        // A slot is only as dangerous as its safest action: Disable and
        // Re-enable sharing a slot is a toggle, not a delete.
        slot.danger = slot.danger && isDangerAction(action);
        slot.priority = Math.min(slot.priority, actionPriority(action));
    });

    const used = slots
        .filter((s) => rows.some((row) => !!slotActionFor(s, row)))
        .sort((a, b) => a.priority - b.priority || a.order - b.order);
    const strip = ({ key, actions, danger }: RowActionSlot): RowActionSlot => ({ key, actions, danger });
    const pinned = (s: RowActionSlot, placement: TableAction['placement']) =>
        s.actions.some((a) => a.placement === placement);

    const limit = Math.max(0, maxInline);
    if (used.length <= limit + 1 && !used.some((s) => pinned(s, 'menu'))) {
        return { inline: used.map(strip), menu: [] };
    }

    const inline = used.filter((s) => pinned(s, 'inline'));
    for (const s of used) {
        if (inline.length >= limit) break;
        if (!inline.includes(s) && !s.danger && !pinned(s, 'menu')) inline.push(s);
    }
    const byOrder = (a: typeof used[number], b: typeof used[number]) => used.indexOf(a) - used.indexOf(b);
    inline.sort(byOrder);
    const menu = used.filter((s) => !inline.includes(s));
    // Safe actions first, then the divider, then danger.
    menu.sort((a, b) => Number(a.danger) - Number(b.danger) || byOrder(a, b));
    return { inline: inline.map(strip), menu: menu.map(strip) };
}
