import { ComponentFixture, TestBed } from '@angular/core/testing';
import UnauthorizedComponent from './unauthorized.page';
import { HttpClient } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { vi, describe, beforeEach, it, expect } from 'vitest';

describe('UnauthorizedComponent — success path', () => {
    let component: UnauthorizedComponent;
    let fixture: ComponentFixture<UnauthorizedComponent>;
    let mockHttp: { get: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        mockHttp = {
            get: vi.fn().mockReturnValue(of('<html><body>403 content</body></html>')),
        };

        await TestBed.configureTestingModule({
            imports: [UnauthorizedComponent],
            providers: [
                { provide: HttpClient, useValue: mockHttp },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(UnauthorizedComponent);
        component = fixture.componentInstance;
    });

    describe('Component Creation', () => {
        it('should create', () => {
            expect(component).toBeTruthy();
        });

        it('should expose pageContent$ as an Observable (not set in ngOnInit)', () => {
            // Regression: the original implementation set pageContent inside ngOnInit
            // via a subscribe callback, which caused ExpressionChangedAfterItHasBeenChecked.
            // pageContent$ must be declared as a class field Observable so the async pipe
            // can manage the subscription and CD timing correctly.
            expect(component.pageContent$).toBeDefined();
            expect(typeof component.pageContent$.subscribe).toBe('function');
        });

        it('should not have an ngOnInit method', () => {
            // Verify the component does not use ngOnInit to wire data — that pattern
            // caused the NG0100 error. All data must flow through the async pipe.
            expect((component as any).ngOnInit).toBeUndefined();
        });
    });

    describe('Content Rendering', () => {
        it('should render the 403 HTML from the server into the DOM', () => {
            fixture.detectChanges();

            // The async pipe subscribes on detectChanges and the mock returns
            // synchronously via of(), so the content is available immediately.
            const div = fixture.nativeElement.querySelector('div');
            expect(div).toBeTruthy();
            expect(div.innerHTML).toContain('403 content');
        });

        it('should request /403.html with responseType text', () => {
            fixture.detectChanges();

            expect(mockHttp.get).toHaveBeenCalledWith('/403.html', { responseType: 'text' });
        });

        it('should only make one HTTP request (Observable is not re-subscribed on re-render)', () => {
            fixture.detectChanges();
            fixture.detectChanges();

            expect(mockHttp.get).toHaveBeenCalledTimes(1);
        });
    });
});

describe('UnauthorizedComponent — error fallback', () => {
    // Isolated describe so TestBed starts fresh with the error-throwing HTTP mock.
    let fixture: ComponentFixture<UnauthorizedComponent>;

    beforeEach(async () => {
        const mockHttp = {
            get: vi.fn().mockReturnValue(throwError(() => new Error('404 Not Found'))),
        };

        await TestBed.configureTestingModule({
            imports: [UnauthorizedComponent],
            providers: [{ provide: HttpClient, useValue: mockHttp }],
        }).compileComponents();

        fixture = TestBed.createComponent(UnauthorizedComponent);
    });

    it('should not throw when the HTTP request fails', () => {
        expect(() => fixture.detectChanges()).not.toThrow();
    });

    it('should render a fallback 403 message when /403.html cannot be loaded', () => {
        fixture.detectChanges();

        const div = fixture.nativeElement.querySelector('div');
        expect(div).toBeTruthy();
        // The fallback contains a 403 heading and a link back to signup
        expect(div.innerHTML).toContain('403');
        expect(div.innerHTML).toContain('signup');
    });
});
