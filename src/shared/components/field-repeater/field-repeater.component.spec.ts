import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { FieldRepeaterComponent } from './field-repeater.component';
import {
    REPEATER_SCHEMAS,
    RepeaterMediaSubField,
    RepeaterRow,
} from '../../models/repeater.model';

const INFOCARD = REPEATER_SCHEMAS['infocard'];
const GALLERY = REPEATER_SCHEMAS['gallery'];
const LABELVALUE = REPEATER_SCHEMAS['labelvalue'];
const GALLERY_MEDIA = GALLERY.subFields[0] as RepeaterMediaSubField;
const MEDIA = INFOCARD.subFields[0] as RepeaterMediaSubField;

const ICON = { set: 'fa', name: 'trophy', style: 'solid', classes: 'fa-solid fa-trophy', label: 'Trophy' };

function makeRow(id: string, position: number, extra: Record<string, unknown> = {}): RepeaterRow {
    return { id, position, image: '', icon: null, headline: '', info: '', ...extra };
}

describe('FieldRepeaterComponent', () => {
    let fixture: ComponentFixture<FieldRepeaterComponent>;
    let component: FieldRepeaterComponent;
    let dialogResult: any;
    let openSpy: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        dialogResult = null;
        openSpy = vi.fn(() => ({ afterClosed: () => of(dialogResult) }));

        await TestBed.configureTestingModule({
            imports: [FieldRepeaterComponent],
            providers: [{ provide: MatDialog, useValue: { open: openSpy } }],
        }).compileComponents();

        fixture = TestBed.createComponent(FieldRepeaterComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput('schema', INFOCARD);
        fixture.componentRef.setInput('rows', []);
    });

    /** The rows the component last emitted. */
    function emitted(): RepeaterRow[] {
        let latest: RepeaterRow[] = [];
        component.rowsChange.subscribe(rows => (latest = rows));
        return latest;
    }

    function setRows(rows: RepeaterRow[]): void {
        fixture.componentRef.setInput('rows', rows);
        fixture.detectChanges();
    }

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    describe('adding and removing', () => {
        it('adds a blank row at the next position', () => {
            const seen: RepeaterRow[][] = [];
            component.rowsChange.subscribe(r => seen.push(r));

            setRows([makeRow('a', 1), makeRow('b', 2)]);
            component.addRow();

            expect(seen[0]).toHaveLength(3);
            expect(seen[0][2].position).toBe(3);
            expect(seen[0][2].id).not.toBe('');
        });

        it('starts at position 1 when there are no rows', () => {
            const seen: RepeaterRow[][] = [];
            component.rowsChange.subscribe(r => seen.push(r));

            component.addRow();
            expect(seen[0][0].position).toBe(1);
        });

        it('picks the next position above the highest, not the row count', () => {
            const seen: RepeaterRow[][] = [];
            component.rowsChange.subscribe(r => seen.push(r));

            setRows([makeRow('a', 40)]);
            component.addRow();

            // Using the count would collide with the existing row's number.
            expect(seen[0][1].position).toBe(41);
        });

        it('removes by id and renumbers the survivors', () => {
            const seen: RepeaterRow[][] = [];
            component.rowsChange.subscribe(r => seen.push(r));

            setRows([makeRow('a', 1), makeRow('b', 2), makeRow('c', 3)]);
            component.removeRow('b');

            // A hole in the numbering reads as a missing card.
            expect(seen[0].map(r => [r.id, r.position])).toEqual([['a', 1], ['c', 2]]);
        });
    });

    describe('editing values', () => {
        it('updates one sub-field of one row and leaves the rest alone', () => {
            const seen: RepeaterRow[][] = [];
            component.rowsChange.subscribe(r => seen.push(r));

            setRows([makeRow('a', 1, { headline: 'One' }), makeRow('b', 2, { headline: 'Two' })]);
            component.setValue('a', 'headline', 'Edited');

            expect(seen[0][0]['headline']).toBe('Edited');
            expect(seen[0][1]['headline']).toBe('Two');
        });

        it('does not mutate the row objects it was given', () => {
            const rows = [makeRow('a', 1, { headline: 'Original' })];
            setRows(rows);
            component.setValue('a', 'headline', 'Changed');

            expect(rows[0]['headline']).toBe('Original');
        });
    });

    describe('position', () => {
        it('stages a position without reordering', () => {
            const seen: RepeaterRow[][] = [];
            component.rowsChange.subscribe(r => seen.push(r));

            setRows([makeRow('a', 1), makeRow('b', 2)]);
            component.setPosition('a', '9');

            // Re-sorting on every keystroke slides the row out from under the
            // cursor on the way from "1" to "10".
            expect(seen[0].map(r => r.id)).toEqual(['a', 'b']);
            expect(seen[0][0].position).toBe(9);
        });

        it('ignores a non-numeric position', () => {
            const seen: RepeaterRow[][] = [];
            component.rowsChange.subscribe(r => seen.push(r));

            setRows([makeRow('a', 1)]);
            component.setPosition('a', '');

            expect(seen).toHaveLength(0);
        });

        it('reorders and renumbers on commit', () => {
            const seen: RepeaterRow[][] = [];
            component.rowsChange.subscribe(r => seen.push(r));

            setRows([makeRow('a', 9), makeRow('b', 0)]);
            component.commitPositions();

            // Typing "0" to mean "put this first" settles at 1, which is the
            // feedback that the reorder took effect.
            expect(seen[0].map(r => [r.id, r.position])).toEqual([['b', 1], ['a', 2]]);
        });
    });

    describe('media sub-field', () => {
        it('opens the picker allowing both images and icons', () => {
            setRows([makeRow('a', 1)]);
            component.pickMedia(makeRow('a', 1), MEDIA);

            expect(openSpy).toHaveBeenCalledTimes(1);
            expect(openSpy.mock.calls[0][1].data).toMatchObject({
                allowImages: true,
                allowIcons: true,
            });
        });

        it('stores a picked icon and clears any image', () => {
            const seen: RepeaterRow[][] = [];
            component.rowsChange.subscribe(r => seen.push(r));
            const row = makeRow('a', 1, { image: 'https://example.com/old.jpg' });
            setRows([row]);

            dialogResult = { type: 'submit', kind: 'icon', icon: ICON, mediaUrl: '' };
            component.pickMedia(row, MEDIA);

            // An image and an icon are alternatives — keeping both would render
            // two visuals through the template's data-arc-if pair.
            expect(seen[0][0]['icon']).toEqual(ICON);
            expect(seen[0][0]['image']).toBe('');
        });

        it('stores a picked image and clears any icon', () => {
            const seen: RepeaterRow[][] = [];
            component.rowsChange.subscribe(r => seen.push(r));
            const row = makeRow('a', 1, { icon: ICON });
            setRows([row]);

            dialogResult = { type: 'submit', kind: 'image', mediaUrl: 'https://example.com/new.jpg' };
            component.pickMedia(row, MEDIA);

            expect(seen[0][0]['image']).toBe('https://example.com/new.jpg');
            expect(seen[0][0]['icon']).toBeNull();
        });

        it('changes nothing when the picker is cancelled', () => {
            const seen: RepeaterRow[][] = [];
            component.rowsChange.subscribe(r => seen.push(r));
            const row = makeRow('a', 1, { icon: ICON });
            setRows([row]);

            dialogResult = null;
            component.pickMedia(row, MEDIA);

            expect(seen).toHaveLength(0);
        });

        it('clears both keys on remove', () => {
            const seen: RepeaterRow[][] = [];
            component.rowsChange.subscribe(r => seen.push(r));
            const row = makeRow('a', 1, { icon: ICON, image: 'https://example.com/x.jpg' });
            setRows([row]);

            component.clearMedia(row, MEDIA);

            expect(seen[0][0]['icon']).toBeNull();
            expect(seen[0][0]['image']).toBe('');
        });

        it('reads back the icon and image it stored', () => {
            const withIcon = makeRow('a', 1, { icon: ICON });
            const withImage = makeRow('b', 2, { image: 'https://example.com/x.jpg' });

            expect(component.icon(withIcon, MEDIA)).toEqual(ICON);
            expect(component.imageUrl(withIcon, MEDIA)).toBe('');
            expect(component.hasMedia(withIcon, MEDIA)).toBe(true);

            expect(component.icon(withImage, MEDIA)).toBeNull();
            expect(component.imageUrl(withImage, MEDIA)).toBe('https://example.com/x.jpg');
            expect(component.hasMedia(withImage, MEDIA)).toBe(true);

            expect(component.hasMedia(makeRow('c', 3), MEDIA)).toBe(false);
        });
    });

    describe('gallery: video and bulk add', () => {
        function galleryRow(id: string, position: number, extra: Record<string, unknown> = {}): RepeaterRow {
            return { id, position, image: '', video: '', caption: '', ...extra };
        }

        async function useGallery(rows: RepeaterRow[]) {
            fixture.componentRef.setInput('schema', GALLERY);
            fixture.componentRef.setInput('rows', rows);
            fixture.detectChanges();
        }

        it('offers bulk add for a gallery but not an info card', async () => {
            await useGallery([]);
            expect(component.bulkAddField()).toBe(GALLERY_MEDIA);

            fixture.componentRef.setInput('schema', INFOCARD);
            expect(component.bulkAddField()).toBeNull();
        });

        it('opens the picker in multi-select mode, icons off', async () => {
            await useGallery([]);
            component.addFromLibrary(GALLERY_MEDIA);

            // Icons are meaningless in a photo gallery, and multi-select only
            // makes sense for images.
            expect(openSpy.mock.calls[0][1].data).toMatchObject({ multiple: true, allowIcons: false });
        });

        it('appends one row per picked image, in order', async () => {
            const seen: RepeaterRow[][] = [];
            component.rowsChange.subscribe(r => seen.push(r));
            await useGallery([galleryRow('existing', 1, { image: 'x.jpg' })]);

            dialogResult = { type: 'submit', kind: 'image', mediaUrl: 'a.jpg', mediaUrls: ['a.jpg', 'b.jpg', 'c.jpg'] };
            component.addFromLibrary(GALLERY_MEDIA);

            expect(seen[0]).toHaveLength(4);
            expect(seen[0].slice(1).map(r => r['image'])).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
            expect(seen[0].slice(1).map(r => r.position)).toEqual([2, 3, 4]);
        });

        it('gives every bulk-added row its own id', async () => {
            const seen: RepeaterRow[][] = [];
            component.rowsChange.subscribe(r => seen.push(r));
            await useGallery([]);

            dialogResult = { type: 'submit', kind: 'image', mediaUrl: 'a.jpg', mediaUrls: ['a.jpg', 'b.jpg'] };
            component.addFromLibrary(GALLERY_MEDIA);

            const ids = seen[0].map(r => r.id);
            expect(new Set(ids).size).toBe(2);
        });

        it('falls back to the single url when the dialog returns no list', async () => {
            const seen: RepeaterRow[][] = [];
            component.rowsChange.subscribe(r => seen.push(r));
            await useGallery([]);

            dialogResult = { type: 'submit', kind: 'image', mediaUrl: 'only.jpg' };
            component.addFromLibrary(GALLERY_MEDIA);

            expect(seen[0].map(r => r['image'])).toEqual(['only.jpg']);
        });

        it('adds nothing when the picker is cancelled', async () => {
            const seen: RepeaterRow[][] = [];
            component.rowsChange.subscribe(r => seen.push(r));
            await useGallery([]);

            dialogResult = null;
            component.addFromLibrary(GALLERY_MEDIA);

            expect(seen).toHaveLength(0);
        });

        it('stores a valid YouTube link and clears the image slot', async () => {
            const seen: RepeaterRow[][] = [];
            component.rowsChange.subscribe(r => seen.push(r));
            const row = galleryRow('a', 1, { image: 'photo.jpg' });
            await useGallery([row]);

            component.setVideo(row, GALLERY_MEDIA, 'https://youtu.be/dQw4w9WgXcQ');

            expect(seen[0][0]['video']).toBe('https://youtu.be/dQw4w9WgXcQ');
            expect(seen[0][0]['image']).toBe('');
        });

        it('rejects a link that is not YouTube, storing nothing', async () => {
            const seen: RepeaterRow[][] = [];
            component.rowsChange.subscribe(r => seen.push(r));
            const row = galleryRow('a', 1);
            await useGallery([row]);

            component.setVideo(row, GALLERY_MEDIA, 'https://vimeo.com/123456');

            // Storing it would publish a blank frame with nothing to explain it.
            expect(seen).toHaveLength(0);
            expect(component.hasVideoError(row)).toBe(true);
        });

        it('clears the error once a valid link replaces the bad one', async () => {
            const row = galleryRow('a', 1);
            await useGallery([row]);

            component.setVideo(row, GALLERY_MEDIA, 'not a url');
            expect(component.hasVideoError(row)).toBe(true);

            component.setVideo(row, GALLERY_MEDIA, 'https://youtu.be/dQw4w9WgXcQ');
            expect(component.hasVideoError(row)).toBe(false);
        });

        it('empties the slot when the box is cleared', async () => {
            const seen: RepeaterRow[][] = [];
            component.rowsChange.subscribe(r => seen.push(r));
            const row = galleryRow('a', 1, { video: 'https://youtu.be/dQw4w9WgXcQ' });
            await useGallery([row]);

            component.setVideo(row, GALLERY_MEDIA, '   ');

            expect(seen[0][0]['video']).toBe('');
        });

        it('previews a video by its poster frame', async () => {
            const row = galleryRow('a', 1, { video: 'https://youtu.be/dQw4w9WgXcQ' });
            await useGallery([row]);

            // Not an iframe: the editor should not load a megabyte of player
            // JS per row.
            expect(component.videoThumb(row, GALLERY_MEDIA))
                .toBe('https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
            expect(component.hasMedia(row, GALLERY_MEDIA)).toBe(true);
        });
    });

    describe('labelvalue: heading and inline layout', () => {
        function lvRow(id: string, position: number, extra: Record<string, unknown> = {}): RepeaterRow {
            return { id, position, label: '', value: '', ...extra };
        }

        function useLabelValue(rows: RepeaterRow[], heading = '') {
            fixture.componentRef.setInput('schema', LABELVALUE);
            fixture.componentRef.setInput('rows', rows);
            fixture.componentRef.setInput('heading', heading);
            fixture.detectChanges();
        }

        it('renders a heading input for a schema that declares one', () => {
            useLabelValue([]);
            const input = fixture.nativeElement.querySelector('.repeater-heading input');

            expect(input).not.toBeNull();
            expect(input.placeholder).toBe('At a glance');
        });

        it('renders no heading input for a schema without one', () => {
            fixture.componentRef.setInput('schema', GALLERY);
            fixture.componentRef.setInput('rows', []);
            fixture.detectChanges();

            expect(fixture.nativeElement.querySelector('.repeater-heading')).toBeNull();
        });

        it('shows the stored heading', () => {
            useLabelValue([], 'Key facts');
            expect(fixture.nativeElement.querySelector('.repeater-heading input').value).toBe('Key facts');
        });

        it('emits heading edits separately from the rows', () => {
            const headings: string[] = [];
            const rowEmissions: RepeaterRow[][] = [];
            component.headingChange.subscribe(h => headings.push(h));
            component.rowsChange.subscribe(r => rowEmissions.push(r));
            useLabelValue([lvRow('a', 1)]);

            component.setHeading('Key facts');

            // The heading lives beside the rows, not inside them.
            expect(headings).toEqual(['Key facts']);
            expect(rowEmissions).toHaveLength(0);
        });

        it('lays the sub-fields out inline', () => {
            useLabelValue([lvRow('a', 1)]);
            const fields = fixture.nativeElement.querySelector('.repeater-fields');

            expect(component.isInline()).toBe(true);
            expect(fields.classList.contains('inline')).toBe(true);
        });

        it('stacks the sub-fields for a schema that does not ask for inline', () => {
            setRows([makeRow('a', 1)]);
            expect(component.isInline()).toBe(false);
            expect(fixture.nativeElement.querySelector('.repeater-fields').classList.contains('inline')).toBe(false);
        });

        it('locks the heading input while translating', () => {
            useLabelValue([], 'Key facts');
            fixture.componentRef.setInput('disabled', true);
            fixture.detectChanges();

            expect(fixture.nativeElement.querySelector('.repeater-heading input').disabled).toBe(true);
        });

        it('edits a label and a value independently', () => {
            const seen: RepeaterRow[][] = [];
            component.rowsChange.subscribe(r => seen.push(r));
            useLabelValue([lvRow('a', 1)]);

            component.setValue('a', 'label', 'Minimum age');
            component.setValue('a', 'value', '16 years');

            expect(seen[0][0]['label']).toBe('Minimum age');
            expect(seen[1][0]['value']).toBe('16 years');
        });
    });

    describe('when disabled', () => {
        beforeEach(() => {
            fixture.componentRef.setInput('disabled', true);
            setRows([makeRow('a', 1, { headline: 'Shared' })]);
        });

        it('does not open the media picker', () => {
            component.pickMedia(makeRow('a', 1), MEDIA);
            expect(openSpy).not.toHaveBeenCalled();
        });

        it('hides the add and remove controls', () => {
            const host: HTMLElement = fixture.nativeElement;
            expect(host.querySelector('.repeater-add')).toBeNull();
            expect(host.querySelector('.repeater-remove')).toBeNull();
        });
    });

    describe('rendering', () => {
        it('renders one block per row with the schema sub-fields', () => {
            setRows([makeRow('a', 1), makeRow('b', 2)]);
            const host: HTMLElement = fixture.nativeElement;

            expect(host.querySelectorAll('.repeater-row')).toHaveLength(2);
            expect(host.querySelectorAll('.repeater-row')[0].querySelectorAll('.repeater-field'))
                .toHaveLength(INFOCARD.subFields.length);
        });

        it('shows the empty state with no rows', () => {
            setRows([]);
            expect(fixture.nativeElement.querySelector('.repeater-empty')).not.toBeNull();
        });

        it('previews a picked icon as the glyph', () => {
            setRows([makeRow('a', 1, { icon: ICON })]);
            const glyph = fixture.nativeElement.querySelector('.repeater-media-preview i');
            expect(glyph?.className).toContain('fa-trophy');
        });
    });
});
