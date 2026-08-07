import { ComponentFixture, TestBed } from '@angular/core/testing';
import AuthCheckerComponent from './auth-checker.page';
import { AuthState } from './(auth)/auth.store';
import { OnboardingSetupService } from './(onboarding)/onboarding-setup.service';
import { ConstantVariables } from '../../shared/constants';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { vi, describe, beforeEach, it, expect } from 'vitest';

describe('AuthCheckerComponent', () => {
    let component: AuthCheckerComponent;
    let fixture: ComponentFixture<AuthCheckerComponent>;

    const mockAuthStore = {
        initAuthStateListener: vi.fn().mockReturnValue(of({ role: 'admin' })),
        isAuthenticated: vi.fn().mockReturnValue(false),
        isLoading: vi.fn().mockReturnValue(false),
        error: vi.fn().mockReturnValue(''),
        isSuccess: vi.fn().mockReturnValue(false),
        currentUser: vi.fn().mockReturnValue(null),
    };

    const mockSetupService = {
        shouldShowOnboarding: vi.fn().mockReturnValue(of(false)),
    };

    const mockRouter = {
        navigate: vi.fn()
    };

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [AuthCheckerComponent],
            providers: [
                { provide: AuthState, useValue: mockAuthStore },
                { provide: OnboardingSetupService, useValue: mockSetupService },
                { provide: ConstantVariables, useValue: new ConstantVariables() },
                { provide: Router, useValue: mockRouter }
            ]
        })
            .compileComponents();

        fixture = TestBed.createComponent(AuthCheckerComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should navigate to /onboarding when setup is unfinished', () => {
        mockSetupService.shouldShowOnboarding.mockReturnValue(of(true));
        component.ngOnInit();
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/onboarding']);
    });

    it('should navigate to /admin/dashboard when admin user and setup is complete', () => {
        mockSetupService.shouldShowOnboarding.mockReturnValue(of(false));
        mockAuthStore.initAuthStateListener.mockReturnValue(of({ role: 'admin' }));
        component.ngOnInit();
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/admin/dashboard']);
    });

    it('should navigate to /signup when non-admin user and setup is complete', () => {
        mockSetupService.shouldShowOnboarding.mockReturnValue(of(false));
        mockAuthStore.initAuthStateListener.mockReturnValue(of({ role: 'user' }));
        component.ngOnInit();
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/signup']);
    });
});
