import { ComponentFixture, TestBed } from '@angular/core/testing';
import { headerTestProviders } from '../../../../../test/header-test-providers';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import UserSettingPageComponent from './user-setting.page';
import { UserSettingService } from './user-setting.service';
import { Firestore } from '@angular/fire/firestore';
import { PhoneSignInCheckService } from './phone-sign-in-check.service';

const SA = '449144539409-compute@developer.gserviceaccount.com';
const NOT_READY = {
    ready: false, smsProvider: 'msg91', problem: 'token-creator-missing', serviceAccount: SA, project: 'sanskrit-app-live',
    command: `gcloud iam service-accounts add-iam-policy-binding ${SA} --member=serviceAccount:${SA} --role=roles/iam.serviceAccountTokenCreator --project=sanskrit-app-live`,
    consoleUrl: 'https://console.cloud.google.com/iam-admin/iam?project=sanskrit-app-live',
};

describe('UserSettingPageComponent', () => {
    let component: UserSettingPageComponent;
    let fixture: ComponentFixture<UserSettingPageComponent>;
    let mockUserSettingService: any;
    let mockPhoneCheck: { check: ReturnType<typeof vi.fn> };

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

        mockPhoneCheck = { check: vi.fn(async () => ({ ready: true, smsProvider: 'msg91' })) };

        await TestBed.configureTestingModule({
            imports: [
                UserSettingPageComponent,
                NoopAnimationsModule,
            ],
            providers: [
                ...headerTestProviders(),
                provideRouter([]),
                { provide: UserSettingService, useValue: mockUserSettingService },
                { provide: PhoneSignInCheckService, useValue: mockPhoneCheck },
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

    describe('phone sign-in', () => {
        const toggleEvent = (checked: boolean) => ({ checked, source: { checked } }) as any;
        const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

        it('checks the server can sign people in before turning it on', async () => {
            await component.togglePhoneSignIn(toggleEvent(true));
            expect(mockPhoneCheck.check).toHaveBeenCalled();
            expect(mockUserSettingService.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ phoneSignIn: true }));
        });

        it('stays off, and shows the fix, when the Token Creator role is missing', async () => {
            mockPhoneCheck.check.mockResolvedValue(NOT_READY);
            const event = toggleEvent(true);
            await component.togglePhoneSignIn(event);
            expect(mockUserSettingService.saveSettings).not.toHaveBeenCalled();
            expect(event.source.checked).toBe(false);
            fixture.detectChanges();
            expect(text()).toContain('Phone sign-in needs one more step');
            expect(text()).toContain(NOT_READY.command);
            const console = (fixture.nativeElement as HTMLElement).querySelector('.phone-setup a[target="_blank"]');
            expect(console?.getAttribute('href')).toBe(NOT_READY.consoleUrl);
        });

        it('turns it on anyway when the check itself cannot run', async () => {
            mockPhoneCheck.check.mockRejectedValue(new Error('not deployed'));
            await component.togglePhoneSignIn(toggleEvent(true));
            expect(mockUserSettingService.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ phoneSignIn: true }));
        });

        it('turns it off without a check', async () => {
            await component.togglePhoneSignIn(toggleEvent(false));
            expect(mockPhoneCheck.check).not.toHaveBeenCalled();
            expect(mockUserSettingService.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ phoneSignIn: false }));
        });

        it('checks again on demand, and clears the warning once fixed', async () => {
            mockPhoneCheck.check.mockResolvedValue(NOT_READY);
            await component.togglePhoneSignIn(toggleEvent(true));
            mockPhoneCheck.check.mockResolvedValue({ ready: true, smsProvider: 'msg91' });
            await component.recheckPhone();
            fixture.detectChanges();
            expect(text()).not.toContain('Phone sign-in needs one more step');
        });

        it('does not check on load while phone sign-in is off', () => {
            expect(mockPhoneCheck.check).not.toHaveBeenCalled();
        });

        describe('already on', () => {
            async function openWith(check: unknown) {
                mockUserSettingService.getSettings.mockReturnValue(of({ isSignupEnabled: true, defaultRole: 'user', phoneSignIn: true }));
                mockPhoneCheck.check.mockResolvedValue(check);
                fixture = TestBed.createComponent(UserSettingPageComponent);
                component = fixture.componentInstance;
                fixture.detectChanges();
                await fixture.whenStable();
                fixture.detectChanges();
            }

            it('checks on load and shows the fix when people cannot finish signing in', async () => {
                await openWith(NOT_READY);
                expect(mockPhoneCheck.check).toHaveBeenCalled();
                expect(text()).toContain(NOT_READY.command);
            });

            it('warns that codes are only logged with the test SMS provider, and links to SMS settings', async () => {
                await openWith({ ready: true, smsProvider: 'log' });
                expect(text()).toContain('Codes are only logged, not sent');
                const links = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.phone-setup a')].map((a) => a.getAttribute('href'));
                expect(links).toContain('/admin/settings/sms');
            });

            it('says nothing when everything is set up', async () => {
                await openWith({ ready: true, smsProvider: 'msg91' });
                expect((fixture.nativeElement as HTMLElement).querySelector('.phone-setup')).toBeNull();
            });
        });
    });
});
