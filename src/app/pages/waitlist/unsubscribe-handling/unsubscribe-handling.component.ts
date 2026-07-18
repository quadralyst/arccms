/**
 * Unsubscribe Handling Component
 * 
 * Handles email unsubscription for waitlist users.
 */

import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, ChangeDetectorRef, Injector, runInInjectionContext } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { BaseComponent } from '../../../../shared/components/base/base.component';
import { doc, updateDoc } from '@angular/fire/firestore';
import { Firestore } from '@angular/fire/firestore';
import { GaTrackingService } from '../../../../shared/services/ga-tracking.service';

@Component({
    selector: 'arc-unsubscribe-handling',
    standalone: true,
    imports: [CommonModule],
    template: `
        <div class="unsubscribe-container">
            <div class="container">
                <div class="unsubscribe-card">
                    @if(loading) {
                    <div class="loading">
                        <div class="spinner"></div>
                        <p>Processing your request...</p>
                    </div>
                    }
                    @else if(success) {
                    <div class="success">
                        <div class="icon">✓</div>
                        <h2>Successfully Unsubscribed</h2>
                        <p>You have been removed from our mailing list.</p>
                        <p class="note">If you change your mind, you can always sign up again.</p>
                        <a href="/" class="btn btn-primary">Return Home</a>
                    </div>
                    }
                    @else if(error) {
                    <div class="error">
                        <div class="icon">⚠</div>
                        <h2>Something went wrong</h2>
                        <p>{{ error }}</p>
                        <button class="btn btn-primary" (click)="processUnsubscribe()">Try Again</button>
                    </div>
                    }
                    @else if(!userId) {
                    <div class="invalid">
                        <div class="icon">❌</div>
                        <h2>Invalid Unsubscribe Link</h2>
                        <p>This unsubscribe link appears to be invalid or expired.</p>
                        <a href="/" class="btn btn-primary">Return Home</a>
                    </div>
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
            padding: 50px 40px;
            text-align: center;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
        }
        
        .icon {
            font-size: 4rem;
            margin-bottom: 20px;
        }
        
        .success .icon {
            color: #10b981;
        }
        
        .error .icon {
            color: #f59e0b;
        }
        
        .invalid .icon {
            color: #ef4444;
        }
        
        h2 {
            font-size: 1.5rem;
            font-weight: 700;
            margin-bottom: 15px;
            color: #1a202c;
        }
        
        p {
            color: #64748b;
            margin-bottom: 10px;
        }
        
        .note {
            font-size: 0.9rem;
            color: #94a3b8;
            margin-bottom: 25px;
        }
        
        .btn {
            padding: 12px 25px;
            border-radius: 8px;
            font-weight: 500;
            cursor: pointer;
            border: none;
            text-decoration: none;
            display: inline-block;
            transition: transform 0.2s;
        }
        
        .btn:hover {
            transform: translateY(-2px);
        }
        
        .btn-primary {
            background: #3b82f6;
            color: white;
        }
        
        .loading {
            padding: 20px 0;
        }
        
        .spinner {
            width: 50px;
            height: 50px;
            border-radius: 50%;
            border: 4px solid #e2e8f0;
            border-top-color: #3b82f6;
            animation: spin 1s linear infinite;
            margin: 0 auto 15px;
        }
        
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
    `],
})
export class UnsubscribeHandlingComponent extends BaseComponent implements OnInit {
    private route = inject(ActivatedRoute);
    private firestore = inject(Firestore);
    private cdr = inject(ChangeDetectorRef);
    private gaTracking = inject(GaTrackingService);
    private injector = inject(Injector);

    userId = '';
    waitlistId = '';
    loading = true;
    success = false;
    error = '';

    ngOnInit(): void {
        this.activatedRoute.paramMap.subscribe(async (params) => {
            this.userId = params.get('userId') || '';
            this.waitlistId = params.get('waitlistId') || '';

            // Track unsubscribe page view
            this.gaTracking.trackUnsubscribeView(this.waitlistId, this.userId);

            if (this.userId) {
                await this.processUnsubscribe();
            } else {
                this.loading = false;
            }
        });
    }

    async processUnsubscribe(): Promise<void> {
        this.loading = true;
        this.error = '';
        this.success = false;

        try {
            // Update WaitlistedUsers collection
            const waitlistedUserRef = runInInjectionContext(this.injector, () => doc(this.firestore, 'WaitlistedUsers', this.userId));
            await runInInjectionContext(this.injector, () => updateDoc(waitlistedUserRef, { isSubscribed: false }));

            // Update waitlist subcollection if waitlistId is provided
            if (this.waitlistId) {
                const userRef = runInInjectionContext(this.injector, () => doc(this.firestore, `Waitlists/${this.waitlistId}/users`, this.userId));
                await runInInjectionContext(this.injector, () => updateDoc(userRef, { isSubscribed: false }));
            }

            this.success = true;
        } catch (error) {
            console.error('Error processing unsubscribe:', error);
            this.error = 'We were unable to process your unsubscribe request. Please try again.';
        } finally {
            this.loading = false;
            this.cdr.detectChanges();
        }
    }
}
