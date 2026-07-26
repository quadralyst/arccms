/**
 * Leaderboard Component
 * 
 * Displays the waitlist leaderboard showing top referrers.
 * Shows personal stats when user is logged in via URL parameter.
 */

import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { BaseComponent } from '../../../../shared/components/base/base.component';
import { WaitlistService } from '../waitlist.service';
import { ILeaderboardEntry, IWaitlist, IWaitlistUser } from '../waitlist.model';
import { HeaderComponent } from "../../page.parts/header.component";
import { FooterComponent } from "../../page.parts/footer.component";
import { GaTrackingService } from '../../../../shared/services/ga-tracking.service';

@Component({
    selector: 'arc-leaderboard',
    templateUrl: './leaderboard.component.html',
    styleUrls: ['./leaderboard.component.scss'],
    standalone: true,
    imports: [CommonModule, HeaderComponent, FooterComponent],
})
export class LeaderboardComponent extends BaseComponent implements OnInit {
    private waitlistService = inject(WaitlistService);
    private cdr = inject(ChangeDetectorRef);
    private route = inject(ActivatedRoute);
    private gaTracking = inject(GaTrackingService);

    private readonly DEFAULT_COVER_IMAGE = '/assets/images/luke-chesser.jpg';

    displayLeaderboard: ILeaderboardEntry[] = [];
    waitlistedUserId = '';
    waitlistId = '';
    waitlistData: IWaitlist | null = null;
    personalUserData: IWaitlistUser | null = null;
    allReferralsData: any = null;
    loading = true;
    error = '';
    showPersonalStats = false;
    totalUsers = 0;
    unverifiedUsers = 0;
    currentUserPosition = 0;

    get coverImageUrl(): string {
        return this.waitlistData?.coverImage || this.DEFAULT_COVER_IMAGE;
    }

    ngOnInit(): void {
        this.route.paramMap.subscribe(async (params) => {
            this.waitlistId = params.get('waitlistId') || '';
            this.waitlistedUserId = params.get('waitlisteduserid') || '';
            this.showPersonalStats = !!this.waitlistedUserId;

            // Personal record + referrals, in one call. Loaded first because the
            // leaderboard uses it to locate this member's own position.
            if (this.waitlistedUserId) {
                await this.loadPersonalUserData();
            }

            // Load waitlist data and leaderboard
            if (this.waitlistId) {
                await this.loadWaitlistData();
                await this.loadLeaderboard();
            } else if (!this.waitlistedUserId && !this.waitlistId) {
                const waitlist = await this.waitlistService.getWaitlists();
                if (waitlist) {
                    this.router.navigate([`/leaderboard/${waitlist.id}`], { replaceUrl: true });
                }
            }

            // Track leaderboard view
            this.gaTracking.trackLeaderboardView(this.waitlistId, this.waitlistedUserId);
        });
    }

    async loadWaitlistData(): Promise<void> {
        try {
            // Check if waitlistId is a slug (contains letters/hyphens) or document ID
            if (this.waitlistId && /[a-zA-Z-]/.test(this.waitlistId)) {
                // Try slug first
                this.waitlistData = await this.waitlistService.getWaitlistBySlug(this.waitlistId);
            }

            // If not found by slug or if it looks like a document ID, try by ID
            if (!this.waitlistData) {
                this.waitlistData = await this.waitlistService.getWaitlist(this.waitlistId);
            }

            this.cdr.detectChanges();
        } catch (error) {
            console.error('Error loading waitlist data:', error);
        }
    }

    async loadLeaderboard(): Promise<void> {
        this.loading = true;
        this.error = '';

        try {
            // Pass the actual waitlist document ID for filtering
            const waitlistDocId = this.waitlistData?.id || '';

            if (waitlistDocId) {
                // Use direct Firestore query for specific waitlist
                // This bypasses the cloud function which might be filtering incorrectly
                const response = await this.waitlistService.getLeaderboard(waitlistDocId);

                if (response?.leaderboard?.length > 0) {
                    this.displayLeaderboard = response.leaderboard.map((user: any) => ({
                        id: user.id || '',
                        firstName: user.firstName || 'Anonymous',
                        maskedEmail: user.maskedEmail || '',
                        email: '', // Not needed for display
                        totalReferrals: user.totalReferrals || 0,
                        queuePosition: user.queuePosition || 0,
                        waitlistedUserId: user.waitlistedUserId || '',
                    }));
                    this.totalUsers = response.totalUsers;
                    this.unverifiedUsers = response.unverifiedUsers || 0;

                    // For specific waitlist, rely on the personal user data's queue position
                    if (this.personalUserData) {
                        this.currentUserPosition = this.personalUserData.queuePosition;
                    }
                } else {
                    this.displayLeaderboard = [];
                }
            } else {
                // Point the callable at this form's members. It was passed an empty
                // string, which is falsy, so it fell back to its default of reading
                // `WaitlistedUsers` — and that copy of `totalReferrals` went stale when
                // U6 moved referral crediting onto the member doc alone, so the rank
                // came from counts that stopped updating.
                const response = await this.waitlistService.fetchLeaderboard(
                    this.personalUserData?.email || '',
                    this.waitlistId ? `Waitlists/${this.waitlistId}/users` : '',
                );

                if (response?.displayLeaderboard?.length > 0) {
                    this.displayLeaderboard = response.displayLeaderboard;
                    this.totalUsers = response.totalUsers;
                    this.currentUserPosition = response.currentUserPosition;

                    if (this.personalUserData) {
                        this.personalUserData.queuePosition = response.currentUserPosition;
                    }
                } else {
                    this.displayLeaderboard = [];
                }
            }
        } catch (error) {
            console.error('Error fetching leaderboard:', error);
            this.error = 'Failed to load leaderboard';
        } finally {
            this.loading = false;
            this.cdr.detectChanges();
        }
    }

    /**
     * The member's record and their referral history, in one round trip.
     *
     * These were two separate reads against `WaitlistedUsers` — the record, then the
     * referrals subcollection. #51 moved both server-side, and the callable returns
     * them together, so fetching twice would just be two calls for one payload.
     */
    async loadPersonalUserData(): Promise<void> {
        try {
            const view = await this.waitlistService.getMemberView(this.waitlistId, this.waitlistedUserId);
            this.personalUserData = (view?.member as any) ?? null;
            this.allReferralsData = view?.referrals ?? [];
            this.cdr.detectChanges();
        } catch (error) {
            console.error('Error loading personal user data:', error);
        }
    }

    getRankIcon(index: number): string {
        switch (index) {
            case 0:
                return '🥇';
            case 1:
                return '🥈';
            case 2:
                return '🥉';
            default:
                return `#${index + 1}`;
        }
    }

    getInitials(name: string): string {
        if (!name) return 'U';
        return name.charAt(0).toUpperCase();
    }

    getRankForUser(user: any): number {
        if (!this.displayLeaderboard || user?.isSeparator) return 0;

        const fullLeaderboard = this.displayLeaderboard;
        const actualIndex = fullLeaderboard.findIndex((u: any) => u.email === user.email);
        return actualIndex + 1;
    }

    isCurrentUser(user: ILeaderboardEntry): boolean {
        return this.showPersonalStats && !!this.personalUserData && this.waitlistedUserId === user.waitlistedUserId;
    }

    copyToClipboard(text: string): void {
        if (text) {
            navigator.clipboard
                .writeText(text)
                .then(() => {
                    this.toastService.success('Copied to clipboard');
                })
                .catch((err) => {
                    console.error('Failed to copy to clipboard:', err);
                });
        }
    }

    toggleMyReferrals(): void {
        const content = document.getElementById('my-referrals-content');
        const chevron = document.getElementById('referrals-chevron');

        if (content && chevron) {
            if (content.style.display === 'none' || content.style.display === '') {
                content.style.display = 'block';
                chevron.classList.remove('fa-chevron-down');
                chevron.classList.add('fa-chevron-up');
            } else {
                content.style.display = 'none';
                chevron.classList.remove('fa-chevron-up');
                chevron.classList.add('fa-chevron-down');
            }
        }
    }

    getWhatsAppShareUrl(): string {
        const referralCode = this.personalUserData?.referralCode || '';
        const referralLink = this.personalUserData?.referralLink || '';
        const text = `Join the waitlist with my referral code ${referralCode} - ${referralLink}`;
        return `https://wa.me/?text=${encodeURIComponent(text)}`;
    }

    getFacebookShareUrl(): string {
        const referralLink = this.personalUserData?.referralLink || '';
        return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(referralLink)}`;
    }

    getTwitterShareUrl(): string {
        const referralCode = this.personalUserData?.referralCode || '';
        const referralLink = this.personalUserData?.referralLink || '';
        const text = `Join the waitlist with my referral code ${referralCode}`;
        return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(referralLink)}`;
    }

    getLinkedInShareUrl(): string {
        const referralLink = this.personalUserData?.referralLink || '';
        return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(referralLink)}`;
    }

    maskEmail(email: string): string {
        if (!email) return '';
        const [username, domain] = email.split('@');
        if (!username || !domain) return email;

        const maskedUsername = username.length > 3 ? username.substring(0, 3) + '***' : username.charAt(0) + '***';

        const [domainName, extension] = domain.split('.');
        const maskedDomain =
            domainName.length > 3
                ? '***' + domainName.substring(domainName.length - 2)
                : '***' + domainName.charAt(domainName.length - 1);

        return `${maskedUsername}@${maskedDomain}.${extension}`;
    }

    get bannerBackground() {
        const style = this.coverImageUrl
            ? `url(${this.coverImageUrl})`
            : `linear-gradient(to right, #283048, #859398)`;
        return this.sanitizer.bypassSecurityTrustStyle(style);
    }
}
