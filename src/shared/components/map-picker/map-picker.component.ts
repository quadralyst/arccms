/**
 * Places one point on a map: search an address, drag the marker, or type the
 * coordinates.
 *
 * Leaflet is loaded **lazily and only here**. A published page renders its map
 * as a keyless OpenStreetMap iframe with no script at all, so this library
 * never reaches a visitor — it exists so an editor can aim the marker.
 *
 * All three ways of setting the point are offered because none is sufficient
 * alone: Nominatim mangles informal addresses, dragging is imprecise, and
 * typing coordinates is only useful when you already have them.
 */

import { isPlatformBrowser } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    inject,
    input,
    OnDestroy,
    output,
    PLATFORM_ID,
    signal,
    ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { GeocodeResult, GeocodingService } from '../../services/geocoding.service';
import { DEFAULT_MAP_ZOOM, isValidCoordinate, parseCoordinatePair } from '../../utils/geo';

/** What the picker reports when the point moves. */
export interface PickedLocation {
    lat: number;
    lng: number;
    address: string;
    zoom: number;
}

@Component({
    selector: 'arc-map-picker',
    standalone: true,
    imports: [FormsModule, TranslocoPipe],
    templateUrl: './map-picker.component.html',
    styleUrl: './map-picker.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MapPickerComponent implements OnDestroy {
    private platform = inject(PLATFORM_ID);
    private geocoding = inject(GeocodingService);

    @ViewChild('mapHost') mapHost?: ElementRef<HTMLDivElement>;

    readonly address = input('');
    readonly lat = input<number | null>(null);
    readonly lng = input<number | null>(null);
    readonly zoom = input<number | null>(null);
    readonly disabled = input(false);

    readonly picked = output<PickedLocation>();
    readonly cleared = output<void>();

    readonly query = signal('');
    readonly results = signal<GeocodeResult[]>([]);
    readonly searching = signal(false);
    readonly searched = signal(false);
    readonly coordinateError = signal(false);
    readonly mapReady = signal(false);

    /** Leaflet's map and marker, once the library has loaded. */
    private map: any = null;
    private marker: any = null;
    private leaflet: any = null;

    async ngAfterViewInit(): Promise<void> {
        if (!isPlatformBrowser(this.platform)) return;
        await this.initMap();
    }

    ngOnDestroy(): void {
        this.map?.remove?.();
        this.map = null;
        this.marker = null;
    }

    /** Runs on Enter or the button — never per keystroke. */
    async runSearch(): Promise<void> {
        const term = this.query().trim();
        if (!term || this.disabled()) return;

        this.searching.set(true);
        this.results.set(await this.geocoding.search(term));
        this.searching.set(false);
        this.searched.set(true);
    }

    /** Moves the marker to a search result and adopts its address. */
    chooseResult(result: GeocodeResult): void {
        this.results.set([]);
        this.searched.set(false);

        // Move first, report second. `emit` reads the map's current zoom, so
        // reporting before the map has zoomed in would store the wide opening
        // view — and publish a map of the country instead of the street.
        this.moveMap(result.lat, result.lng);
        this.emit(result.lat, result.lng, result.address);
    }

    /** Accepts a hand-typed "lat, lng" pair. */
    setCoordinates(raw: string): void {
        const parsed = parseCoordinatePair(raw);
        if (!parsed) {
            this.coordinateError.set(true);
            return;
        }

        this.coordinateError.set(false);
        // Move before reporting, for the same reason as chooseResult.
        this.moveMap(parsed.lat, parsed.lng);
        this.emit(parsed.lat, parsed.lng, this.address());
    }

    /** The address is editable on its own — Nominatim's wording is often not what a page should print. */
    setAddress(value: string): void {
        if (!this.hasPoint()) return;
        this.emit(this.lat()!, this.lng()!, value);
    }

    clear(): void {
        this.results.set([]);
        this.searched.set(false);
        this.marker?.remove?.();
        this.marker = null;
        this.cleared.emit();
    }

    hasPoint(): boolean {
        return isValidCoordinate(this.lat(), this.lng());
    }

    /** "18.520400, 73.856700", for the coordinate box. */
    coordinateText(): string {
        return this.hasPoint() ? `${this.lat()!.toFixed(6)}, ${this.lng()!.toFixed(6)}` : '';
    }

    private emit(lat: number, lng: number, address: string): void {
        this.picked.emit({
            lat,
            lng,
            address,
            zoom: this.map?.getZoom?.() ?? this.zoom() ?? DEFAULT_MAP_ZOOM,
        });
    }

    /**
     * Loads Leaflet and draws the map.
     *
     * The import is dynamic so the library is fetched the first time a map
     * field is opened rather than with the admin bundle.
     */
    private async initMap(): Promise<void> {
        const host = this.mapHost?.nativeElement;
        if (!host || this.map) return;

        const leaflet = await import('leaflet');
        this.leaflet = (leaflet as any).default ?? leaflet;

        const lat = this.hasPoint() ? this.lat()! : 20.5937;
        const lng = this.hasPoint() ? this.lng()! : 78.9629;
        const zoom = this.hasPoint() ? (this.zoom() ?? DEFAULT_MAP_ZOOM) : 4;

        this.map = this.leaflet.map(host, { attributionControl: true }).setView([lat, lng], zoom);

        // Attribution is a condition of the ODbL licence, not decoration.
        this.leaflet.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(this.map);

        if (this.hasPoint()) this.placeMarker(lat, lng);

        // Clicking the map is the quickest way to correct a bad search result.
        this.map.on('click', (event: any) => {
            if (this.disabled()) return;
            this.placeMarker(event.latlng.lat, event.latlng.lng);
            this.emit(event.latlng.lat, event.latlng.lng, this.address());
        });

        this.mapReady.set(true);
    }

    private placeMarker(lat: number, lng: number): void {
        if (!this.leaflet || !this.map) return;

        if (this.marker) {
            this.marker.setLatLng([lat, lng]);
            return;
        }

        this.marker = this.leaflet.marker([lat, lng], { draggable: !this.disabled() }).addTo(this.map);
        this.marker.on('dragend', () => {
            const position = this.marker.getLatLng();
            this.emit(position.lat, position.lng, this.address());
        });
    }

    private moveMap(lat: number, lng: number): void {
        this.placeMarker(lat, lng);
        this.map?.setView?.([lat, lng], Math.max(this.map.getZoom(), DEFAULT_MAP_ZOOM));
    }
}
