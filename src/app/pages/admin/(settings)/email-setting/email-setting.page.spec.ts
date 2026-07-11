import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { Firestore } from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';
import { MatDialog } from '@angular/material/dialog';
import EmailSettingPageComponent from './email-setting.page';
import { EmailSettingService } from './email-setting.service';
import { of } from 'rxjs';
import { DEFAULT_EMAIL_SETTINGS } from './email-setting.model';
import { TestConnectionDialogComponent } from './test-connection-dialog.component';
import { IEmailProviderComponent } from './providers/email-provider-base';
import { FormGroup, FormControl } from '@angular/forms';

describe('EmailSettingPageComponent', () => {
    let component: EmailSettingPageComponent;
    let fixture: ComponentFixture<EmailSettingPageComponent>;
    let mockEmailSettingService: any;
    let mockDialog: any;
    let mockDialogRef: any;

    beforeEach(async () => {
        mockEmailSettingService = {
            getEmailSettings: vi.fn().mockReturnValue(of(DEFAULT_EMAIL_SETTINGS)),
            saveEmailSettings: vi.fn().mockResolvedValue(undefined),
            testEmailConnection: vi.fn().mockResolvedValue(undefined),
            monitorConnectionTest: vi.fn().mockReturnValue(of({ status: 'success', message: 'Connected' })),
        };

        mockDialogRef = {
            afterClosed: vi.fn().mockReturnValue(of({
                testEmail: 'test@example.com',
                subject: 'Test Subject',
                message: 'Test Message'
            })),
        };

        mockDialog = {
            open: vi.fn().mockReturnValue(mockDialogRef),
        };

        await TestBed.configureTestingModule({
            imports: [
                EmailSettingPageComponent,
                NoopAnimationsModule,
            ],
            providers: [
                provideRouter([]),
                { provide: Firestore, useValue: {} },
                { provide: Functions, useValue: {} },
                { provide: EmailSettingService, useValue: mockEmailSettingService },
                { provide: MatDialog, useValue: mockDialog },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(EmailSettingPageComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should have a form with shared fields', () => {
        expect(component.emailForm).toBeDefined();
        expect(component.emailForm.get('isEnabled')).toBeDefined();
        expect(component.emailForm.get('activeProvider')).toBeDefined();
        expect(component.emailForm.get('senderEmail')).toBeDefined();
        expect(component.emailForm.get('senderName')).toBeDefined();
        expect(component.emailForm.get('bccEmail')).toBeDefined();
    });

    it('should not have provider sub-groups in the parent form', () => {
        expect(component.emailForm.get('smtp')).toBeNull();
        expect(component.emailForm.get('gmail')).toBeNull();
        expect(component.emailForm.get('resend')).toBeNull();
    });

    it('should load settings on init', () => {
        expect(mockEmailSettingService.getEmailSettings).toHaveBeenCalled();
    });

    it('should seed provider form cache from loaded settings', () => {
        expect(component.providerFormCache['smtp']).toEqual(DEFAULT_EMAIL_SETTINGS.smtp);
        expect(component.providerFormCache['gmail']).toEqual(DEFAULT_EMAIL_SETTINGS.gmail);
        expect(component.providerFormCache['resend']).toEqual(DEFAULT_EMAIL_SETTINGS.resend);
    });

    it('should have three providers available', () => {
        expect(component.providers.length).toBe(3);
    });

    it('should start with provider list hidden', () => {
        expect(component.showProviderList()).toBe(false);
    });

    it('should show provider list when toggled', () => {
        component.showProviderList.set(true);
        expect(component.showProviderList()).toBe(true);
    });

    it('should start with test not passed', () => {
        expect(component.testPassed()).toBe(false);
    });

    it('startConfiguring reveals the form without enabling email', () => {
        component.startConfiguring();
        expect(component.configuring()).toBe(true);
        expect(component.emailEnabled()).toBe(false);
    });

    it('does not enable email when no valid provider is configured', () => {
        // No provider component wired up → isProviderConfigValid() is false.
        component.toggleEmail(true);
        expect(component.emailEnabled()).toBe(false);
        expect(component.emailForm.get('isEnabled')?.value).toBe(false);
        expect(mockEmailSettingService.saveEmailSettings).not.toHaveBeenCalled();
    });

    it('enables email when a valid provider is configured', () => {
        const mockProviderComponent: IEmailProviderComponent = {
            formGroup: new FormGroup({ test: new FormControl('') }),
            isConfigValid: vi.fn().mockReturnValue(true),
            getSenderEmailConstraint: vi.fn().mockReturnValue(null),
        };
        component.onProviderComponentReady(mockProviderComponent);
        component.toggleEmail(true);
        expect(component.emailEnabled()).toBe(true);
        expect(component.emailForm.get('isEnabled')?.value).toBe(true);
        expect(mockEmailSettingService.saveEmailSettings).toHaveBeenCalled();
    });

    it('coerces isEnabled to false when persisting without a valid provider config', async () => {
        component.emailForm.patchValue({ isEnabled: true });
        // No valid provider component → isProviderConfigValid() false. onSubmit(true)
        // is the toggle/persist path (bypasses the "test first" guard).
        await component.onSubmit(true);
        const saved = mockEmailSettingService.saveEmailSettings.mock.calls.at(-1)?.[0];
        expect(saved.isEnabled).toBe(false);
        expect(component.emailEnabled()).toBe(false);
    });

    it('should get selected provider info', () => {
        const provider = component.getSelectedProvider();
        expect(provider.id).toBe('smtp');
        expect(provider.name).toBe('SMTP');
    });

    it('should reset test passed when provider changes', () => {
        component.testPassed.set(true);
        component.selectProvider('resend');
        expect(component.testPassed()).toBe(false);
    });

    it('should delegate isProviderConfigValid to active provider component', () => {
        // No active component yet
        expect(component.isProviderConfigValid()).toBe(false);

        // Set a mock provider component
        const mockProviderComponent: IEmailProviderComponent = {
            formGroup: new FormGroup({ test: new FormControl('') }),
            isConfigValid: vi.fn().mockReturnValue(true),
            getSenderEmailConstraint: vi.fn().mockReturnValue(null),
        };
        component.onProviderComponentReady(mockProviderComponent);
        expect(component.isProviderConfigValid()).toBe(true);
    });

    it('should not allow save without passing test', async () => {
        component.testPassed.set(false);
        await component.onSubmit();
        expect(mockEmailSettingService.saveEmailSettings).not.toHaveBeenCalled();
    });

    it('should allow save after test passes', async () => {
        component.testPassed.set(true);
        await component.onSubmit();
        expect(mockEmailSettingService.saveEmailSettings).toHaveBeenCalled();
    });

    it('should build settings with all provider cache data on save', async () => {
        component.providerFormCache = {
            smtp: { host: 'smtp.test.com', user: 'u', password: 'p', port: 587, secure: false },
            gmail: { user: 'g@gmail.com', password: 'gp' },
            resend: { apiKey: 'rk' },
        };
        component.testPassed.set(true);
        await component.onSubmit();

        const savedSettings = mockEmailSettingService.saveEmailSettings.mock.calls[0][0];
        expect(savedSettings.smtp.host).toBe('smtp.test.com');
        expect(savedSettings.gmail.user).toBe('g@gmail.com');
        expect(savedSettings.resend.apiKey).toBe('rk');
    });

    it('should lock senderEmail when Gmail is selected', () => {
        component.selectProvider('gmail');
        expect(component.gmailSenderLocked()).toBe(true);
    });

    it('should unlock senderEmail when switching away from Gmail', () => {
        component.selectProvider('gmail');
        expect(component.gmailSenderLocked()).toBe(true);

        component.selectProvider('smtp');
        expect(component.gmailSenderLocked()).toBe(false);
    });

    it('should sync senderEmail when Gmail user changes', () => {
        component.onGmailUserChanged('myemail@gmail.com');
        expect(component.emailForm.get('senderEmail')?.value).toBe('myemail@gmail.com');
    });

    it('should cache provider form data when switching providers', () => {
        const mockProviderComponent: IEmailProviderComponent = {
            formGroup: new FormGroup({
                host: new FormControl('cached-host'),
                user: new FormControl('cached-user'),
                password: new FormControl('cached-pass'),
            }),
            isConfigValid: vi.fn().mockReturnValue(true),
            getSenderEmailConstraint: vi.fn().mockReturnValue(null),
        };
        component.onProviderComponentReady(mockProviderComponent);

        // Switch away from smtp - should cache current form data
        component.selectProvider('resend');

        expect(component.providerFormCache['smtp']).toEqual({
            host: 'cached-host',
            user: 'cached-user',
            password: 'cached-pass',
        });
    });

    it('should open test connection dialog and call service on success', async () => {
        const mockProviderComponent: IEmailProviderComponent = {
            formGroup: new FormGroup({
                host: new FormControl('smtp.example.com'),
                user: new FormControl('user@example.com'),
                password: new FormControl('secret123'),
            }),
            isConfigValid: vi.fn().mockReturnValue(true),
            getSenderEmailConstraint: vi.fn().mockReturnValue(null),
        };
        component.onProviderComponentReady(mockProviderComponent);

        await component.testConnection();

        expect(mockDialog.open).toHaveBeenCalledWith(TestConnectionDialogComponent, { width: '400px' });
        expect(mockEmailSettingService.testEmailConnection).toHaveBeenCalled();
        expect(mockEmailSettingService.monitorConnectionTest).toHaveBeenCalled();
        expect(component.testPassed()).toBe(true);
    });

    it('should not call service if dialog is cancelled', async () => {
        const mockProviderComponent: IEmailProviderComponent = {
            formGroup: new FormGroup({
                host: new FormControl('smtp.example.com'),
                user: new FormControl('user@example.com'),
                password: new FormControl('secret123'),
            }),
            isConfigValid: vi.fn().mockReturnValue(true),
            getSenderEmailConstraint: vi.fn().mockReturnValue(null),
        };
        component.onProviderComponentReady(mockProviderComponent);
        mockDialogRef.afterClosed.mockReturnValue(of(undefined));

        await component.testConnection();

        expect(mockDialog.open).toHaveBeenCalled();
        expect(mockEmailSettingService.testEmailConnection).not.toHaveBeenCalled();
    });
});
