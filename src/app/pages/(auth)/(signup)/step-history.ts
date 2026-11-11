/**
 * The sign-in page's steps in the browser's history, so a phone's back button goes
 * one step back in the flow instead of out of the page (RF6, 6.4).
 *
 * Every step after the first adds a history entry for the same address, marked with
 * this visit's id and the step's depth. The entry keeps the router's own state
 * (`navigationId`, `ɵrouterPageId`), so the router sees a popstate to the same address
 * and skips it. A step that takes the place of the one before (the code step once its
 * code is used, say) keeps the entry, so back never returns to a spent code.
 */

/** The key this page adds to `history.state`. */
export const STEP_HISTORY_KEY = 'arcSignInStep';

interface StepMark {
    id: string;
    depth: number;
}

/**
 * Where a popstate landed: a depth in this visit, or below this visit's first entry on
 * entries an earlier visit to sign-in left (after a reload mid-way, or back from another
 * page), where `below` is how many entries further back the page before sign-in is.
 */
export type Landing = { depth: number } | { below: number };

function markOf(state: unknown): StepMark | null {
    const mark = (state as Record<string, unknown> | null)?.[STEP_HISTORY_KEY] as Partial<StepMark> | undefined;
    return mark && typeof mark.id === 'string' && typeof mark.depth === 'number' ? { id: mark.id, depth: mark.depth } : null;
}

export class StepHistory<S extends string> {
    private trail: S[];
    private readonly id = Math.random().toString(36).slice(2);
    /** The entry the page opened on: it may carry an earlier visit's mark (back from another page). */
    private readonly base: StepMark | null;

    constructor(first: S, private readonly history: History) {
        this.trail = [first];
        this.base = markOf(history.state);
    }

    /** How many entries this visit added above the first. */
    get depth(): number {
        return this.trail.length - 1;
    }

    /** The step at a depth, or undefined. */
    stepAt(depth: number): S | undefined {
        return this.trail[depth];
    }

    /** A new step: a new entry, so back returns to the one before. */
    push(step: S): void {
        this.trail.push(step);
        this.mark();
    }

    /** A step in place of the current one: the same entry. */
    replace(step: S): void {
        this.trail[this.trail.length - 1] = step;
    }

    /** Back to a depth, taking the entries above it off the browser's history too. */
    backTo(depth: number): void {
        const steps = this.depth - depth;
        if (steps <= 0) return;
        this.trail.length = depth + 1;
        this.history.go(-steps);
    }

    /** The browser already went back to this depth: forget the steps above it. Returns the step there. */
    cutTo(depth: number): S {
        this.trail.length = Math.min(this.trail.length, depth + 1);
        return this.trail[this.trail.length - 1];
    }

    /** The browser went back but the page stays on its step: the entry again. */
    stay(): void {
        this.mark();
    }

    /** Where a popstate with this state landed. */
    landing(state: unknown): Landing {
        const mark = markOf(state);
        if (mark?.id === this.id) return { depth: mark.depth };
        if (mark && this.base && mark.id === this.base.id && mark.depth === this.base.depth) return { depth: 0 };
        // No mark: this visit's first entry, unless the page opened on an earlier visit's
        // step, when it is that visit's first entry, one below.
        if (!mark) return this.base ? { below: 1 } : { depth: 0 };
        // An earlier visit's step: its own steps and first entry are below it.
        return { below: mark.depth + 1 };
    }

    private mark(): void {
        const state = (this.history.state ?? {}) as Record<string, unknown>;
        this.history.pushState({ ...state, [STEP_HISTORY_KEY]: { id: this.id, depth: this.depth } }, '');
    }
}
