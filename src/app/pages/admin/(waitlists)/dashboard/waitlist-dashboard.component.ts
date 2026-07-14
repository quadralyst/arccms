import { CommonModule } from '@angular/common';
import { Component, OnInit, Injector, inject, runInInjectionContext, signal, computed } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Firestore, collection, getDocs, orderBy, query, doc, getDoc, getCountFromServer, updateDoc } from '@angular/fire/firestore';
import { WaitlistEditDrawerComponent, WaitlistEditInput, WaitlistFormData } from '../edit-drawer/waitlist-edit-drawer.component';
import { PageHeaderComponent } from '../../../../../shared/components/page-header/page-header.component';

interface WaitlistUser {
    id: string;
    email: string;
    firstName: string;
    emailVerified: boolean;
    isConfirmed: boolean;
    queuePosition: number;
    totalReferrals: number;
    signupTimestamp: any;
    source?: string;
    signupMetadata?: {
        utmSource?: string;
        deviceType?: string;
        timeOnPageMs?: number;
        visitCount?: number;
        isReturnVisitor?: boolean;
    };
}

interface WaitlistInfo {
    id: string;
    name: string;
    slug: string;
    description?: string;
    coverImage?: string;
    isActive: boolean;
    disabledMessage?: string;
    totalSignups: number;
    defaultTagId?: string;
}

@Component({
    selector: 'arc-waitlist-dashboard',
    templateUrl: './waitlist-dashboard.component.html',
    styleUrls: ['./waitlist-dashboard.component.scss'],
    standalone: true,
    imports: [CommonModule, RouterLink, WaitlistEditDrawerComponent, PageHeaderComponent],
})
export default class WaitlistDashboardComponent implements OnInit {
    private route = inject(ActivatedRoute);
    private firestore = inject(Firestore);
    private injector = inject(Injector);

    waitlistId = signal('');
    waitlist = signal<WaitlistInfo | null>(null);
    users = signal<WaitlistUser[]>([]);
    loading = signal(true);

    // Settings drawer
    isDrawerOpen = signal(false);

    // Key Metrics
    totalCount = signal(0);
    verifiedCount = computed(() => this.users().filter(u => u.isConfirmed).length);
    pendingCount = computed(() => this.totalCount() - this.verifiedCount());
    totalReferrals = computed(() => this.users().reduce((sum, u) => sum + (u.totalReferrals || 0), 0));

    // Growth Insights
    signupsThisWeek = computed(() => {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        return this.users().filter(u => {
            const date = this.toDate(u.signupTimestamp);
            return date && date >= sevenDaysAgo;
        }).length;
    });

    verificationRate = computed(() => {
        const total = this.totalCount();
        if (total === 0) return 0;
        return Math.round((this.verifiedCount() / total) * 100);
    });

    referralRate = computed(() => {
        const total = this.totalCount();
        if (total === 0) return 0;
        const usersWithReferrals = this.users().filter(u => (u.totalReferrals || 0) > 0).length;
        return Math.round((usersWithReferrals / total) * 100);
    });

    avgReferrals = computed(() => {
        const total = this.totalCount();
        if (total === 0) return 0;
        return (this.totalReferrals() / total).toFixed(1);
    });

    // Source Breakdown
    sourceBreakdown = computed(() => {
        const sources: Record<string, number> = {};
        this.users().forEach(u => {
            const source = u.signupMetadata?.utmSource || u.source || 'Direct / Unknown';
            sources[source] = (sources[source] || 0) + 1;
        });
        const total = this.users().length || 1;
        return Object.entries(sources)
            .map(([name, count]) => ({ name, count, percent: Math.round((count / total) * 100) }))
            .sort((a, b) => b.count - a.count);
    });

    // Device Breakdown
    deviceBreakdown = computed(() => {
        const devices: Record<string, number> = {};
        this.users().forEach(u => {
            const device = u.signupMetadata?.deviceType || 'Unknown';
            const label = device.charAt(0).toUpperCase() + device.slice(1);
            devices[label] = (devices[label] || 0) + 1;
        });
        const total = this.users().length || 1;
        return Object.entries(devices)
            .map(([name, count]) => ({ name, count, percent: Math.round((count / total) * 100) }))
            .sort((a, b) => b.count - a.count);
    });

    // Avg Return Visits (average visitCount across users with data)
    avgReturnVisits = computed(() => {
        const usersWithData = this.users().filter(u => u.signupMetadata?.visitCount != null);
        if (usersWithData.length === 0) return '—';
        const total = usersWithData.reduce((sum, u) => sum + (u.signupMetadata!.visitCount || 0), 0);
        return (total / usersWithData.length).toFixed(1);
    });

    // Avg Time on Page (average timeOnPageMs, formatted as Xm Ys)
    avgTimeOnPage = computed(() => {
        const usersWithData = this.users().filter(u => u.signupMetadata?.timeOnPageMs != null);
        if (usersWithData.length === 0) return '—';
        const totalMs = usersWithData.reduce((sum, u) => sum + (u.signupMetadata!.timeOnPageMs || 0), 0);
        const avgMs = totalMs / usersWithData.length;
        const totalSecs = Math.round(avgMs / 1000);
        const mins = Math.floor(totalSecs / 60);
        const secs = totalSecs % 60;
        if (mins === 0) return `${secs}s`;
        return `${mins}m ${secs}s`;
    });

    // Top Referrers
    topReferrers = computed(() =>
        [...this.users()]
            .filter(u => (u.totalReferrals || 0) > 0)
            .sort((a, b) => (b.totalReferrals || 0) - (a.totalReferrals || 0))
            .slice(0, 5)
    );

    // Recent Signups
    recentSignups = computed(() => this.users().slice(0, 10));

    ngOnInit(): void {
        this.route.paramMap.subscribe(params => {
            const id = params.get('waitlistId');
            if (id && id !== this.waitlistId()) {
                this.waitlistId.set(id);
                this.loadWaitlistInfo(id);
                this.loadUsers(id);
            }
        });
    }

    private async loadWaitlistInfo(waitlistId: string): Promise<void> {
        try {
            const waitlistRef = runInInjectionContext(this.injector, () => doc(this.firestore, 'Waitlists', waitlistId));
            const snap = await runInInjectionContext(this.injector, () => getDoc(waitlistRef));
            if (snap.exists()) {
                const data = snap.data();
                this.waitlist.set({
                    id: snap.id,
                    name: data['name'] || '',
                    slug: data['slug'] || '',
                    description: data['description'] || '',
                    coverImage: data['coverImage'] || '',
                    isActive: data['isActive'] ?? true,
                    disabledMessage: data['disabledMessage'] || '',
                    totalSignups: data['totalSignups'] || 0,
                    defaultTagId: data['defaultTagId'] || '',
                });
            }
        } catch (error) {
            console.error('Error loading waitlist info:', error);
        }
    }

    private async loadUsers(waitlistId: string): Promise<void> {
        this.loading.set(true);
        try {
            const usersRef = runInInjectionContext(this.injector, () => collection(this.firestore, `Waitlists/${waitlistId}/users`));
            const countSnap = await runInInjectionContext(this.injector, () => getCountFromServer(usersRef));
            this.totalCount.set(countSnap.data().count);

            const q = runInInjectionContext(this.injector, () => query(usersRef, orderBy('signupTimestamp', 'desc')));
            const snapshot = await runInInjectionContext(this.injector, () => getDocs(q));
            const usersList: WaitlistUser[] = [];
            snapshot.forEach((d) => {
                usersList.push({ id: d.id, ...d.data() } as WaitlistUser);
            });
            this.users.set(usersList);
        } catch (error) {
            console.error('Error loading users:', error);
        } finally {
            this.loading.set(false);
        }
    }

    // Settings drawer
    openSettings(): void {
        this.isDrawerOpen.set(true);
    }

    closeDrawer(): void {
        this.isDrawerOpen.set(false);
    }

    async onDrawerSaved(formData: WaitlistFormData): Promise<void> {
        try {
            const docRef = doc(this.firestore, 'Waitlists', this.waitlistId());
            await updateDoc(docRef, { ...formData, updatedAt: new Date() });
            // Refresh local state
            this.waitlist.update(w => w ? { ...w, ...formData } : w);
            this.closeDrawer();
        } catch (error) {
            console.error('Error saving waitlist:', error);
        }
    }

    getTimeAgo(date: any): string {
        const dateObj = this.toDate(date);
        if (!dateObj || isNaN(dateObj.getTime())) return '';

        const now = new Date();
        const diffMs = now.getTime() - dateObj.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return dateObj.toLocaleDateString();
    }

    private toDate(date: any): Date | null {
        if (!date) return null;
        if (date?.toDate && typeof date.toDate === 'function') return date.toDate();
        if (date?.seconds) return new Date(date.seconds * 1000);
        if (date instanceof Date) return date;
        return new Date(date);
    }

    exportUsers(): void {
        const data = this.users().map(u => ({
            Name: u.firstName,
            Email: u.email,
            Status: u.emailVerified ? 'Verified' : (u.isConfirmed ? 'Confirmed' : 'Pending'),
            Referrals: u.totalReferrals || 0,
            SignedUp: this.toDate(u.signupTimestamp)?.toISOString() || '',
        }));

        const headers = Object.keys(data[0] || {});
        const csv = [
            headers.join(','),
            ...data.map(row => headers.map(h => `"${row[h as keyof typeof row] || ''}"`).join(','))
        ].join('\n');

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `waitlist-${this.waitlistId()}-users.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
    }

}
