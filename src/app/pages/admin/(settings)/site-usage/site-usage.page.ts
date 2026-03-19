import { RouteMeta } from '@analogjs/router';
import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { roleGuard } from '../../../../guards/role.guard';

export const routeMeta: RouteMeta = {
    title: 'Site Usage | Arc CMS',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { BaseComponent } from '../../../../../shared/components/base/base.component';
import { SiteUsageService } from './site-usage.service';
import { DEFAULT_SITE_USAGE_SETTINGS, GRADIENT_PRESETS, getGradientById, ISiteUsageSettings } from './site-usage.model';

@Component({
    standalone: true,
    imports: [
        CommonModule,
        ReactiveFormsModule,
        MatCardModule,
        MatIconModule,
        MatSlideToggleModule,
        MatButtonModule,
        MatFormFieldModule,
        MatInputModule,
        MatProgressSpinnerModule,
    ],
    templateUrl: './site-usage.page.html',
    styleUrl: './site-usage.page.scss',
})
export default class SiteUsagePageComponent extends BaseComponent implements OnInit {
    private fb = inject(FormBuilder);
    private siteUsageService = inject(SiteUsageService);

    consentForm!: FormGroup;
    gradients = GRADIENT_PRESETS;

    consentEnabled = signal(false);
    isLoading = signal(true);
    isSaving = signal(false);

    ngOnInit(): void {
        this.initForm();
        this.loadSettings();
    }

    private initForm(): void {
        this.consentForm = this.fb.group({
            isEnabled: [false],
            bannerText: ['', [Validators.required, Validators.maxLength(500)]],
            acceptButtonText: ['', [Validators.required, Validators.maxLength(30)]],
            rejectButtonText: ['', [Validators.required, Validators.maxLength(30)]],
            privacyPolicyLink: ['', [Validators.maxLength(500)]],
            gradientId: ['info-blue'],
        });
    }

    private loadSettings(): void {
        this.isLoading.set(true);
        this.siteUsageService.getSettings().subscribe({
            next: (settings) => {
                this.consentForm.patchValue(settings);
                this.consentEnabled.set(settings.isEnabled);
                this.consentForm.markAsPristine();
                this.isLoading.set(false);
            },
            error: (error) => {
                console.error('Failed to load site usage settings:', error);
                this.toastService.openCustomSnackbar('Failed to load settings', 'error', 'error');
                this.isLoading.set(false);
            },
        });
    }

    getSelectedGradient() {
        const gradientId = this.consentForm.get('gradientId')?.value || 'info-blue';
        return getGradientById(gradientId);
    }

    selectGradient(gradientId: string): void {
        this.consentForm.patchValue({ gradientId });
        this.consentForm.markAsDirty();
    }

    enableConsent(): void {
        this.consentEnabled.set(true);
        this.consentForm.patchValue({ isEnabled: true });
        this.consentForm.markAsDirty();
    }

    async toggleConsent(enabled: boolean): Promise<void> {
        this.consentEnabled.set(enabled);
        this.consentForm.patchValue({ isEnabled: enabled });

        // Immediately save the toggle state to the database
        try {
            const settings: ISiteUsageSettings = {
                ...this.consentForm.value,
                isEnabled: enabled,
            };
            await this.siteUsageService.saveSettings(settings);
            this.toastService.openCustomSnackbar(
                enabled ? 'Site usage banner enabled' : 'Site usage banner disabled',
                'success',
                'check_circle'
            );
            this.consentForm.markAsPristine();
        } catch (error) {
            console.error('Failed to toggle site usage:', error);
            this.toastService.openCustomSnackbar('Failed to update banner status', 'error', 'error');
            // Revert the toggle on error
            this.consentEnabled.set(!enabled);
            this.consentForm.patchValue({ isEnabled: !enabled });
        }
    }

    async onSubmit(): Promise<void> {
        if (this.consentForm.invalid) {
            this.consentForm.markAllAsTouched();
            return;
        }

        this.isSaving.set(true);
        try {
            const settings: ISiteUsageSettings = {
                ...this.consentForm.value,
                isEnabled: this.consentEnabled(),
            };
            await this.siteUsageService.saveSettings(settings);
            this.toastService.openCustomSnackbar('Site usage settings saved successfully', 'success', 'check_circle');
            this.consentForm.markAsPristine();
        } catch (error) {
            console.error('Failed to save site usage settings:', error);
            this.toastService.openCustomSnackbar('Failed to save settings', 'error', 'error');
        } finally {
            this.isSaving.set(false);
        }
    }
}
