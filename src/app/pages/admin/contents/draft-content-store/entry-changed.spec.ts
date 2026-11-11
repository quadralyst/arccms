import { describe, it, expect } from 'vitest';
import { EntryChangedError, changedSinceOpened, isEntryChanged, stampMillis } from './entry-changed';

// RF4 4.5: a save checks the stored entry is still the one the editor opened.
describe('entry-changed', () => {
    const at = new Date('2026-11-01T10:00:00.123Z');

    it('reads a stored time in every shape Firestore and the editor hold it', () => {
        expect(stampMillis(at)).toBe(at.getTime());
        expect(stampMillis({ toMillis: () => 42 })).toBe(42);
        expect(stampMillis({ seconds: 1, nanoseconds: 5_000_000 })).toBe(1005);
        expect(stampMillis(at.toISOString())).toBe(at.getTime());
        expect(stampMillis(null)).toBeNull();
        expect(stampMillis('not a date')).toBeNull();
    });

    it('stops a save only when both times are known and differ', () => {
        expect(changedSinceOpened(at, { seconds: Math.floor(at.getTime() / 1000), nanoseconds: 123_000_000 })).toBe(false);
        expect(changedSinceOpened(at, new Date(at.getTime() + 1))).toBe(true);
        // Keep mine (null), or an entry from before the field: nothing to compare.
        expect(changedSinceOpened(null, at)).toBe(false);
        expect(changedSinceOpened(at, undefined)).toBe(false);
    });

    it('is recognised after crossing an Observable or a transaction', () => {
        expect(isEntryChanged(new EntryChangedError())).toBe(true);
        expect(isEntryChanged({ code: 'arc/entry-changed' })).toBe(true);
        expect(isEntryChanged(new Error('offline'))).toBe(false);
        expect(isEntryChanged(null)).toBe(false);
    });
});
