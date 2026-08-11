import { Component, OnInit, inject, input, output } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { IEmailProviderComponent } from './email-provider-base';

/**
 * Debug Provider (Log Only) — a simulated email provider.
 *
 * It has no configuration and no credentials: selecting it lets you enable email
 * and exercise the whole pipeline, while `sendMail` records the fully-composed
 * message in Email Logs (never calling a real provider). Always config-valid.
 */
@Component({
    selector: 'app-debug-provider',
    standalone: true,
    imports: [ReactiveFormsModule, RouterModule, MatCardModule, MatIconModule],
    template: `
        <mat-card class="mb-4" [formGroup]="formGroup">
            <mat-card-header>
                <mat-card-title>
                    <i class="fa-solid fa-bug me-2"></i>
                    Debug Provider (Log Only)
                </mat-card-title>
            </mat-card-header>
            <mat-card-content class="pt-3">
                <div class="alert alert-warning d-flex align-items-start gap-2 mb-0">
                    <mat-icon>warning</mat-icon>
                    <div>
                        <strong>No emails are actually sent.</strong>
                        Every message is fully composed and recorded in
                        <a routerLink="/admin/email-logs">Email Logs</a> (status <code>success</code>,
                        <code>logOnly: true</code>, provider <code>debug_log</code>) — but nothing leaves the system.
                        <div class="small text-muted mt-1">
                            No credentials needed. Ideal for testing the pipeline end-to-end without a real
                            provider or inbox. Switch to SMTP / Gmail / Resend before going live.
                        </div>
                    </div>
                </div>
            </mat-card-content>
        </mat-card>
    `,
})
export class DebugProviderComponent implements IEmailProviderComponent, OnInit {
    private fb = inject(FormBuilder);

    initialData = input<unknown>();
    componentReady = output<IEmailProviderComponent>();

    // No fields — kept as an (empty) FormGroup to satisfy the provider contract.
    formGroup: FormGroup = this.fb.group({});

    ngOnInit(): void {
        this.componentReady.emit(this);
    }

    isConfigValid(): boolean {
        return true; // simulated provider — no config required
    }

    getSenderEmailConstraint(): string | null {
        return null;
    }
}
