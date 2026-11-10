/**
 * Unsubscribe page for the older links `/unsubscribe/:userId` and
 * `/unsubscribe/:waitlistId/:userId`.
 *
 * No email has carried those links since 2026-07-26, but older emails still do.
 * Their id proves nothing (anyone who learned one could unsubscribe someone else),
 * so the page asks for the address and the server emails it the signed one-click
 * unsubscribe link, the one every email footer carries. The server answers the same
 * whether or not the address is on the list, so this page does too.
 */

import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Functions } from '@angular/fire/functions';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { GaTrackingService } from '../../../../shared/services/ga-tracking.service';
import { arcCallable } from '../../../core/config/arc-functions';

type Step = 'ask' | 'sending' | 'sent';

@Component({
    selector: 'arc-unsubscribe-handling',
    standalone: true,
    imports: [TranslocoPipe],
    template: `
        <div class="unsubscribe-container">
            <div class="container">
                <div class="unsubscribe-card">
                    @if (step() === 'sent') {
                    <div class="success">
                        <div class="icon" aria-hidden="true">✓</div>
                        <h2>{{ 'member.unsubscribe.sent_title' | transloco }}</h2>
                        <p>{{ 'member.unsubscribe.sent_text' | transloco }}</p>
                        <a href="/" class="btn btn-primary">{{ 'member.unsubscribe.home' | transloco }}</a>
                    </div>
                    } @else {
                    <form class="ask" (submit)="send($event, email.value)">
                        <h2>{{ 'member.unsubscribe.title' | transloco }}</h2>
                        <p>{{ 'member.unsubscribe.intro' | transloco }}</p>
                        <label for="unsubscribe-email">{{ 'member.unsubscribe.email_label' | transloco }}</label>
                        <input #email id="unsubscribe-email" type="email" name="email" required autocomplete="email"
                            [disabled]="step() === 'sending'" />
                        @if (error()) {
                        <p class="error" role="alert">{{ error() }}</p>
                        }
                        <button type="submit" class="btn btn-primary" [disabled]="step() === 'sending'">
                            {{ (step() === 'sending' ? 'member.unsubscribe.sending' : 'member.unsubscribe.send') | transloco }}
                        </button>
                    </form>
                    }
                </div>
            </div>
        </div>
    `,
    styles: [`
        .unsubscribe-container {
            min-height: 100vh;
            background: linear-gradient(135deg, #f6f8fb 0%, #eef1f5 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }

        .container {
            max-width: 500px;
            width: 100%;
        }

        .unsubscribe-card {
            background: white;
            border-radius: 16px;
            padding: 40px 32px;
            text-align: center;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
        }

        .icon {
            font-size: 4rem;
            margin-bottom: 20px;
            color: #10b981;
        }

        h2 {
            font-size: 1.5rem;
            font-weight: 700;
            margin-bottom: 15px;
            color: #1a202c;
        }

        p {
            color: #4b5563;
            margin-bottom: 16px;
        }

        .ask {
            text-align: left;
        }

        .ask h2 {
            text-align: center;
        }

        label {
            display: block;
            font-weight: 600;
            color: #1a202c;
            margin-bottom: 6px;
        }

        input {
            width: 100%;
            box-sizing: border-box;
            padding: 12px;
            font-size: 1rem;
            border: 1px solid #94a3b8;
            border-radius: 8px;
            margin-bottom: 16px;
        }

        .error {
            color: #b91c1c;
        }

        .btn {
            padding: 12px 25px;
            border-radius: 8px;
            font-weight: 500;
            cursor: pointer;
            border: none;
            text-decoration: none;
            display: inline-block;
        }

        .ask .btn {
            width: 100%;
        }

        .btn:disabled {
            opacity: 0.7;
            cursor: default;
        }

        .btn-primary {
            background: #2563eb;
            color: white;
        }
    `],
})
export class UnsubscribeHandlingComponent implements OnInit {
    private route = inject(ActivatedRoute);
    private functions = inject(Functions);
    private gaTracking = inject(GaTrackingService);
    private transloco = inject(TranslocoService);

    /** The old link's ids: they help the server recognise the address, and do nothing alone. */
    userId = '';
    waitlistId = '';
    step = signal<Step>('ask');
    error = signal('');

    ngOnInit(): void {
        this.route.paramMap.subscribe((params) => {
            this.userId = params.get('userId') || '';
            this.waitlistId = params.get('waitlistId') || '';
            // The form only: an id from the link is not sent to analytics.
            this.gaTracking.trackUnsubscribeView(this.waitlistId);
        });
    }

    async send(event: Event, email: string): Promise<void> {
        event.preventDefault();
        const address = email.trim();
        if (!address.includes('@')) {
            this.error.set(this.transloco.translate('member.unsubscribe.invalid_email'));
            return;
        }
        this.step.set('sending');
        this.error.set('');
        try {
            const call = arcCallable<{ email: string; userId?: string; waitlistId?: string }, { ok: boolean }>(
                this.functions, 'unsubscribeLegacyLink',
            );
            await call({ email: address, userId: this.userId || undefined, waitlistId: this.waitlistId || undefined });
            this.step.set('sent');
        } catch (error) {
            console.error('Error asking for an unsubscribe link:', error);
            // A limit reached, or anything else: in the page's language, never the server's English.
            const failure = error as { code?: string };
            const key = failure?.code === 'functions/resource-exhausted' ? 'member.unsubscribe.too_many' : 'member.unsubscribe.failed';
            this.error.set(this.transloco.translate(key));
            this.step.set('ask');
        }
    }
}
