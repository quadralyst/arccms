import { Component, OnInit, inject, input, output } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { IEmailProviderComponent } from './email-provider-base';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { sentenceParts } from '../../../../../core/i18n/sentence-parts';
import type { TranslationKey } from '../../../../../core/i18n/translation-keys';

/**
 * Debug Provider (Log Only): a simulated email provider.
 *
 * It has no configuration and no credentials: selecting it lets you enable email
 * and exercise the whole pipeline, while `sendMail` records the fully-composed
 * message in Email Logs (never calling a real provider). Always config-valid.
 */
@Component({
    selector: 'app-debug-provider',
    standalone: true,
    imports: [ReactiveFormsModule, RouterModule, MatCardModule, MatIconModule, TranslocoPipe],
    template: `
        <mat-card class="mb-4" [formGroup]="formGroup">
            <mat-card-header>
                <mat-card-title>
                    <i class="fa-solid fa-bug me-2" aria-hidden="true"></i>
                    {{ 'admin.settings.email.debug_provider' | transloco }}
                </mat-card-title>
            </mat-card-header>
            <mat-card-content class="pt-3">
                <div class="alert alert-warning d-flex align-items-start gap-2 mb-0">
                    <mat-icon aria-hidden="true">warning</mat-icon>
                    <div>
                        <strong>{{ 'admin.settings.email.debug_none_sent' | transloco }}</strong>
                        @let logged = parts('admin.settings.email.debug_logged');
                        {{ logged[0] }}<a routerLink="/admin/email-logs">{{ 'admin.settings.email.email_logs' | transloco }}</a>{{ logged[1] }}
                        (<code>logOnly: true</code>, <code>debug_log</code>)
                        <div class="sign-up-codes mt-1">{{ 'admin.settings.email.debug_codes' | transloco }}</div>
                        <div class="small provider-note mt-1">{{ 'admin.settings.email.debug_hint' | transloco }}</div>
                    </div>
                </div>
            </mat-card-content>
        </mat-card>
    `,
    styles: [`
        .provider-note {
            color: #5c4500; /* reads at 7:1 on the warning yellow */
        }
    `],
})
export class DebugProviderComponent implements IEmailProviderComponent, OnInit {
    private fb = inject(FormBuilder);

    initialData = input<unknown>();
    componentReady = output<IEmailProviderComponent>();

    // No fields: kept as an (empty) FormGroup to satisfy the provider contract.
    formGroup: FormGroup = this.fb.group({});

    ngOnInit(): void {
        this.componentReady.emit(this);
    }

    isConfigValid(): boolean {
        return true; // simulated provider: no config required
    }

    getSenderEmailConstraint(): string | null {
        return null;
    }

    private transloco = inject(TranslocoService);

    /** A sentence split around its value, for the template to link the value. */
    parts(key: TranslationKey, params: Record<string, unknown> = {}): [string, string] {
        return sentenceParts((k, p) => this.transloco.translate(k, p), key, params);
    }
}
