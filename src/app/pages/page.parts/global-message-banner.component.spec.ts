import { TestBed, ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { GlobalMessageBannerComponent } from './global-message-banner.component';
import { GlobalMessageService } from '../admin/(settings)/message/global-message.service';
import { IGlobalMessageSettings, DEFAULT_GLOBAL_MESSAGE_SETTINGS } from '../admin/(settings)/message/global-message.model';

describe('GlobalMessageBannerComponent', () => {
    let component: GlobalMessageBannerComponent;
    let fixture: ComponentFixture<GlobalMessageBannerComponent>;
    let mockSettingsSubject: BehaviorSubject<IGlobalMessageSettings>;
    let mockGlobalMessageService: any;

    const enabledSettings: IGlobalMessageSettings = {
        isEnabled: true,
        heading: 'Test Heading',
        message: 'Test Message',
        buttonLabel: 'Click Me',
        buttonLink: 'https://example.com',
        gradientId: 'ocean-teal',
    };

    beforeEach(async () => {
        mockSettingsSubject = new BehaviorSubject<IGlobalMessageSettings>(DEFAULT_GLOBAL_MESSAGE_SETTINGS);
        mockGlobalMessageService = {
            settings$: mockSettingsSubject.asObservable(),
        };

        await TestBed.configureTestingModule({
            imports: [GlobalMessageBannerComponent],
            providers: [
                { provide: GlobalMessageService, useValue: mockGlobalMessageService },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(GlobalMessageBannerComponent);
        component = fixture.componentInstance;
    });

    describe('Component Creation', () => {
        it('should create', () => {
            expect(component).toBeTruthy();
        });

    });

    describe('Banner Visibility', () => {
        it('should not display banner when disabled', () => {
            mockSettingsSubject.next({ ...DEFAULT_GLOBAL_MESSAGE_SETTINGS, isEnabled: false });
            fixture.detectChanges();

            const banner = fixture.nativeElement.querySelector('.arc-global-banner');
            expect(banner).toBeFalsy();
        });

        it('should display banner when enabled', () => {
            mockSettingsSubject.next(enabledSettings);
            fixture.detectChanges();

            const banner = fixture.nativeElement.querySelector('.arc-global-banner');
            expect(banner).toBeTruthy();
        });

        it('should not display banner with default (disabled) settings on first render', () => {
            // DEFAULT_GLOBAL_MESSAGE_SETTINGS has isEnabled: false.
            // The BehaviorSubject emits this synchronously — banner must be hidden immediately
            // without needing a second detectChanges() round.
            fixture.detectChanges();

            const banner = fixture.nativeElement.querySelector('.arc-global-banner');
            expect(banner).toBeFalsy();
        });
    });

    describe('Banner Content', () => {
        beforeEach(() => {
            mockSettingsSubject.next(enabledSettings);
            fixture.detectChanges();
        });

        it('should display heading', () => {
            const heading = fixture.nativeElement.querySelector('.arc-global-banner__heading');
            expect(heading.textContent).toContain('Test Heading');
        });

        it('should display message', () => {
            const message = fixture.nativeElement.querySelector('.arc-global-banner__message');
            expect(message.textContent).toContain('Test Message');
        });

        it('should display button with correct label', () => {
            const button = fixture.nativeElement.querySelector('.arc-global-banner__btn');
            expect(button).toBeTruthy();
            expect(button.textContent.trim()).toBe('Click Me');
        });

        it('should have correct button link', () => {
            const button = fixture.nativeElement.querySelector('.arc-global-banner__btn');
            expect(button.getAttribute('href')).toBe('https://example.com');
        });
    });

    describe('Button Visibility', () => {
        it('should not display button when buttonLabel is empty', () => {
            mockSettingsSubject.next({
                ...enabledSettings,
                buttonLabel: '',
                buttonLink: '',
            });
            fixture.detectChanges();

            const button = fixture.nativeElement.querySelector('.arc-global-banner__btn');
            expect(button).toBeFalsy();
        });

        it('should not display button when buttonLink is empty', () => {
            mockSettingsSubject.next({
                ...enabledSettings,
                buttonLabel: 'Test',
                buttonLink: '',
            });
            fixture.detectChanges();

            const button = fixture.nativeElement.querySelector('.arc-global-banner__btn');
            expect(button).toBeFalsy();
        });
    });

    describe('Gradient Styling', () => {
        it('should return correct gradient for getGradient()', () => {
            mockSettingsSubject.next(enabledSettings);
            fixture.detectChanges();

            const gradient = component.getGradient();
            expect(gradient).toContain('linear-gradient');
        });

        it('should return correct text color for getTextColor()', () => {
            mockSettingsSubject.next(enabledSettings);
            fixture.detectChanges();

            const textColor = component.getTextColor();
            expect(textColor).toMatch(/^#[0-9a-fA-F]{6}$/);
        });

        it('should use default gradient when gradientId is missing', () => {
            mockSettingsSubject.next({
                ...enabledSettings,
                gradientId: '',
            });
            fixture.detectChanges();

            const gradient = component.getGradient();
            expect(gradient).toContain('linear-gradient');
        });
    });

    describe('Real-time Updates', () => {
        it('should update when settings change', () => {
            // Start disabled
            mockSettingsSubject.next({ ...DEFAULT_GLOBAL_MESSAGE_SETTINGS, isEnabled: false });
            fixture.detectChanges();
            expect(fixture.nativeElement.querySelector('.arc-global-banner')).toBeFalsy();

            // Enable
            mockSettingsSubject.next(enabledSettings);
            fixture.detectChanges();
            expect(fixture.nativeElement.querySelector('.arc-global-banner')).toBeTruthy();

            // Disable again
            mockSettingsSubject.next({ ...enabledSettings, isEnabled: false });
            fixture.detectChanges();
            expect(fixture.nativeElement.querySelector('.arc-global-banner')).toBeFalsy();
        });

        it('should not re-subscribe or throw when the Observable emits after detectChanges', () => {
            // Regression: if settings were wired via a plain subscribe() in ngOnInit,
            // async emissions after CD would silently fail or throw in strict mode.
            fixture.detectChanges();

            expect(() => {
                mockSettingsSubject.next(enabledSettings);
                fixture.detectChanges();
            }).not.toThrow();

            expect(fixture.nativeElement.querySelector('.arc-global-banner')).toBeTruthy();
        });
    });
});

describe('GlobalMessageBannerComponent — NG0100 regression', () => {
    // Isolated describe so TestBed starts fresh and we can configure it with an
    // already-populated BehaviorSubject before the first createComponent() call.
    // This is the exact scenario that triggered NG0100 when settings was wired via
    // ngOnInit + .subscribe(): the BehaviorSubject emits synchronously during the
    // first CD pass, mutating the signal after the binding was already read.

    const enabledSettings: IGlobalMessageSettings = {
        isEnabled: true,
        heading: 'Regression Heading',
        message: 'Regression Message',
        buttonLabel: '',
        buttonLink: '',
        gradientId: 'ocean-teal',
    };

    beforeEach(async () => {
        const subject = new BehaviorSubject<IGlobalMessageSettings>(enabledSettings);

        await TestBed.configureTestingModule({
            imports: [GlobalMessageBannerComponent],
            providers: [
                { provide: GlobalMessageService, useValue: { settings$: subject.asObservable() } },
            ],
        }).compileComponents();
    });

    it('should not throw on first detectChanges when BehaviorSubject already holds a non-default value', () => {
        // detectChanges() triggers the first CD pass.
        // With the old ngOnInit pattern this threw:
        //   NG0100: ExpressionChangedAfterItHasBeenCheckedError
        const localFixture = TestBed.createComponent(GlobalMessageBannerComponent);
        expect(() => localFixture.detectChanges()).not.toThrow();
    });

    it('should render the banner immediately on first detectChanges without a second pass', () => {
        const localFixture = TestBed.createComponent(GlobalMessageBannerComponent);
        localFixture.detectChanges();

        // The banner must be present after a single detectChanges() call.
        // With the old pattern the value arrived too late and the banner stayed hidden.
        const banner = localFixture.nativeElement.querySelector('.arc-global-banner');
        expect(banner).toBeTruthy();
    });
});
