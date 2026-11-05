/**
 * Where to read a page of a list from. Firestore pages by cursor: a page is "after this
 * record" or "before that one", so a list can only reach a page from one it has read. The
 * cursors are kept per page and per query, and every move goes through here:
 *
 * - the first page needs no cursor;
 * - a page read before is read the same way again (Back, or the same page after a drawer closes);
 * - the next page starts after the current page's last record, the previous one ends before its first;
 * - the last page is counted from the end of the list, so Last works from anywhere;
 * - any other page cannot be reached (a page number in an address after a reload): the first page.
 *
 * A different filter, sort or page size is a different list, so nothing carries over and it opens on its first page.
 */

export type PageRead =
    | { kind: 'first' }
    | { kind: 'after'; cursor: unknown }
    | { kind: 'before'; cursor: unknown }
    | { kind: 'fromEnd'; count: number };

export interface PagePlan {
    /** The page this read lands on, which is the one asked for when it can be reached. */
    page: number;
    read: PageRead;
}

export interface PageMove {
    /** The page asked for. */
    target: number;
    /** What the list reads: its filter, sort and page size (pageQueryShape). */
    shape: string;
    /** The page on screen now, and its first and last records. */
    current: number;
    firstVisible: unknown;
    lastVisible: unknown;
    /** How many records the list has, and how many fit a page. */
    total: number;
    limit: number;
    /** Whether the query is sorted: reading from the end needs an order. */
    ordered: boolean;
}

/** What makes two reads the same list. */
export function pageQueryShape(query: { whereConditions?: unknown; orConditions?: unknown; orderByField?: unknown; orderByDirection?: unknown; limitCount?: unknown }, suffix = ''): string {
    try {
        return JSON.stringify([suffix, query.whereConditions ?? [], query.orConditions ?? [], query.orderByField ?? '', query.orderByDirection ?? '', query.limitCount ?? 0]);
    } catch {
        // A value that cannot be written out (a reference): never taken for the same list.
        return `unique-${Math.random()}`;
    }
}

export class PageCursors {
    private shape = '';
    private readonly reads = new Map<number, PageRead>();
    /** The shape the page on screen was read with, which is what its cursors belong to. */
    private screenShape = '';

    plan(move: PageMove): PagePlan {
        if (move.shape !== this.shape) {
            this.shape = move.shape;
            this.reads.clear();
        }
        if (move.target <= 0) return { page: 0, read: { kind: 'first' } };

        const known = this.reads.get(move.target);
        if (known) return { page: move.target, read: known };

        const read = this.reach(move);
        if (!read) return { page: 0, read: { kind: 'first' } };
        this.reads.set(move.target, read);
        return { page: move.target, read };
    }

    /** The page on screen now, with the list it belongs to, so its cursors are used only for that list. */
    landed(shape: string): void {
        this.screenShape = shape;
    }

    forget(): void {
        this.shape = '';
        this.screenShape = '';
        this.reads.clear();
    }

    private reach(move: PageMove): PageRead | null {
        const sameList = move.shape === this.screenShape;
        if (sameList && move.target === move.current + 1 && move.lastVisible) return { kind: 'after', cursor: move.lastVisible };
        if (sameList && move.target === move.current - 1 && move.firstVisible) return { kind: 'before', cursor: move.firstVisible };
        const lastPage = move.limit > 0 ? Math.ceil(move.total / move.limit) - 1 : 0;
        if (sameList && move.ordered && move.target === lastPage) return { kind: 'fromEnd', count: move.total - lastPage * move.limit };
        return null;
    }
}
