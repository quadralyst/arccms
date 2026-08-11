import { ComponentFixture, TestBed } from '@angular/core/testing';
import { headerTestProviders } from '../../../../../test/header-test-providers';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import UserSettingPageComponent from './user-setting.page';
import { UserSettingService } from './user-setting.service';
import { Firestore } from '@angular/fire/firestore';

describe('UserSettingPageComponent', () => {
    let component: UserSettingPageComponent;
    let fixture: ComponentFixture<UserSettingPageComponent>;
    let mockUserSettingService: any;

    beforeEach(async () => {
        mockUserSettingService = {
            getSettings: vi.fn(() => of({
                isSignupEnabled: true,
                defaultRole: 'user',
            })),
            saveSettings: vi.fn(() => Promise.resolve()),
            settings$: of({
                isSignupEnabled: true,
                defaultRole: 'user',
            }),
        };

        await TestBed.configureTestingModule({
            imports: [
                UserSettingPageComponent,
                NoopAnimationsModule,
            ],
            providers: [
                ...headerTestProviders(),
                provideRouter([]),
                { provide: UserSettingService, useValue: mockUserSettingService },
                { provide: Firestore, useValue: {} },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(UserSettingPageComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    describe('Component Creation', () => {
        it('should create', () => {
            expect(component).toBeTruthy();
        });

        it('should load settings on init', () => {
            expect(mockUserSettingService.getSettings).toHaveBeenCalled();
        });

        it('should have availableRoles defined', () => {
            expect(component.availableRoles).toBeDefined();
            expect(component.availableRoles.length).toBeGreaterThan(0);
        });
    });

    describe('Settings State', () => {
        it('should have correct initial settings', () => {
            expect(component.userSettings?.isSignupEnabled).toBe(true);
            expect(component.userSettings?.defaultRole).toBe('user');
        });

        it('should not be loading after init', () => {
            expect(component.isLoading()).toBe(false);
        });

        it('should not be saving initially', () => {
            expect(component.isSaving()).toBe(false);
        });
    });

    describe('toggleSignup', () => {
        it('should call saveSettings when toggling signup', async () => {
            await component.toggleSignup(false);
            expect(mockUserSettingService.saveSettings).toHaveBeenCalledWith(
                expect.objectContaining({ isSignupEnabled: false })
            );
        });

        it('should reset isSaving after toggling', async () => {
            await component.toggleSignup(false);
            expect(component.isSaving()).toBe(false);
        });
    });

    describe('changeDefaultRole', () => {
        it('should call saveSettings when changing role', async () => {
            await component.changeDefaultRole('admin');
            expect(mockUserSettingService.saveSettings).toHaveBeenCalledWith(
                expect.objectContaining({ defaultRole: 'admin' })
            );
        });

        it('should reset isSaving after changing role', async () => {
            await component.changeDefaultRole('admin');
            expect(component.isSaving()).toBe(false);
        });
    });

    describe('getRoleLabel', () => {
        it('should return correct label for admin role', () => {
            expect(component.getRoleLabel('admin')).toBe('Admin');
        });

        it('should return correct label for user role', () => {
            expect(component.getRoleLabel('user')).toBe('User');
        });

        it('should return roleId if role not found', () => {
            expect(component.getRoleLabel('unknown')).toBe('unknown');
        });

        it('should return empty string for null value', () => {
            expect(component.getRoleLabel(null)).toBe('');
        });

        it('should return empty string for undefined value', () => {
            expect(component.getRoleLabel(undefined)).toBe('');
        });
    });

    describe('enableUserSetting', () => {
        it('should set isUserSettingEnabled to true', () => {
            component.isUserSettingEnabled.set(false);
            component.enableUserSetting();
            expect(component.isUserSettingEnabled()).toBe(true);
        });

        it('should update form with isSignupEnabled true', () => {
            component.enableUserSetting();
            expect(component.userSettingsForm.get('isSignupEnabled')?.value).toBe(true);
        });

        it('should mark form as dirty', () => {
            component.enableUserSetting();
            expect(component.userSettingsForm.dirty).toBe(true);
        });
    });

    describe('Form Initialization', () => {
        it('should initialize form with isSignupEnabled control', () => {
            expect(component.userSettingsForm.get('isSignupEnabled')).toBeTruthy();
        });

        it('should initialize form with defaultRole control', () => {
            expect(component.userSettingsForm.get('defaultRole')).toBeTruthy();
        });

        it('should have defaultRole as required', () => {
            component.userSettingsForm.get('defaultRole')?.setValue('');
            expect(component.userSettingsForm.get('defaultRole')?.valid).toBe(false);
        });
    });
});
