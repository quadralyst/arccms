import { signal } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { provideRouter } from '@angular/router';
import { Firestore } from '@angular/fire/firestore';
import { getDoc } from '@angular/fire/firestore';
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

    describe('not shown before the setting is known', () => {
        const badge = (f: ComponentFixture<PoweredByFooterComponent>) => f.nativeElement.querySelector('.arc-powered-by') as HTMLElement;
        let pending: (value: unknown) => void;

        /** A footer whose read of Settings/misc waits until the test answers it. */
        function freshFooter(): ComponentFixture<PoweredByFooterComponent> {
            vi.mocked(getDoc).mockReturnValue(new Promise((resolve) => { pending = resolve; }) as any);
            const f = TestBed.createComponent(PoweredByFooterComponent);
            f.detectChanges();
            return f;
        }
        const answer = async (f: ComponentFixture<PoweredByFooterComponent>, data: object | null) => {
            pending({ exists: () => data !== null, data: () => data });
            await f.whenStable();
            f.detectChanges();
        };

        beforeEach(() => {
            localStorage.clear();
        });

        it('keeps the line in the page but hidden on a first visit, so a site that turned it off never shows it', async () => {
            const f = freshFooter();
            expect(badge(f)).toBeTruthy();
            expect(badge(f).hidden).toBe(true);
            await answer(f, { showPoweredBy: false });
            expect(badge(f)).toBeFalsy();
        });

        it('shows it once the setting says it is on', async () => {
            const f = freshFooter();
            await answer(f, { showPoweredBy: true });
            expect(badge(f).hidden).toBe(false);
        });

        it('shows it when the site has never saved the setting (on by default)', async () => {
            const f = freshFooter();
            await answer(f, null);
            expect(badge(f).hidden).toBe(false);
        });

        it('shows it when the read fails (fail open)', async () => {
            vi.spyOn(console, 'error').mockImplementation(() => undefined);
            vi.mocked(getDoc).mockRejectedValue(new Error('offline'));
            const f = TestBed.createComponent(PoweredByFooterComponent);
            f.detectChanges();
            await f.whenStable();
            f.detectChanges();
            expect(badge(f).hidden).toBe(false);
            expect(localStorage.getItem('arc-powered-by')).toBeNull();
        });

        it('remembers what it read, for the next visit', async () => {
            const off = freshFooter();
            await answer(off, { showPoweredBy: false });
            expect(localStorage.getItem('arc-powered-by')).toBe('0');
            const on = freshFooter();
            await answer(on, { showPoweredBy: true });
            expect(localStorage.getItem('arc-powered-by')).toBe('1');
        });

        it('shows at once when this browser last saw it on', () => {
            localStorage.setItem('arc-powered-by', '1');
            expect(badge(freshFooter()).hidden).toBe(false);
        });

        it('stays hidden until the read when this browser last saw it off', async () => {
            localStorage.setItem('arc-powered-by', '0');
            const f = freshFooter();
            expect(badge(f).hidden).toBe(true);
            await answer(f, { showPoweredBy: true });
            expect(badge(f).hidden).toBe(false);
        });

        it('works with storage blocked', async () => {
            vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
            vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
            const f = freshFooter();
            expect(badge(f).hidden).toBe(true);
            await answer(f, { showPoweredBy: true });
            expect(badge(f).hidden).toBe(false);
            vi.restoreAllMocks();
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
