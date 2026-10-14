import { signal } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { provideRouter } from '@angular/router';
import { Firestore } from '@angular/fire/firestore';
import { PoweredByFooterComponent } from './powered-by-footer.component';
import { UiStringsService } from '../../core/services/ui-strings.service';

vi.mock('@angular/fire/firestore', () => ({
    doc: vi.fn(),
    getDoc: vi.fn(),
    Firestore: class {},
}));

describe('PoweredByFooterComponent', () => {
    let component: PoweredByFooterComponent;
    let fixture: ComponentFixture<PoweredByFooterComponent>;
    let firestoreMock: any;
    let pageStrings: ReturnType<typeof signal<Record<string, string>>>;

    beforeEach(async () => {
        firestoreMock = {};
        pageStrings = signal<Record<string, string>>({});

        await TestBed.configureTestingModule({
            imports: [PoweredByFooterComponent],
            providers: [
                provideRouter([]),
                { provide: Firestore, useValue: firestoreMock },
                { provide: UiStringsService, useValue: { strings: pageStrings } },
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

        it('reads "Built with Arc CMS · your site, your code, your data", with no emoji', () => {
            fixture.detectChanges();
            const el = fixture.nativeElement.querySelector('.arc-powered-by');
            expect(el.textContent.replace(/\s+/g, ' ').trim()).toBe('Built with Arc CMS · your site, your code, your data');
            expect(el.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
        });

        it('links only the name, to arccms.com in a new tab, without dofollow', () => {
            fixture.detectChanges();
            const links = fixture.nativeElement.querySelectorAll('.arc-powered-by a');
            expect(links.length).toBe(1);
            const link = links[0];
            expect(link.textContent.trim()).toBe('Arc CMS');
            expect(link.getAttribute('href')).toBe('https://arccms.com');
            expect(link.getAttribute('target')).toBe('_blank');
            expect(link.getAttribute('rel')).toBe('noopener');
            expect(link.getAttribute('title')).toBe('Arc CMS: the open-source foundation for websites and apps you own');
        });
    });

    describe('in the page\'s language', () => {
        it('uses the powered_by and powered_by_title keys of the page\'s strings', () => {
            pageStrings.set({
                powered_by: '{link} से बना · आपकी साइट, आपका कोड, आपका डेटा',
                powered_by_title: 'हिंदी शीर्षक',
            });
            fixture.detectChanges();
            const el = fixture.nativeElement.querySelector('.arc-powered-by');
            expect(el.textContent.replace(/\s+/g, ' ').trim()).toBe('Arc CMS से बना · आपकी साइट, आपका कोड, आपका डेटा');
            const link = el.querySelector('a');
            expect(link.textContent.trim()).toBe('Arc CMS');
            expect(link.getAttribute('title')).toBe('हिंदी शीर्षक');
        });

        it('keeps the English when a translation leaves out {link}', () => {
            pageStrings.set({ powered_by: 'बिना लिंक के' });
            fixture.detectChanges();
            const el = fixture.nativeElement.querySelector('.arc-powered-by');
            expect(el.textContent).toContain('Built with');
            expect(el.querySelector('a').textContent.trim()).toBe('Arc CMS');
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

    describe('its height on the page (--arc-powered-by-height)', () => {
        it('keeps the variable equal to its height, and takes it away when it goes', () => {
            vi.stubGlobal('ResizeObserver', class {
                constructor(private callback: (entries: Array<{ target: Element }>) => void) {}
                observe(target: Element): void { this.callback([{ target }]); }
                disconnect(): void { /* nothing to stop */ }
            });
            vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 53 } as DOMRect);
            try {
                TestBed.resetTestingModule();
                TestBed.configureTestingModule({
                    imports: [PoweredByFooterComponent],
                    providers: [provideRouter([]), { provide: Firestore, useValue: {} }, { provide: UiStringsService, useValue: { strings: signal({}) } }],
                });
                const shown = TestBed.createComponent(PoweredByFooterComponent);
                vi.spyOn(shown.componentInstance, 'loadSettings' as any).mockImplementation(async () => undefined);
                shown.detectChanges();
                expect(document.documentElement.style.getPropertyValue('--arc-powered-by-height')).toBe('53px');
                shown.componentInstance.showBadge.set(false);
                shown.detectChanges();
                expect(document.documentElement.style.getPropertyValue('--arc-powered-by-height')).toBe('0px');
                shown.destroy();
                expect(document.documentElement.style.getPropertyValue('--arc-powered-by-height')).toBe('');
            } finally {
                vi.unstubAllGlobals();
                vi.restoreAllMocks();
            }
        });
    });
});
