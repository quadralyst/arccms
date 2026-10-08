import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { FormBuilder, FormControl, FormGroup, FormsModule, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleChange, MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { roleGuard } from '../../../../guards/role.guard';
import { BaseComponent } from '../../../../../shared/components/base/base.component';
import { PageHeaderComponent } from '../../../../../shared/components/page-header/page-header.component';
import { UserSettingService } from './user-setting.service';
import { AVAILABLE_ROLES, IUserSettings } from './user-setting.model';
import { PhoneSignInCheck, PhoneSignInCheckService } from './phone-sign-in-check.service';
import { isOn } from '../../../../core/features/features';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';

export const routeMeta: RouteMeta = {
    title: 'User Settings',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

@Component({
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        MatCardModule,
        MatIconModule,
        MatSlideToggleModule,
        MatSelectModule,
        MatFormFieldModule,
        MatProgressSpinnerModule,
        MatButtonModule,
        PageHeaderComponent, TranslocoPipe, RouterLink],
    templateUrl: './user-setting.page.html',
    styleUrl: './user-setting.page.scss',
})
export default class UserSettingPageComponent extends BaseComponent implements OnInit {
    private userSettingService = inject(UserSettingService);
    private phoneCheckService = inject(PhoneSignInCheckService);
    private fb = inject(FormBuilder);

    userSettingsForm!: FormGroup;
    isLoading = signal(true);
    isSaving = signal(false);
    availableRoles = AVAILABLE_ROLES;
    readonly smsOn = isOn('sms');
    isUserSettingEnabled = signal(false);
    userSettings: IUserSettings | null = null;
    /** The last phone sign-in check (null before one ran): the Google Cloud setup and the SMS provider. */
    phoneCheck = signal<PhoneSignInCheck | null>(null);
    checkingPhone = signal(false);

    ngOnInit(): void {
        this.initForm();
        this.loadSettings();
    }

    private initForm(): void {
        this.userSettingsForm = this.fb.group({
            isSignupEnabled: [false],
            defaultRole: ['', [Validators.required]],
        });
    }

    private loadSettings(): void {
        this.isLoading.set(true);
        this.userSettingService.getSettings().subscribe({
            next: (settings) => {
                this.userSettings = settings;
                this.isUserSettingEnabled.set(settings.isSignupEnabled);
                this.userSettingsForm.patchValue(settings);
                this.isLoading.set(false);
                // Already on: say now if people cannot finish signing in, not after they try.
                if (this.smsOn && settings.phoneSignIn) void this.runPhoneCheck();
            },
            error: (error) => {
                console.error('Failed to load user settings:', error);
                this.toastService.openCustomSnackbar('Failed to load settings', 'error', 'error');
                this.isLoading.set(false);
            },
        });
    }

    async toggleSignup(enabled: boolean): Promise<void> {
        this.isSaving.set(true);
        try {
            const updatedSettings = { ...this.userSettingsForm.value, isSignupEnabled: enabled };
            await this.userSettingService.saveSettings(updatedSettings);
            this.toastService.openCustomSnackbar(
                enabled ? 'User signups enabled' : 'User signups disabled',
                'success',
                'check_circle'
            );
        } catch (error) {
            console.error('Failed to update signup setting:', error);
            this.toastService.openCustomSnackbar('Failed to save settings', 'error', 'error');
        } finally {
            this.isSaving.set(false);
        }
    }

    async changeDefaultRole(role: string): Promise<void> {
        this.isSaving.set(true);
        try {
            const updatedSettings = { ...this.userSettingsForm.value, defaultRole: role };
            await this.userSettingService.saveSettings(updatedSettings);
            this.toastService.openCustomSnackbar(
                `Default role set to ${this.getRoleLabel(role)}`,
                'success',
                'check_circle'
            );
        } catch (error) {
            console.error('Failed to update default role:', error);
            this.toastService.openCustomSnackbar('Failed to save settings', 'error', 'error');
        } finally {
            this.isSaving.set(false);
        }
    }

    /** Phone or Google sign-in on or off; saved on its own, like the other switches. */
    async toggleMethod(key: 'phoneSignIn' | 'googleSignIn', enabled: boolean): Promise<void> {
        this.isSaving.set(true);
        try {
            await this.userSettingService.saveSettings({ ...this.userSettingsForm.value, [key]: enabled });
            this.userSettings = { ...(this.userSettings ?? this.userSettingsForm.value), [key]: enabled };
            this.toastService.openCustomSnackbar(this.t('admin.settings.user.sign_in_saved'), 'success', 'check_circle');
        } catch (error) {
            console.error('Failed to update sign-in methods:', error);
            this.toastService.openCustomSnackbar('Failed to save settings', 'error', 'error');
        } finally {
            this.isSaving.set(false);
        }
    }

    /**
     * Phone sign-in on or off. Turning it on checks first that the server can sign people in
     * (the Token Creator role on the functions' service account): without it every phone
     * sign-in fails at the last step, so the switch stays off and the page shows the fix.
     * When the check itself cannot run, phone sign-in is turned on anyway, with a warning.
     */
    async togglePhoneSignIn(event: MatSlideToggleChange): Promise<void> {
        if (!event.checked) {
            this.phoneCheck.set(null);
            await this.toggleMethod('phoneSignIn', false);
            return;
        }
        const check = await this.runPhoneCheck();
        if (check && !check.ready) {
            event.source.checked = false;
            this.toastService.openCustomSnackbar(this.t('admin.settings.user.phone_setup_first'), 'error', 'error');
            return;
        }
        if (!check) this.toastService.openCustomSnackbar(this.t('admin.settings.user.phone_check_failed'), 'warning', 'warning');
        await this.toggleMethod('phoneSignIn', true);
    }

    /** Run the check; null when it could not run. */
    async runPhoneCheck(): Promise<PhoneSignInCheck | null> {
        this.checkingPhone.set(true);
        try {
            const check = await this.phoneCheckService.check();
            this.phoneCheck.set(check);
            return check;
        } catch (error) {
            console.error('Phone sign-in check failed:', error);
            return null;
        } finally {
            this.checkingPhone.set(false);
        }
    }

    /** "Check again" after fixing the setup in Google Cloud. */
    async recheckPhone(): Promise<void> {
        const check = await this.runPhoneCheck();
        if (check?.ready) this.toastService.openCustomSnackbar(this.t('admin.settings.user.phone_setup_ready'), 'success', 'check_circle');
    }

    async copyPhoneFix(command: string): Promise<void> {
        try {
            await navigator.clipboard.writeText(command);
            this.toastService.openCustomSnackbar(this.t('admin.settings.user.phone_setup_copied'), 'success', 'check_circle');
        } catch {
            // No clipboard (an insecure origin): the command is on screen to copy by hand.
        }
    }

    getRoleLabel(roleId: string | undefined | null): string {
        if (!roleId) return '';
        const role = this.availableRoles.find(r => r.id === roleId);
        return role?.label || roleId;
    }

    enableUserSetting(): void {
        this.isUserSettingEnabled.set(true);
        this.userSettingsForm.patchValue({ isSignupEnabled: true });
        this.userSettingsForm.markAsDirty();
    }
}
