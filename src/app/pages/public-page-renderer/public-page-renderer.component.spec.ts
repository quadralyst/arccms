import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChangeDetectorRef, signal } from '@angular/core';
import { PublicPageRendererComponent } from './public-page-renderer.component';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { Title, Meta } from '@angular/platform-browser';
import { BehaviorSubject, EMPTY } from 'rxjs';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

import { GaTrackingService } from '../../../shared/services/ga-tracking.service';
import { LocalizationService } from '../../core/services/localization.service';

describe('PublicPageRendererComponent', () => {
    let component: PublicPageRendererComponent;
    let fixture: ComponentFixture<PublicPageRendererComponent>;
    let httpMock: HttpTestingController;
    let router: Router;
    let titleService: Title;
    let metaService: Meta;
    let mockGaTrackingService: any;

    // Spy objects
    // The header's language switcher reads `url` and subscribes to `events`.
    const routerSpy = { navigate: vi.fn(), url: '/', events: EMPTY };
    const titleSpy = { setTitle: vi.fn() };
    const metaSpy = { updateTag: vi.fn() };

    // Fresh per test: a shared subject would keep feeding components from
    // earlier tests whose injectors are already destroyed.
    let paramsSubject: BehaviorSubject<any>;

    // The header (language switcher, public search) loads localization
    // settings; a single-language stub keeps these tests off Firestore.
    const mockLocalization = {
        load: vi.fn().mockResolvedValue(undefined),
        enabledLanguages: signal([]),
        defaultLanguage: signal('en'),
        languageVariants: signal(null),
    };

    beforeEach(async () => {
        // Clear mocks before each test
        vi.clearAllMocks();

        paramsSubject = new BehaviorSubject<any>({ fileName: 'test-page' });
        const mockActivatedRoute = {
            params: paramsSubject.asObservable()
        };

        mockGaTrackingService = {
            trackPublicPageView: vi.fn()
        };

        await TestBed.configureTestingModule({
            imports: [PublicPageRendererComponent, HttpClientTestingModule],
            providers: [
                { provide: ActivatedRoute, useValue: mockActivatedRoute },
                { provide: Router, useValue: routerSpy },
                { provide: Title, useValue: titleSpy },
                { provide: Meta, useValue: metaSpy },
                { provide: GaTrackingService, useValue: mockGaTrackingService },
                { provide: LocalizationService, useValue: mockLocalization }
            ]
        }).compileComponents();

        httpMock = TestBed.inject(HttpTestingController);
        router = TestBed.inject(Router);
        titleService = TestBed.inject(Title);
        metaService = TestBed.inject(Meta);
    });

    afterEach(() => {
        if (httpMock) {
            httpMock.verify();
        }
    });

    function createComponent() {
        fixture = TestBed.createComponent(PublicPageRendererComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    }

    it('should create', () => {
        paramsSubject.next({ fileName: 'test-page' });
        createComponent();
        expect(component).toBeTruthy();
        const req = httpMock.expectOne('/pages/test-page.html');
        req.flush('');
    });

    it('should fetch page and process content correctly', () => {
        paramsSubject.next({ fileName: 'test-page' });
        createComponent();

        const mockHtml = `
      <html>
        <head>
          <title>Test Title</title>
          <meta name="description" content="Test Desc">
        </head>
        <body>
          <arc-header></arc-header>
          <h1>Content</h1>
          <arc-footer></arc-footer>
        </body>
      </html>
    `;

        const req = httpMock.expectOne('/pages/test-page.html');
        req.flush(mockHtml);

        expect(titleSpy.setTitle).toHaveBeenCalledWith('Test Title');
        expect(metaSpy.updateTag).toHaveBeenCalledWith({ name: 'description', content: 'Test Desc' });
        expect(component.hasHeader).toBe(true);
        expect(component.hasFooter).toBe(true);
    });

    it('should trigger change detection after content loads (regression test)', () => {
        // This test ensures that detectChanges is called manually after the async fetch
        // preventing the blank page issue in SSG/SSR scenarios.
        paramsSubject.next({ fileName: 'regression-test' });
        createComponent();

        // Spy on the private cdr property
        const cdr = (component as any).cdr;
        const detectChangesSpy = vi.spyOn(cdr, 'detectChanges');

        const mockHtml = '<body><p>Updated Content</p></body>';
        const req = httpMock.expectOne('/pages/regression-test.html');
        req.flush(mockHtml);

        expect(detectChangesSpy).toHaveBeenCalled();
    });

    it('should handle extension in fileName', () => {
        paramsSubject.next({ fileName: 'other.html' });
        createComponent();

        const req = httpMock.expectOne('/pages/other.html');
        req.flush('<div>Content</div>');
    });

    it('should redirect to 404 on error', () => {
        paramsSubject.next({ fileName: 'error-page' });
        createComponent();

        const req = httpMock.expectOne('/pages/error-page.html');
        req.flush('Not Found', { status: 404, statusText: 'Not Found' });

        expect(routerSpy.navigate).toHaveBeenCalledWith(['/404']);
    });
});
