import { Component, DestroyRef, inject, input, OnInit, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { IGmailConfig } from '../email-setting.model';
import { IEmailProviderComponent } from './email-provider-base';

@Component({
    selector: 'app-gmail-provider',
    standalone: true,
    imports: [
        ReactiveFormsModule,
        MatCardModule,
        MatFormFieldModule,
        MatInputModule,
        MatButtonModule,
        MatIconModule,
        MatTooltipModule,
    ],
    template: `
        <mat-card class="mb-4" [formGroup]="formGroup">
            <mat-card-header>
                <mat-card-title>
                    <i class="fa-solid fa-envelope me-2"></i>
                    Gmail Configuration
                </mat-card-title>
            </mat-card-header>
            <mat-card-content class="pt-3">
                <div class="alert alert-light border small mb-3" style="padding: 0; overflow: hidden;">
                    <div style="display: flex; align-items: center; padding: 0.5rem 0.75rem; cursor: pointer; user-select: none;"
                         (click)="showInfoBox.set(!showInfoBox())">
                        <i class="fa-solid fa-circle-info text-primary me-1"></i>
                        <strong>How to get a Gmail App Password:</strong>
                        <mat-icon style="margin-left: auto; font-size: 20px; width: 20px; height: 20px;">
                            {{ showInfoBox() ? 'expand_less' : 'expand_more' }}
                        </mat-icon>
                    </div>
                    @if (showInfoBox()) {
                    <div style="padding: 0 0.75rem 0.5rem;">
                        <ol class="mb-0 mt-1">
                            <li>
                                Go to your
                                <a href="https://myaccount.google.com/security" target="_blank" rel="noopener">Google Account Security</a> page
                            </li>
                            <li>
                                Make sure <strong>2-Step Verification</strong> is turned on
                                (<a href="https://myaccount.google.com/signinoptions/two-step-verification" target="_blank" rel="noopener">enable it here</a> if not)
                            </li>
                            <li>
                                Then visit
                                <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener"><strong>App Passwords</strong></a>,
                                name it "Arc CMS", and click <strong>Create</strong>
                            </li>
                            <li>Copy the 16-character password and paste it below</li>
                        </ol>
                        <span class="text-muted">
                            <i class="fa-solid fa-circle-check text-success me-1"></i>
                            Gmail lets you send up to 500 emails per day for free.
                        </span>
                    </div>
                    }
                </div>

                @if (formGroup.get('user')?.value) {
                <div class="alert alert-warning border small mb-3">
                    <i class="fa-solid fa-triangle-exclamation me-1"></i>
                    <strong>Note:</strong> Gmail requires the "Sender Email" to match your Gmail address.
                    It will be set automatically to <code>{{ formGroup.get('user')?.value }}</code>.
                </div>
                }

                <div class="row mt-3">
                    <div class="col-md-6">
                        <mat-form-field appearance="outline" class="w-100">
                            <mat-label>Gmail Address</mat-label>
                            <input matInput formControlName="user" placeholder="you@gmail.com">
                            <mat-hint>The Gmail address you want to send from</mat-hint>
                        </mat-form-field>
                    </div>
                    <div class="col-md-6">
                        <mat-form-field appearance="outline" class="w-100">
                            <mat-label>App Password</mat-label>
                            <input matInput [type]="showPassword() ? 'text' : 'password'" formControlName="password"
                                placeholder="xxxx xxxx xxxx xxxx">
                            <button mat-icon-button matSuffix type="button" (click)="showPassword.set(!showPassword())"
                                [matTooltip]="showPassword() ? 'Hide password' : 'Show password'">
                                <mat-icon>{{ showPassword() ? 'visibility_off' : 'visibility' }}</mat-icon>
                            </button>
                            <mat-hint>
                                16-character password from
                                <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">Google App Passwords</a>
                            </mat-hint>
                        </mat-form-field>
                    </div>
                </div>
            </mat-card-content>
        </mat-card>
    `,
})
export class GmailProviderComponent implements IEmailProviderComponent, OnInit {
    private fb = inject(FormBuilder);
    private destroyRef = inject(DestroyRef);

    initialData = input<Partial<IGmailConfig>>();
    componentReady = output<IEmailProviderComponent>();
    userChanged = output<string>();

    showPassword = signal(false);
    showInfoBox = signal(true);

    formGroup: FormGroup = this.fb.group({
        user: ['', [Validators.email]],
        password: [''],
    });

    ngOnInit(): void {
        const data = this.initialData();
        if (data) {
            this.formGroup.patchValue(data);
        }
        this.showInfoBox.set(!this.isConfigValid());
        this.componentReady.emit(this);

        // Emit initial value if present
        const initialUser = this.formGroup.get('user')?.value;
        if (initialUser) {
            this.userChanged.emit(initialUser);
        }

        // Emit on every user field change so parent can sync senderEmail
        this.formGroup.get('user')!.valueChanges
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(value => {
                this.userChanged.emit(value || '');
            });
    }

    isConfigValid(): boolean {
        return !!this.formGroup.get('user')?.value
            && !!this.formGroup.get('password')?.value;
    }

    getSenderEmailConstraint(): string | null {
        return this.formGroup.get('user')?.value || null;
    }
}
