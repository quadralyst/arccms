import {
    cloneRepeaterRows,
    isRepeaterRowEmpty,
    isRepeaterType,
    makeRowId,
    locationRowKeys,
    mediaRowKeys,
    newRepeaterRow,
    normalizeRepeaterRows,
    prepareRepeaterRowsForSave,
    renumberRepeaterRows,
    REPEATER_SCHEMAS,
    RepeaterRow,
    RepeaterSchema,
    repeaterHeadingKey,
    repeaterSchema,
    sortRepeaterRows,
} from './repeater.model';

const INFOCARD = REPEATER_SCHEMAS['infocard'];
const GALLERY = REPEATER_SCHEMAS['gallery'];
const LABELVALUE = REPEATER_SCHEMAS['labelvalue'];
const MAPLOCATION = REPEATER_SCHEMAS['maplocation'];

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

    describe('gallery schema', () => {
        it('recognises gallery as a repeating type', () => {
            expect(isRepeaterType('gallery')).toBe(true);
        });

        it('is a photo-or-video slot plus a caption', () => {
            expect(GALLERY.subFields.map(s => [s.key, s.type])).toEqual([
                ['image', 'media'],
                ['caption', 'text'],
            ]);
        });

        it('offers images and video but not icons', () => {
            const media = GALLERY.subFields[0] as any;
            expect(media.allowImages).toBe(true);
            expect(media.allowVideo).toBe(true);
            expect(media.allowIcons).toBeUndefined();
            expect(media.iconKey).toBeUndefined();
            expect(media.videoKey).toBe('video');
        });

        it('offers bulk add, which the info card does not', () => {
            // Building a twelve-photo gallery one row at a time is the tedium
            // this removes; an info card needs a headline per row, so bulk
            // adding would only make blank cards.
            expect((GALLERY.subFields[0] as any).allowBulkAdd).toBe(true);
            expect((INFOCARD.subFields[0] as any).allowBulkAdd).toBeUndefined();
        });

        it('marks the caption translatable', () => {
            expect(GALLERY.subFields[1].translatable).toBe(true);
        });
    });

    describe('labelvalue schema', () => {
        it('recognises labelvalue as a repeating type', () => {
            expect(isRepeaterType('labelvalue')).toBe(true);
        });

        it('is a label and a value, both required', () => {
            expect(LABELVALUE.subFields.map(s => [s.key, s.type, s.required])).toEqual([
                ['label', 'text', true],
                ['value', 'text', true],
            ]);
        });

        it('marks both sides translatable', () => {
            // "Minimum age" and "Free" are equally prose.
            expect(LABELVALUE.subFields.every(s => s.translatable)).toBe(true);
        });

        it('lays rows out inline', () => {
            // Stacked, a four-row facts list is eight inputs down a 280px column.
            expect(LABELVALUE.layout).toBe('inline');
            expect(INFOCARD.layout).toBeUndefined();
        });

        it('declares an editable, translatable heading', () => {
            expect(LABELVALUE.heading).toMatchObject({ key: 'heading', translatable: true });
            expect(LABELVALUE.heading?.placeholder).toBe('At a glance');
        });

        it('has no media slot, so no bulk add', () => {
            expect(LABELVALUE.subFields.some(s => s.type === 'media')).toBe(false);
        });
    });

    describe('repeaterHeadingKey', () => {
        it('hangs the heading off the stored field key', () => {
            // Stored beside the rows, so the field's own value stays an array.
            expect(repeaterHeadingKey('events_details', LABELVALUE)).toBe('events_details_heading');
        });

        it('is null for a schema that declares no heading', () => {
            expect(repeaterHeadingKey('events_gallery', GALLERY)).toBeNull();
            expect(repeaterHeadingKey('events_info_cards', INFOCARD)).toBeNull();
        });
    });

    describe('labelvalue rows', () => {
        it('creates a blank row with both text slots', () => {
            const created = newRepeaterRow(LABELVALUE, 1);
            expect(created['label']).toBe('');
            expect(created['value']).toBe('');
        });

        it('keeps a row with only one side filled', () => {
            // Half-filled is a work in progress, not an abandoned row.
            const half = { ...newRepeaterRow(LABELVALUE, 1), label: 'Cost' };
            expect(isRepeaterRowEmpty(half, LABELVALUE)).toBe(false);
        });

        it('drops a wholly blank row on save', () => {
            const rows = prepareRepeaterRowsForSave([
                { id: 'a', position: 1, label: 'Cost', value: 'Free' },
                newRepeaterRow(LABELVALUE, 2),
            ], LABELVALUE);
            expect(rows.map(r => r.id)).toEqual(['a']);
        });
    });

    describe('maplocation schema', () => {
        it('recognises maplocation as a repeating type', () => {
            expect(isRepeaterType('maplocation')).toBe(true);
        });

        it('is a name plus a location slot', () => {
            expect(MAPLOCATION.subFields.map(s => [s.key, s.type])).toEqual([
                ['label', 'text'],
                ['address', 'location'],
            ]);
        });

        it('spreads the location over four flat row keys', () => {
            const loc = MAPLOCATION.subFields[1] as any;
            // Flat keys so a template writes {{ lat }} and {{ address }} with
            // no nested access, and the render-time derivation can find them.
            expect(loc.key).toBe('address');
            expect(loc.latKey).toBe('lat');
            expect(loc.lngKey).toBe('lng');
            expect(loc.zoomKey).toBe('zoom');
        });

        it('marks the name and address translatable, not the coordinates', () => {
            expect(MAPLOCATION.subFields.filter(s => s.translatable).map(s => s.key))
                .toEqual(['label', 'address']);
        });

        it('declares an editable heading', () => {
            expect(MAPLOCATION.heading).toMatchObject({ key: 'heading', translatable: true });
        });
    });

    describe('locationRowKeys', () => {
        it('lists the address and all three coordinate keys', () => {
            expect(locationRowKeys(MAPLOCATION.subFields[1] as any))
                .toEqual(['address', 'lat', 'lng', 'zoom']);
        });
    });

    describe('maplocation rows', () => {
        it('nulls the coordinates on a blank row rather than zeroing them', () => {
            const created = newRepeaterRow(MAPLOCATION, 1);

            // 0,0 is a real place in the Atlantic; null means "not set".
            expect(created['address']).toBe('');
            expect(created['lat']).toBeNull();
            expect(created['lng']).toBeNull();
            expect(created['zoom']).toBeNull();
        });

        it('counts a row with only coordinates as filled', () => {
            const placed = { ...newRepeaterRow(MAPLOCATION, 1), lat: 18.5204, lng: 73.8567 };
            expect(isRepeaterRowEmpty(placed, MAPLOCATION)).toBe(false);
        });

        it('counts a wholly blank row as empty', () => {
            expect(isRepeaterRowEmpty(newRepeaterRow(MAPLOCATION, 1), MAPLOCATION)).toBe(true);
        });

        it('drops an unplaced row on save', () => {
            const rows = prepareRepeaterRowsForSave([
                { id: 'a', position: 1, label: 'Office', address: 'FC Road', lat: 18.5, lng: 73.8, zoom: 15 },
                newRepeaterRow(MAPLOCATION, 2),
            ], MAPLOCATION);
            expect(rows.map(r => r.id)).toEqual(['a']);
        });

        it('fills the coordinate slots on a row written before they existed', () => {
            const [only] = normalizeRepeaterRows([{ id: 'a', position: 1, label: 'Office' }], MAPLOCATION);
            expect(only['address']).toBe('');
            expect(only['lat']).toBeNull();
            expect(only['lng']).toBeNull();
        });

        it('keeps a coordinate of 0 through normalisation', () => {
            const [only] = normalizeRepeaterRows([{ id: 'a', position: 1, lat: 0, lng: 0 }], MAPLOCATION);
            expect(only['lat']).toBe(0);
            expect(only['lng']).toBe(0);
        });
    });

    describe('mediaRowKeys', () => {
        it('lists every alternative a media sub-field owns', () => {
            expect(mediaRowKeys(INFOCARD.subFields[0] as any)).toEqual(['image', 'icon']);
            expect(mediaRowKeys(GALLERY.subFields[0] as any)).toEqual(['image', 'video']);
        });
    });

    describe('gallery rows', () => {
        it('creates a blank row with both media slots as strings', () => {
            const created = newRepeaterRow(GALLERY, 1);
            expect(created['image']).toBe('');
            expect(created['video']).toBe('');
            expect(created['caption']).toBe('');
            // No icon slot: the schema does not offer one.
            expect('icon' in created).toBe(false);
        });

        it('counts a video-only row as filled', () => {
            const withVideo = { ...newRepeaterRow(GALLERY, 1), video: 'https://youtu.be/dQw4w9WgXcQ' };
            expect(isRepeaterRowEmpty(withVideo, GALLERY)).toBe(false);
        });

        it('counts a caption-only row as filled', () => {
            const captionOnly = { ...newRepeaterRow(GALLERY, 1), caption: 'Just words' };
            expect(isRepeaterRowEmpty(captionOnly, GALLERY)).toBe(false);
        });

        it('drops a row with neither media nor caption on save', () => {
            const rows = prepareRepeaterRowsForSave([
                { id: 'a', position: 1, image: 'https://example.com/a.jpg' },
                newRepeaterRow(GALLERY, 2),
            ], GALLERY);
            expect(rows.map(r => r.id)).toEqual(['a']);
        });

        it('fills the video slot on a row written before it existed', () => {
            const [only] = normalizeRepeaterRows([{ id: 'a', position: 1, image: 'x.jpg' }], GALLERY);
            expect(only['video']).toBe('');
            expect(only['caption']).toBe('');
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
