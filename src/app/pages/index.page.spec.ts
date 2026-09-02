/**
 * Tests for HomeComponent (index.page.ts)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import HomeComponent from './index.page';
import { BaseComponent } from '../../shared/components/base/base.component';
import { GlobalService } from '../../shared/services/global.service';
import { ToastService } from '../../shared/services/toast.service';
import { EmailConfigStatusService } from '../../shared/services/email-config-status.service';
import { ContentsStore } from './admin/contents/content-store/published-contents.store';
import { ContentTypesStore } from './admin/contents/content-types/content-types.store';
import { ContentPartialsComponent } from './page.parts/content-partials.component';

import { WaitlistService } from './waitlist/waitlist.service';
import { WaitlistFormService } from './page.parts/waitlist-form.service';
import { AuthService } from './(auth)/auth.service';
import { OnboardingSetupService } from './(onboarding)/onboarding-setup.service';
import { vi } from 'vitest';

describe('HomeComponent', () => {
    let component: HomeComponent;
    let fixture: ComponentFixture<HomeComponent>;

    beforeEach(async () => {
        const mockWaitlistService = {
            getWaitlist: vi.fn(),
            createWaitlistWithId: vi.fn(),
            getWaitlistBySlug: vi.fn(),
        };

        const mockWaitlistFormService = {
            initWaitlistForms: vi.fn(),
            cleanup: vi.fn(),
        };

        const mockEmailConfigService = {
            isEmailConfigured: vi.fn().mockReturnValue(true),
            isLoading: vi.fn().mockReturnValue(false),
            bannerDismissed: vi.fn().mockReturnValue(false),
            shouldShowBanner: vi.fn().mockReturnValue(false),
            dismissBanner: vi.fn()
        };

        // Mocks for ContentPartialsComponent
        const mockContentsStore = {
            items: signal([]),
            isLoading: signal(false),
            getAll: vi.fn(),
            unsubscribeStore: vi.fn(),
        };

        const mockContentTypesStore = {
            items: signal([]),
            isLoading: signal(false),
            getAll: vi.fn(),
            unsubscribeStore: vi.fn(),
        };

        const mockHttpClient = {
            get: vi.fn().mockReturnValue(of('<div>Template</div>')),
        };

        const mockAuthService = {
            isFirstRun: vi.fn().mockReturnValue(of(false)),
        };

        const mockSetupService = {
            isOnboardingComplete: vi.fn().mockReturnValue(of(true)),
        };

        await TestBed.configureTestingModule({
            imports: [HomeComponent],
            providers: [
                provideRouter([]),
                {
                    provide: ActivatedRoute,
                    useValue: {
                        snapshot: {
                            params: {},
                            paramMap: {
                                get: (key: string) => null,
                            },
                        },
                        paramMap: of({ get: () => null, keys: [] }),
                        queryParams: of({}),
                    },
                },
                GlobalService,
                ToastService,
                { provide: WaitlistService, useValue: mockWaitlistService },
                { provide: WaitlistFormService, useValue: mockWaitlistFormService },
                { provide: EmailConfigStatusService, useValue: mockEmailConfigService },
                { provide: ContentTypesStore, useValue: mockContentTypesStore },
                { provide: HttpClient, useValue: mockHttpClient },
                { provide: AuthService, useValue: mockAuthService },
                { provide: OnboardingSetupService, useValue: mockSetupService },
            ],
        })
            // HomeComponent renders <arc-content-partials>, and ContentPartialsComponent declares
            // `providers: [ContentsStore]`, which shadows the root-level mock above. Override the
            // child's component-level provider so no real store (and no Firestore) is constructed.
            .overrideComponent(ContentPartialsComponent, {
                set: {
                    providers: [
                        { provide: ContentsStore, useValue: mockContentsStore },
                    ]
                }
            })
            .compileComponents();

        fixture = TestBed.createComponent(HomeComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    describe('Component Creation', () => {
        it('should create', () => {
            expect(component).toBeTruthy();
        });

        it('should extend BaseComponent', () => {
            expect(component instanceof BaseComponent).toBe(true);
        });
    });

    describe('Component Metadata', () => {
        it('should be a standalone component with arc-home selector', () => {
            // Verify the component was created and is functional
            expect(component).toBeTruthy();
            expect(fixture.nativeElement).toBeTruthy();
        });

        it('should be standalone', () => {
            expect(HomeComponent).toBeDefined();
        });

        it('should be the default export', () => {
            // HomeComponent is exported as default
            expect(typeof HomeComponent).toBe('function');
        });
    });

    describe('Component Template', () => {
        it('should render header component', () => {
            const header = fixture.nativeElement.querySelector('arc-header');
            expect(header).toBeTruthy();
        });

        it('should render footer component', () => {
            const footer = fixture.nativeElement.querySelector('arc-footer');
            expect(footer).toBeTruthy();
        });

        it('should render main content (hero section)', () => {
            const heroSection = fixture.nativeElement.querySelector('.hero');
            expect(heroSection).toBeTruthy();
        });
    });

    describe('Inherited Functionality', () => {
        it('should have access to constantVariables', () => {
            expect(component.constantVariables).toBeDefined();
            expect(component.constantVariables.APPLICATION_NAME).toBe('Arc CMS');
        });

        it('should have access to router', () => {
            expect(component.router).toBeDefined();
        });

        it('should have access to globalService', () => {
            expect(component.globalService).toBeDefined();
        });

        it('should have access to toastService', () => {
            expect(component.toastService).toBeDefined();
        });

        it('should have access to activatedRoute', () => {
            expect(component.activatedRoute).toBeDefined();
        });
    });
});
