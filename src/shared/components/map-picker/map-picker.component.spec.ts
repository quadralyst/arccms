import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MapPickerComponent, PickedLocation } from './map-picker.component';
import { GeocodingService } from '../../services/geocoding.service';

const PUNE = { lat: 18.5204, lng: 73.8567, address: 'FC Road, Pune, Maharashtra' };

describe('MapPickerComponent', () => {
    let fixture: ComponentFixture<MapPickerComponent>;
    let component: MapPickerComponent;
    let searchSpy: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        searchSpy = vi.fn().mockResolvedValue([PUNE]);

        await TestBed.configureTestingModule({
            imports: [MapPickerComponent],
            providers: [{ provide: GeocodingService, useValue: { search: searchSpy } }],
        }).compileComponents();

        fixture = TestBed.createComponent(MapPickerComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    /** The last location the picker reported. */
    function captured(): PickedLocation[] {
        const seen: PickedLocation[] = [];
        component.picked.subscribe(p => seen.push(p));
        return seen;
    }

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    describe('address search', () => {
        it('does not search until asked', async () => {
            component.query.set('Pune');
            // Nominatim's policy forbids search-as-you-type against the public
            // endpoint, so typing alone must never fire a request.
            expect(searchSpy).not.toHaveBeenCalled();
        });

        it('searches on demand and lists the results', async () => {
            component.query.set('Pune');
            await component.runSearch();

            expect(searchSpy).toHaveBeenCalledWith('Pune');
            expect(component.results()).toEqual([PUNE]);
        });

        it('ignores an empty query', async () => {
            component.query.set('   ');
            await component.runSearch();

            expect(searchSpy).not.toHaveBeenCalled();
        });

        it('reports when nothing matched', async () => {
            searchSpy.mockResolvedValue([]);
            component.query.set('nowhere at all');
            await component.runSearch();

            expect(component.results()).toEqual([]);
            expect(component.searched()).toBe(true);
        });

        it('does not search while disabled', async () => {
            fixture.componentRef.setInput('disabled', true);
            component.query.set('Pune');
            await component.runSearch();

            expect(searchSpy).not.toHaveBeenCalled();
        });

        it('reports the point when a result is chosen', () => {
            const seen = captured();
            component.chooseResult(PUNE);

            expect(seen[0]).toMatchObject({ lat: PUNE.lat, lng: PUNE.lng, address: PUNE.address });
        });

        it('reports a close-in zoom, not the wide opening view', () => {
            const seen = captured();
            component.chooseResult(PUNE);

            // The map starts zoomed out over the country. Reporting the zoom
            // before moving would publish a map of India rather than a street.
            expect(seen[0].zoom).toBeGreaterThanOrEqual(15);
        });

        it('closes the result list once one is chosen', () => {
            component.results.set([PUNE]);
            component.chooseResult(PUNE);

            expect(component.results()).toEqual([]);
        });
    });

    describe('typed coordinates', () => {
        it('accepts a pasted pair', () => {
            const seen = captured();
            component.setCoordinates('18.5204, 73.8567');

            expect(seen[0]).toMatchObject({ lat: 18.5204, lng: 73.8567 });
            expect(component.coordinateError()).toBe(false);
        });

        it('reports a close-in zoom for typed coordinates too', () => {
            const seen = captured();
            component.setCoordinates('18.5204, 73.8567');

            expect(seen[0].zoom).toBeGreaterThanOrEqual(15);
        });

        it('rejects nonsense without reporting a point', () => {
            const seen = captured();
            component.setCoordinates('somewhere near the office');

            expect(seen).toHaveLength(0);
            expect(component.coordinateError()).toBe(true);
        });

        it('clears the error once a valid pair replaces the bad one', () => {
            component.setCoordinates('nope');
            expect(component.coordinateError()).toBe(true);

            component.setCoordinates('0, 0');
            expect(component.coordinateError()).toBe(false);
        });
    });

    describe('address text', () => {
        it('is editable on its own once a point exists', () => {
            // Nominatim's wording is often not what a page should print —
            // "FC Road" comes back as "Gopal Krushna Gokhale Path".
            fixture.componentRef.setInput('lat', PUNE.lat);
            fixture.componentRef.setInput('lng', PUNE.lng);
            const seen = captured();

            component.setAddress('Our Pune office');

            expect(seen[0]).toMatchObject({ address: 'Our Pune office', lat: PUNE.lat });
        });

        it('is ignored while no point is placed', () => {
            const seen = captured();
            component.setAddress('Nowhere');

            expect(seen).toHaveLength(0);
        });
    });

    describe('point state', () => {
        it('knows when a point is placed', () => {
            expect(component.hasPoint()).toBe(false);

            fixture.componentRef.setInput('lat', PUNE.lat);
            fixture.componentRef.setInput('lng', PUNE.lng);
            expect(component.hasPoint()).toBe(true);
        });

        it('treats 0,0 as a real point', () => {
            fixture.componentRef.setInput('lat', 0);
            fixture.componentRef.setInput('lng', 0);

            // Null Island is a valid coordinate; only *missing* is not.
            expect(component.hasPoint()).toBe(true);
        });

        it('formats the coordinates for display', () => {
            fixture.componentRef.setInput('lat', PUNE.lat);
            fixture.componentRef.setInput('lng', PUNE.lng);

            expect(component.coordinateText()).toBe('18.520400, 73.856700');
        });

        it('shows nothing when no point is placed', () => {
            expect(component.coordinateText()).toBe('');
        });

        it('emits a clear event', () => {
            let cleared = false;
            component.cleared.subscribe(() => (cleared = true));
            component.clear();

            expect(cleared).toBe(true);
        });
    });
});
