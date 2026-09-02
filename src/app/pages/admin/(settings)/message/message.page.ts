import { RouteMeta } from '@analogjs/router';
import { Component, inject, OnInit, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { roleGuard } from '../../../../guards/role.guard';

export const routeMeta: RouteMeta = {
    title: 'Global Messages | Arc CMS',
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
import { GlobalMessageService } from './global-message.service';
import { DEFAULT_GLOBAL_MESSAGE_SETTINGS, GRADIENT_PRESETS, getGradientById, IGlobalMessageSettings } from './global-message.model';

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
        MatProgressSpinnerModule, TranslocoPipe],
    templateUrl: './message.page.html',
    styleUrl: './message.page.scss',
})
export default class MessageSettingPageComponent extends BaseComponent implements OnInit {
    private fb = inject(FormBuilder);
    private globalMessageService = inject(GlobalMessageService);

    messageForm!: FormGroup;
    gradients = GRADIENT_PRESETS;

    messageEnabled = signal(false);
    isLoading = signal(true);
    isSaving = signal(false);

    ngOnInit(): void {
        this.initForm();
        this.loadSettings();
    }

    private initForm(): void {
        this.messageForm = this.fb.group({
            isEnabled: [false],
            heading: ['', [Validators.required, Validators.maxLength(100)]],
            message: ['', [Validators.required, Validators.maxLength(300)]],
            buttonLabel: ['', [Validators.maxLength(50)]],
            buttonLink: ['', [Validators.maxLength(500)]],
            gradientId: ['info-blue'],
        });
    }

    private loadSettings(): void {
        this.isLoading.set(true);
        this.globalMessageService.getSettings().subscribe({
            next: (settings) => {
                this.messageForm.patchValue(settings);
                this.messageEnabled.set(settings.isEnabled);
                this.messageForm.markAsPristine();
                this.isLoading.set(false);
            },
            error: (error) => {
                console.error('Failed to load global message settings:', error);
                this.toastService.openCustomSnackbar('Failed to load settings', 'error', 'error');
                this.isLoading.set(false);
            },
        });
    }

    getSelectedGradient() {
        const gradientId = this.messageForm.get('gradientId')?.value || 'info-blue';
        return getGradientById(gradientId);
    }

    selectGradient(gradientId: string): void {
        this.messageForm.patchValue({ gradientId });
        this.messageForm.markAsDirty();
    }

    enableMessage(): void {
        this.messageEnabled.set(true);
        this.messageForm.patchValue({ isEnabled: true });
        this.messageForm.markAsDirty();
    }

    async toggleMessage(enabled: boolean): Promise<void> {
        this.messageEnabled.set(enabled);
        this.messageForm.patchValue({ isEnabled: enabled });

        // Immediately save the toggle state to the database
        try {
            const settings: IGlobalMessageSettings = {
                ...this.messageForm.value,
                isEnabled: enabled,
            };
            await this.globalMessageService.saveSettings(settings);
            this.toastService.openCustomSnackbar(
                enabled ? 'Banner enabled' : 'Banner disabled',
                'success',
                'check_circle'
            );
            this.messageForm.markAsPristine();
        } catch (error) {
            console.error('Failed to toggle global message:', error);
            this.toastService.openCustomSnackbar('Failed to update banner status', 'error', 'error');
            // Revert the toggle on error
            this.messageEnabled.set(!enabled);
            this.messageForm.patchValue({ isEnabled: !enabled });
        }
    }

    async onSubmit(): Promise<void> {
        if (this.messageForm.invalid) {
            this.messageForm.markAllAsTouched();
            return;
        }

        this.isSaving.set(true);
        try {
            const settings: IGlobalMessageSettings = {
                ...this.messageForm.value,
                isEnabled: this.messageEnabled(),
            };
            await this.globalMessageService.saveSettings(settings);
            this.toastService.openCustomSnackbar('Global message settings saved successfully', 'success', 'check_circle');
            this.messageForm.markAsPristine();
        } catch (error) {
            console.error('Failed to save global message settings:', error);
            this.toastService.openCustomSnackbar('Failed to save settings', 'error', 'error');
        } finally {
            this.isSaving.set(false);
        }
    }
}
