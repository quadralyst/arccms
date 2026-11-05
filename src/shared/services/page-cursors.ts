/**
 * Where to read a page of a list from. Firestore pages by cursor: a page is "after this
 * record" or "before that one", so a list can only reach a page from the one on screen:
 *
 * - the first page needs no cursor;
 * - the same page is read the same way again (a drawer closed, a record changed);
 * - the next page starts after the last record on screen, the previous one ends before
 *   the first: always the records on screen now, so a record added or removed since can
 *   never fall between two pages;
 * - the last page is counted from the end of the list, from the total as it is now, so
 *   Last works from anywhere and stays the last page when the list grows or shrinks;
 * - any other page cannot be reached (a page number in an address after a reload): the first page.
 *
 * A different collection, filter, sort or page size is a different list, so nothing carries
 * over and it opens on its first page.
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
    /** What the list reads: its collection, filter, sort and page size (pageQueryShape). */
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

const FIRST: PagePlan = { page: 0, read: { kind: 'first' } };

/** What makes two reads the same list. */
export function pageQueryShape(query: { whereConditions?: unknown; orConditions?: unknown; orderByField?: unknown; orderByDirection?: unknown; limitCount?: unknown }, collection = ''): string {
    try {
        return JSON.stringify([collection, query.whereConditions ?? [], query.orConditions ?? [], query.orderByField ?? '', query.orderByDirection ?? '', query.limitCount ?? 0]);
    } catch {
        // A value that cannot be written out (a reference): never taken for the same list.
        return `unique-${Math.random()}`;
    }
}

function lastPageOf(total: number, limit: number): number {
    return limit > 0 ? Math.ceil(total / limit) - 1 : 0;
}

export class PageCursors {
    /** How the page with records on screen was read, which is how to read it again. */
    private screen: (PagePlan & { shape: string }) | null = null;

    plan(move: PageMove): PagePlan {
        if (move.target <= 0 || move.shape !== this.screen?.shape) return FIRST;

        const lastPage = lastPageOf(move.total, move.limit);
        const fromEnd = (page: number): PagePlan =>
            page > 0 && move.ordered ? { page, read: { kind: 'fromEnd', count: move.total - page * move.limit } } : FIRST;

        // The last page stays the last page; past the end, the records on screen are not a page. Both count from the end again.
        const wasLast = this.screen.read.kind === 'fromEnd';
        if ((wasLast && move.target === this.screen.page) || ((wasLast || move.current > lastPage) && move.target === lastPage)) return fromEnd(lastPage);
        if (move.target === this.screen.page) return { page: move.target, read: this.screen.read };
        if (move.target === move.current + 1 && move.lastVisible) return { page: move.target, read: { kind: 'after', cursor: move.lastVisible } };
        if (move.target === move.current - 1 && move.firstVisible) return { page: move.target, read: { kind: 'before', cursor: move.firstVisible } };
        return move.target === lastPage ? fromEnd(lastPage) : FIRST;
    }

    /**
     * A read has answered. An empty page is not kept, so stepping back from it reads the
     * page before as it was. Returns the page to read instead, or null when this one is
     * right: an empty page, a page past the end of a list that shrank, or a last page
     * counted from a total that has changed. A total of 0 beside records means the count
     * failed (DbService), which says nothing about the page.
     */
    landed(shape: string, plan: PagePlan, rows: number, total: number, limit: number): number | null {
        if (rows || plan.page === 0) this.screen = { ...plan, shape };
        if (plan.page === 0) return null;
        if (!rows) return plan.page - 1;
        if (!total || !limit) return null;
        const lastPage = lastPageOf(total, limit);
        if (plan.page > lastPage) return lastPage;
        const countedRight = plan.page === lastPage && plan.read.kind === 'fromEnd' && plan.read.count === total - lastPage * limit;
        return plan.read.kind === 'fromEnd' && !countedRight ? lastPage : null;
    }

    forget(): void {
        this.screen = null;
    }
}
