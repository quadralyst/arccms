import {
    cloneRepeaterRows,
    isRepeaterRowEmpty,
    isRepeaterType,
    makeRowId,
    newRepeaterRow,
    normalizeRepeaterRows,
    prepareRepeaterRowsForSave,
    renumberRepeaterRows,
    REPEATER_SCHEMAS,
    RepeaterRow,
    RepeaterSchema,
    repeaterSchema,
    sortRepeaterRows,
} from './repeater.model';

const INFOCARD = REPEATER_SCHEMAS['infocard'];

/** A row with only the keys under test; the rest are filled by the helpers. */
function row(partial: Partial<RepeaterRow> & { id: string; position: number }): RepeaterRow {
    return partial as RepeaterRow;
}

describe('repeater model', () => {
    describe('schema registry', () => {
        it('recognises infocard as a repeating type', () => {
            expect(isRepeaterType('infocard')).toBe(true);
            expect(repeaterSchema('infocard')).toBe(INFOCARD);
        });

        it.each(['text', 'richtext', 'image', 'icon', 'dropdown', undefined])(
            'does not treat %s as repeating', (type) => {
                expect(isRepeaterType(type as any)).toBe(false);
                expect(repeaterSchema(type as any)).toBeNull();
            });

        it('describes the info card as icon-or-image, headline and info', () => {
            expect(INFOCARD.subFields.map(s => [s.key, s.type])).toEqual([
                ['image', 'media'],
                ['headline', 'text'],
                ['info', 'textarea'],
            ]);
        });

        it('marks only the prose sub-fields translatable', () => {
            // Read by the translation work; wrong here means an editor is
            // offered a URL to translate, or a headline they cannot.
            expect(INFOCARD.subFields.filter(s => s.translatable).map(s => s.key))
                .toEqual(['headline', 'info']);
        });

        it('gives the media sub-field a separate key for the icon', () => {
            const media = INFOCARD.subFields[0] as any;
            // Two flat row keys, so a template writes {{ image }} and
            // {{ icon }} with no nested access.
            expect(media.key).toBe('image');
            expect(media.iconKey).toBe('icon');
        });
    });

    describe('makeRowId', () => {
        it('produces distinct ids', () => {
            const ids = new Set(Array.from({ length: 200 }, () => makeRowId()));
            expect(ids.size).toBe(200);
        });

        it('still produces ids without crypto.randomUUID', () => {
            const original = globalThis.crypto?.randomUUID;
            if (original) {
                // @ts-expect-error — deliberately removing the fast path
                globalThis.crypto.randomUUID = undefined;
            }
            try {
                expect(makeRowId()).toMatch(/^r_/);
            } finally {
                if (original) globalThis.crypto.randomUUID = original;
            }
        });
    });

    describe('newRepeaterRow', () => {
        it('creates every sub-field key, with the icon slot nulled', () => {
            const created = newRepeaterRow(INFOCARD, 3);

            expect(created.position).toBe(3);
            expect(created.id).toMatch(/^r_/);
            expect(created['image']).toBe('');
            expect(created['icon']).toBeNull();
            expect(created['headline']).toBe('');
            expect(created['info']).toBe('');
        });
    });

    describe('sortRepeaterRows', () => {
        it('orders by position', () => {
            const rows = [
                row({ id: 'c', position: 30 }),
                row({ id: 'a', position: 10 }),
                row({ id: 'b', position: 20 }),
            ];
            expect(sortRepeaterRows(rows).map(r => r.id)).toEqual(['a', 'b', 'c']);
        });

        it('keeps tied rows in their existing order', () => {
            // Two rows at the same position must not swap on every render.
            const rows = [
                row({ id: 'first', position: 2 }),
                row({ id: 'second', position: 2 }),
                row({ id: 'third', position: 1 }),
            ];
            expect(sortRepeaterRows(rows).map(r => r.id)).toEqual(['third', 'first', 'second']);
        });

        it('does not mutate the input', () => {
            const rows = [row({ id: 'b', position: 2 }), row({ id: 'a', position: 1 })];
            sortRepeaterRows(rows);
            expect(rows.map(r => r.id)).toEqual(['b', 'a']);
        });
    });

    describe('renumberRepeaterRows', () => {
        it('renumbers to 1..n in current order', () => {
            const rows = [row({ id: 'a', position: 7 }), row({ id: 'b', position: 90 })];
            expect(renumberRepeaterRows(rows).map(r => r.position)).toEqual([1, 2]);
        });
    });

    describe('cloneRepeaterRows', () => {
        it('copies each row so edits cannot reach the original', () => {
            const original = [row({ id: 'a', position: 1, headline: 'Before' })];
            const copy = cloneRepeaterRows(original);

            copy[0]['headline'] = 'After';

            // The shallow spread the editor used before this existed would
            // have let a version-history snapshot change under the reader.
            expect(original[0]['headline']).toBe('Before');
        });
    });

    describe('normalizeRepeaterRows', () => {
        it('returns nothing for a non-array value', () => {
            expect(normalizeRepeaterRows(undefined, INFOCARD)).toEqual([]);
            expect(normalizeRepeaterRows('not rows', INFOCARD)).toEqual([]);
            expect(normalizeRepeaterRows({ id: 'a' }, INFOCARD)).toEqual([]);
        });

        it('fills missing sub-fields so an older document simply opens', () => {
            const [only] = normalizeRepeaterRows([{ headline: 'Just a headline' }], INFOCARD);

            expect(only['image']).toBe('');
            expect(only['icon']).toBeNull();
            expect(only['info']).toBe('');
            expect(only['headline']).toBe('Just a headline');
        });

        it('assigns an id to a row that has none', () => {
            const [only] = normalizeRepeaterRows([{ headline: 'x' }], INFOCARD);
            expect(only.id).toMatch(/^r_/);
        });

        it('preserves an existing id', () => {
            // Ids are what translations key off; regenerating one would orphan
            // every translation of that row.
            const [only] = normalizeRepeaterRows([{ id: 'r_keepme', headline: 'x' }], INFOCARD);
            expect(only.id).toBe('r_keepme');
        });

        it('assigns positions by index when absent', () => {
            const rows = normalizeRepeaterRows(
                [{ id: 'a', position: 5 }, { id: 'b' }, { id: 'c', position: 1 }],
                INFOCARD,
            );
            // 'b' has no position, so it takes its index (2).
            expect(rows.map(r => [r.id, r.position])).toEqual([['a', 5], ['b', 2], ['c', 1]]);
        });

        it('does not reorder', () => {
            // The editor re-reads rows on every change-detection pass. Sorting
            // here would reorder the list on each keystroke of a position
            // input and slide the row out from under the cursor.
            const rows = normalizeRepeaterRows(
                [{ id: 'a', position: 9 }, { id: 'b', position: 1 }],
                INFOCARD,
            );
            expect(rows.map(r => r.id)).toEqual(['a', 'b']);
        });

        it('drops entries that are not objects', () => {
            const rows = normalizeRepeaterRows(['nope', null, { id: 'a', position: 1 }], INFOCARD);
            expect(rows.map(r => r.id)).toEqual(['a']);
        });
    });

    describe('isRepeaterRowEmpty', () => {
        it('is true for a freshly added row', () => {
            expect(isRepeaterRowEmpty(newRepeaterRow(INFOCARD, 1), INFOCARD)).toBe(true);
        });

        it('is false once any sub-field has content', () => {
            const filled = { ...newRepeaterRow(INFOCARD, 1), headline: 'Something' };
            expect(isRepeaterRowEmpty(filled, INFOCARD)).toBe(false);
        });

        it('counts an icon as content even with no text', () => {
            const withIcon = {
                ...newRepeaterRow(INFOCARD, 1),
                icon: { set: 'fa', name: 'star', classes: 'fa-solid fa-star' },
            };
            expect(isRepeaterRowEmpty(withIcon, INFOCARD)).toBe(false);
        });
    });

    describe('prepareRepeaterRowsForSave', () => {
        it('sorts, renumbers and drops abandoned blank rows', () => {
            const rows = prepareRepeaterRowsForSave([
                { id: 'b', position: 20, headline: 'Second' },
                { id: 'blank', position: 15 },
                { id: 'a', position: 10, headline: 'First' },
            ], INFOCARD);

            // The blank row is the one the editor added and nobody filled in;
            // storing it would publish an empty card.
            expect(rows.map(r => [r.id, r.position, r['headline']])).toEqual([
                ['a', 1, 'First'],
                ['b', 2, 'Second'],
            ]);
        });

        it('returns an empty array when every row is blank', () => {
            expect(prepareRepeaterRowsForSave(
                [newRepeaterRow(INFOCARD, 1), newRepeaterRow(INFOCARD, 2)],
                INFOCARD,
            )).toEqual([]);
        });

        it('keeps row ids stable through a save', () => {
            const saved = prepareRepeaterRowsForSave(
                [{ id: 'r_stable', position: 4, headline: 'Keep me' }],
                INFOCARD,
            );
            expect(saved[0].id).toBe('r_stable');
        });
    });
});
