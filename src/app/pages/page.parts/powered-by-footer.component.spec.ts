import { TestBed, ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { provideRouter } from '@angular/router';
import { Firestore } from '@angular/fire/firestore';
import { PoweredByFooterComponent } from './powered-by-footer.component';

vi.mock('@angular/fire/firestore', () => ({
    doc: vi.fn(),
    getDoc: vi.fn(),
    Firestore: class {},
}));

describe('PoweredByFooterComponent', () => {
    let component: PoweredByFooterComponent;
    let fixture: ComponentFixture<PoweredByFooterComponent>;
    let firestoreMock: any;

    beforeEach(async () => {
        firestoreMock = {};

        await TestBed.configureTestingModule({
            imports: [PoweredByFooterComponent],
            providers: [
                provideRouter([]),
                { provide: Firestore, useValue: firestoreMock },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(PoweredByFooterComponent);
        component = fixture.componentInstance;

        // Mock loadSettings to avoid actual Firestore call in ngOnInit
        vi.spyOn(component, 'loadSettings' as any).mockImplementation(async () => {
            // Do nothing
        });
    });

    describe('Component Creation', () => {
        it('should create', () => {
            expect(component).toBeTruthy();
        });
    });

    describe('Default Visibility', () => {
        it('should show badge by default', () => {
            expect(component.showBadge()).toBe(true);
        });

        it('should render powered-by text when visible', () => {
            fixture.detectChanges();
            const el = fixture.nativeElement.querySelector('.arc-powered-by');
            expect(el).toBeTruthy();
            expect(el.textContent).toContain('Powered by');
            expect(el.textContent).toContain('Arc CMS');
        });

        it('should have link to arccms.com', () => {
            fixture.detectChanges();
            const link = fixture.nativeElement.querySelector('.arc-powered-by a');
            expect(link).toBeTruthy();
            expect(link.getAttribute('href')).toBe('https://arccms.com');
            expect(link.getAttribute('target')).toBe('_blank');
            expect(link.getAttribute('rel')).toBe('dofollow noopener');
        });

        it('should contain correct link text', () => {
            fixture.detectChanges();
            const link = fixture.nativeElement.querySelector('.arc-powered-by a');
            expect(link.textContent).toContain('Powered by Arc CMS: an open source CMS for landing pages');
        });
    });

    describe('Hiding via Signal', () => {
        it('should not render when showBadge is false', () => {
            fixture.detectChanges(); // initial render
            component.showBadge.set(false);
            fixture.detectChanges(); // re-render after signal change
            const el = fixture.nativeElement.querySelector('.arc-powered-by');
            expect(el).toBeFalsy();
        });
    });

    describe('Route Awareness', () => {
        it('should have ngOnInit method', () => {
            expect(typeof component.ngOnInit).toBe('function');
        });
    });
});
