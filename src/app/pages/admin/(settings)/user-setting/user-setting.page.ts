import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { FormBuilder, FormControl, FormGroup, FormsModule, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { roleGuard } from '../../../../guards/role.guard';
import { BaseComponent } from '../../../../../shared/components/base/base.component';
import { PageHeaderComponent } from '../../../../../shared/components/page-header/page-header.component';
import { UserSettingService } from './user-setting.service';
import { AVAILABLE_ROLES, IUserSettings } from './user-setting.model';
import { MatButtonModule } from '@angular/material/button';

export const routeMeta: RouteMeta = {
    title: 'User Settings | Arc CMS',
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
        PageHeaderComponent, TranslocoPipe],
    templateUrl: './user-setting.page.html',
    styleUrl: './user-setting.page.scss',
})
export default class UserSettingPageComponent extends BaseComponent implements OnInit {
    private userSettingService = inject(UserSettingService);
    private fb = inject(FormBuilder);

    userSettingsForm!: FormGroup;
    isLoading = signal(true);
    isSaving = signal(false);
    availableRoles = AVAILABLE_ROLES;
    isUserSettingEnabled = signal(false);
    userSettings: IUserSettings | null = null;

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
