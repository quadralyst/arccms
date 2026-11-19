/**
 * The row changes of the Visual Editor's row bar (specs/visual-editing-spec.md,
 * VE-D32, VE-D33): add after, move, remove and put back, and a row's picture.
 *
 * Order is written as the form editor writes it: rows in display order,
 * positions renumbered 1 to n, every row keeping its id (a translation's rows
 * are matched by id, so they stay on the right row). Pure: each returns new
 * rows and never changes the ones it is given.
 */
import {
    mediaRowKeys,
    renumberRepeaterRows,
    RepeaterMediaSubField,
    RepeaterRow,
    sortRepeaterRows,
} from '../../../../shared/models/repeater.model';

/** The rows in display order, renumbered. */
function ordered(rows: RepeaterRow[]): RepeaterRow[] {
    return sortRepeaterRows(rows.map((row) => ({ ...row })));
}

/** New rows after the row with `afterId` (null: first), renumbered. */
export function insertRowsAfter(rows: RepeaterRow[], afterId: string | null, added: RepeaterRow[]): RepeaterRow[] {
    const list = ordered(rows);
    const at = afterId === null ? 0 : list.findIndex((row) => row.id === afterId) + 1;
    // A row no longer there: added at the end.
    const index = afterId !== null && at === 0 ? list.length : at;
    list.splice(index, 0, ...added.map((row) => ({ ...row })));
    return renumberRepeaterRows(list);
}

/** The row one place earlier (-1) or later (1); unchanged at either end. */
export function moveRow(rows: RepeaterRow[], id: string, step: -1 | 1): RepeaterRow[] {
    const list = ordered(rows);
    const from = list.findIndex((row) => row.id === id);
    const to = from + step;
    if (from < 0 || to < 0 || to >= list.length) return renumberRepeaterRows(list);
    const [row] = list.splice(from, 1);
    list.splice(to, 0, row);
    return renumberRepeaterRows(list);
}

/** The rows without one, and what Undo needs to put it back: the row and its place. */
export function removeRow(rows: RepeaterRow[], id: string): { rows: RepeaterRow[]; removed: RepeaterRow | null; index: number } {
    const list = ordered(rows);
    const index = list.findIndex((row) => row.id === id);
    if (index < 0) return { rows: renumberRepeaterRows(list), removed: null, index: -1 };
    const [removed] = list.splice(index, 1);
    return { rows: renumberRepeaterRows(list), removed, index };
}

/**
 * Undo: the removed row back in its place among the rows as they are now (other
 * changes made meanwhile stay). Nothing changes when it is already there.
 */
export function restoreRow(rows: RepeaterRow[], removed: RepeaterRow, index: number): RepeaterRow[] {
    const list = ordered(rows);
    if (list.some((row) => row.id === removed.id)) return renumberRepeaterRows(list);
    list.splice(Math.max(0, Math.min(index, list.length)), 0, { ...removed });
    return renumberRepeaterRows(list);
}

/**
 * One visual on a row: the chosen image, icon or video, the others cleared, as the
 * form's row editor writes it (`{}` clears them all).
 */
export function setRowMedia(rows: RepeaterRow[], id: string, sub: RepeaterMediaSubField, chosen: Record<string, unknown>): RepeaterRow[] {
    const cleared: Record<string, unknown> = {};
    for (const key of mediaRowKeys(sub)) cleared[key] = key === sub.iconKey ? null : '';
    return rows.map((row) => (row.id === id ? { ...row, ...cleared, ...chosen } : row));
}

/** One value of one row, as typed. */
export function setRowValue(rows: RepeaterRow[], id: string, key: string, value: unknown): RepeaterRow[] {
    return rows.map((row) => (row.id === id ? { ...row, [key]: value } : row));
}

/**
 * Which way the move arrows point: across when the row beside it in the list sits
 * on the same line (cards in a grid), else up and down.
 */
export function rowsAcross(row: DOMRect | { top: number; height: number }, neighbour: { top: number } | null): boolean {
    if (!neighbour) return false;
    return Math.abs(neighbour.top - row.top) < Math.max(4, row.height / 2);
}
