/**
 * User Details Component
 * 
 * Displays detailed information about a waitlist user.
 */

import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { BaseComponent } from '../../../../shared/components/base/base.component';
import { WaitlistService } from '../waitlist.service';

interface UserDetailsData {
    user?: {
        firstName?: string;
        email?: string;
        queuePosition?: number;
        referralLink?: string;
    };
    stats?: {
        totalReferrals?: number;
        successfulReferrals?: number;
        pendingReferrals?: number;
    };
}

@Component({
    selector: 'arc-user-details',
    standalone: true,
    imports: [CommonModule],
    template: `
        <div class="user-details-container">
            <div class="container">
                @if(loading) {
                <div class="loading">
                    <div class="spinner"></div>
                    <p>Loading user details...</p>
                </div>
                }
                @else if(error) {
                <div class="error">
                    <p>{{ error }}</p>
                    <button class="btn btn-primary" (click)="loadUserDetails()">Retry</button>
                </div>
                }
                @else if(userDetails) {
                <div class="user-card">
                    <div class="user-header">
                        <div class="user-avatar">{{ getInitials(userDetails.user?.firstName) }}</div>
                        <div class="user-info">
                            <h2>{{ userDetails.user?.firstName }}</h2>
                            <p>{{ userDetails.user?.email }}</p>
                        </div>
                    </div>
                    
                    <div class="stats-grid">
                        <div class="stat-card">
                            <div class="stat-number">#{{ userDetails.user?.queuePosition || 0 }}</div>
                            <div class="stat-label">Queue Position</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-number">{{ userDetails.stats?.totalReferrals || 0 }}</div>
                            <div class="stat-label">Total Referrals</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-number">{{ userDetails.stats?.successfulReferrals || 0 }}</div>
                            <div class="stat-label">Successful</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-number">{{ userDetails.stats?.pendingReferrals || 0 }}</div>
                            <div class="stat-label">Pending</div>
                        </div>
                    </div>
                    
                    <div class="referral-section">
                        <h3>Your Referral Link</h3>
                        <div class="copy-group">
                            <input readonly [value]="userDetails.user?.referralLink" class="referral-input">
                            <button class="btn btn-primary" (click)="copyToClipboard(userDetails.user?.referralLink)">
                                Copy
                            </button>
                        </div>
                    </div>
                    
                    <div class="actions">
                        <a [href]="'/leaderboard/' + waitlistId + '/' + userId" class="btn btn-primary">
                            🏆 View Leaderboard
                        </a>
                    </div>
                </div>
                }
            </div>
        </div>
    `,
    styles: [`
        .user-details-container {
            min-height: 100vh;
            background: linear-gradient(135deg, #f6f8fb 0%, #eef1f5 100%);
            padding: 40px 20px;
        }
        
        .container {
            max-width: 600px;
            margin: 0 auto;
        }
        
        .user-card {
            background: white;
            border-radius: 16px;
            padding: 30px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
        }
        
        .user-header {
            display: flex;
            align-items: center;
            gap: 20px;
            margin-bottom: 30px;
        }
        
        .user-avatar {
            width: 80px;
            height: 80px;
            border-radius: 50%;
            background: linear-gradient(135deg, #3c76f5 0%, #1d47a3 100%);
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 2rem;
            font-weight: 700;
        }
        
        .user-info h2 {
            font-size: 1.5rem;
            font-weight: 700;
            margin: 0 0 5px 0;
        }
        
        .user-info p {
            color: #64748b;
            margin: 0;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 15px;
            margin-bottom: 30px;
        }
        
        .stat-card {
            background: #f8fafc;
            border-radius: 12px;
            padding: 20px;
            text-align: center;
        }
        
        .stat-number {
            font-size: 1.8rem;
            font-weight: 700;
            color: #3b82f6;
        }
        
        .stat-label {
            font-size: 0.85rem;
            color: #64748b;
        }
        
        .referral-section {
            margin-bottom: 25px;
        }
        
        .referral-section h3 {
            font-size: 1rem;
            font-weight: 600;
            margin-bottom: 10px;
        }
        
        .copy-group {
            display: flex;
            gap: 10px;
        }
        
        .referral-input {
            flex: 1;
            padding: 12px;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            font-size: 0.9rem;
        }
        
        .btn {
            padding: 12px 20px;
            border-radius: 8px;
            font-weight: 500;
            cursor: pointer;
            border: none;
            text-decoration: none;
            display: inline-block;
        }
        
        .btn-primary {
            background: #3b82f6;
            color: white;
        }
        
        .actions {
            text-align: center;
        }
        
        .loading, .error {
            text-align: center;
            padding: 60px 0;
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
export class UserDetailsComponent extends BaseComponent implements OnInit {
    private waitlistService = inject(WaitlistService);
    private cdr = inject(ChangeDetectorRef);

    waitlistId = '';
    userId = '';
    userDetails: UserDetailsData | null = null;
    loading = true;
    error = '';

    ngOnInit(): void {
        this.activatedRoute.paramMap.subscribe(async (params) => {
            this.waitlistId = params.get('waitlistId') || '';
            this.userId = params.get('userId') || '';

            if (this.waitlistId && this.userId) {
                await this.loadUserDetails();
            } else {
                this.error = 'Invalid user details URL';
                this.loading = false;
            }
        });
    }

    async loadUserDetails(): Promise<void> {
        this.loading = true;
        this.error = '';

        try {
            this.userDetails = await this.waitlistService.getUserDetails(this.waitlistId, this.userId) as UserDetailsData;
            if (!this.userDetails) {
                this.error = 'User not found';
            }
        } catch (error) {
            console.error('Error loading user details:', error);
            this.error = 'Failed to load user details';
        } finally {
            this.loading = false;
            this.cdr.detectChanges();
        }
    }

    getInitials(name?: string): string {
        if (!name) return 'U';
        return name.charAt(0).toUpperCase();
    }

    async copyToClipboard(text?: string): Promise<void> {
        if (text) {
            const success = await this.globalService.copyToClipboard(text);
            if (success) {
                this.toastService.success('Copied to clipboard!');
            }
        }
    }
}
