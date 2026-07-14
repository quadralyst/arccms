/**
 * Joined Users Page
 * 
 * Admin page showing all users who joined a specific waitlist.
 * Shows verification status, queue position, tags, etc.
 * Includes sliding panel for user details with tags and notes management.
 */

import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal, computed, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Firestore, arrayRemove, collection, getDocs, orderBy, query, doc, getDoc, writeBatch, increment, where } from '@angular/fire/firestore';
import { MatDrawer, MatSidenavModule } from '@angular/material/sidenav';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { ViewUserDetailComponent } from './view-user-detail/view-user-detail.component';
import { IWaitlistUserTag } from './waitlist-user-tags.model';
import { WaitlistUserTagsStore } from './waitlist-user-tags.store';
import { GlobalTableComponent, TableColumn } from '../../../../../shared/components/global-table/global-table.component';
import { PageHeaderComponent } from '../../../../../shared/components/page-header/page-header.component';
import { roleGuard } from '../../../../guards/role.guard';

export const routeMeta: RouteMeta = {
    title: 'Waitlist Users | Arc CMS',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

interface WaitlistUser {
    id: string;
    email: string;
    firstName: string;
    emailVerified: boolean;
    isConfirmed: boolean;
    queuePosition: number;
    totalReferrals: number;
    referralCode: string;
    referralLink?: string;
    signupTimestamp: any;
    verifiedAt?: any;
    formData?: Record<string, any>;
    tags?: string[];
    waitlistedUserId?: string;
    referredBy?: string;
}

@Component({
    selector: 'arc-joined-users',
    templateUrl: './joined-users.page.html',
    styleUrls: ['./joined-users.page.scss'],
    standalone: true,
    imports: [
        CommonModule,
        MatSidenavModule,
        MatIconModule,
        MatButtonModule,
        MatPaginatorModule,
        ViewUserDetailComponent,
        GlobalTableComponent,
        PageHeaderComponent
    ],
})
export default class JoinedUsersComponent implements OnInit {
    @ViewChild('drawer') drawer!: MatDrawer;

    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private firestore = inject(Firestore);
    private tagsStore = inject(WaitlistUserTagsStore);

    waitlistId = signal<string>('');
    waitlistName = signal<string>('');
    loading = signal(false);
    isDeleting = signal(false);
    users = signal<WaitlistUser[]>([]);

    // Drawer state
    currentUser = signal<WaitlistUser | null>(null);

    // Tags for display
    allTags = computed(() => this.tagsStore.items());

    // Stats
    totalUsers = computed(() => this.users().length);
    verifiedUsers = computed(() => this.users().filter(u => u.isConfirmed).length);
    totalReferrals = computed(() => this.users().reduce((sum, u) => sum + u.totalReferrals, 0));

    // Pagination
    pageSize = signal(10);
    currentPage = signal(0);

    paginatedUsers = computed(() => {
        const start = this.currentPage() * this.pageSize();
        const end = start + this.pageSize();
        return this.users().slice(start, end);
    });

    // Table Config
    tableColumns: TableColumn[] = [];

    constructor() { }

    ngOnInit(): void {
        const id = this.route.snapshot.paramMap.get('waitlistId');
        if (id) {
            this.waitlistId.set(id);
            this.loadWaitlistInfo(id);
            this.loadUsers(id);
            this.loadTags(id);
            this.initColumns();
        }
    }

    initColumns() {
        this.tableColumns = [
            { key: 'index', header: '#', type: 'index' },
            {
                key: 'user',
                header: 'User',
                transformFn: (row: WaitlistUser) => `${row.firstName || '—'} (${row.email})`,
                classFn: (row) => 'fw-bold'
            },
            {
                key: 'isConfirmed',
                header: 'Status',
                type: 'badge',
                badgeConfig: {
                    trueText: 'Confirmed',
                    falseText: 'Pending',
                    trueClass: 'active',
                    falseClass: 'inactive'
                }
            },
            {
                key: 'queuePosition',
                header: 'Position',
                transformFn: (row: WaitlistUser) =>
                    (row.isConfirmed && row.queuePosition > 0) ? `#${row.queuePosition}` : '—'
            },
            {
                key: 'totalReferrals',
                header: 'Referrals',
                classFn: (row: WaitlistUser) => row.totalReferrals > 0 ? 'text-success fw-bold' : ''
            },
            {
                key: 'tags',
                header: 'Tags',
                type: 'tags',
                transformFn: (row: WaitlistUser) => this.getUserTags(row),
                tagConfig: { class: 'tag-label' }
            },
            {
                key: 'signupTimestamp',
                header: 'Signed Up',
                type: 'date',
                dateFormat: 'MMM d, y, h:mm a'
            },
            {
                key: 'actions',
                header: 'Actions',
                type: 'actions',
                actions: [
                    {
                        action: 'view',
                        icon: 'fas fa-eye text-primary',
                        label: 'View Details',
                        onAction: (row) => this.openUserDetail(row)
                    },
                    {
                        action: 'delete',
                        icon: 'fas fa-trash text-danger',
                        label: 'Delete',
                        onAction: (row) => this.deleteUser(row)
                    }
                ]
            }
        ];
    }

    async loadWaitlistInfo(waitlistId: string): Promise<void> {
        try {
            const waitlistRef = doc(this.firestore, 'Waitlists', waitlistId);
            const waitlistSnap = await getDoc(waitlistRef);
            if (waitlistSnap.exists()) {
                const data = waitlistSnap.data();
                this.waitlistName.set(data['name'] || '');
            }
        } catch (error) {
            console.error('Error loading waitlist info:', error);
        }
    }

    async loadUsers(waitlistId: string): Promise<void> {
        this.loading.set(true);
        try {
            const usersRef = collection(this.firestore, `Waitlists/${waitlistId}/users`);
            const q = query(usersRef, orderBy('signupTimestamp', 'desc'));
            const snapshot = await getDocs(q);

            const usersList: WaitlistUser[] = [];
            snapshot.forEach((doc) => {
                usersList.push({ id: doc.id, ...doc.data() } as WaitlistUser);
            });

            this.users.set(usersList);
        } catch (error) {
            console.error('Error loading users:', error);
        } finally {
            this.loading.set(false);
        }
    }

    loadTags(waitlistId: string): void {
        this.tagsStore.setWaitlistId(waitlistId);
        this.tagsStore.getAll({
            limitCount: 100,
            currentPageNumber: 0,
            previousPageNumber: -1
        });
    }

    // Get tags for a user by their tag IDs
    getUserTags(user: WaitlistUser): IWaitlistUserTag[] {
        if (!user.tags || user.tags.length === 0) return [];
        return this.allTags().filter(tag => user.tags!.includes(tag.id));
    }

    formatDate(timestamp: any): string {
        if (!timestamp) return 'N/A';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    }

    goBack(): void {
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
        if (returnUrl) {
            this.router.navigateByUrl(returnUrl);
        } else {
            this.router.navigate(['/admin/waitlists']);
        }
    }

    // Drawer methods
    openUserDetail(user: WaitlistUser): void {
        this.currentUser.set(user);
        this.drawer.open();
    }

    closeDrawer(): void {
        this.drawer.close();
        this.currentUser.set(null);
    }

    onUserUpdated(updatedUser: WaitlistUser): void {
        // Update the user in the list
        this.users.update(users =>
            users.map(u => u.id === updatedUser.id ? updatedUser : u)
        );
    }

    async deleteUser(user: WaitlistUser): Promise<void> {
        const confirmed = window.confirm(
            `Delete ${user.firstName || user.email} from this waitlist?\n\nThis will remove their record and update all counts. This cannot be undone.`
        );
        if (!confirmed) return;

        this.isDeleting.set(true);
        try {
            const waitlistId = this.waitlistId();
            const batch = writeBatch(this.firestore);

            // 1. Delete the user from Waitlists/{waitlistId}/users
            const userRef = doc(this.firestore, `Waitlists/${waitlistId}/users`, user.id);
            batch.delete(userRef);

            // 2. If user was confirmed, decrement totalSignups on the waitlist
            if (user.isConfirmed) {
                const waitlistRef = doc(this.firestore, 'Waitlists', waitlistId);
                batch.update(waitlistRef, { totalSignups: increment(-1) });
            }

            // 3. If user was referred by someone, decrement referrer's counts
            if (user.referredBy) {
                // Find the referrer by their referral code in WaitlistedUsers
                const waitlistedUsersRef = collection(this.firestore, 'WaitlistedUsers');
                const referrerQuery = query(waitlistedUsersRef, where('referralCode', '==', user.referredBy));
                const referrerSnapshot = await getDocs(referrerQuery);

                if (!referrerSnapshot.empty) {
                    const referrerDoc = referrerSnapshot.docs[0];
                    const referrerId = referrerDoc.id;

                    // Decrement referrer's totalReferrals in WaitlistedUsers
                    batch.update(referrerDoc.ref, { totalReferrals: increment(-1) });

                    // Decrement referrer's totalReferrals in Waitlists/{waitlistId}/users
                    const referrerWaitlistQuery = query(
                        collection(this.firestore, `Waitlists/${waitlistId}/users`),
                        where('waitlistedUserId', '==', referrerId)
                    );
                    const referrerWaitlistSnapshot = await getDocs(referrerWaitlistQuery);
                    if (!referrerWaitlistSnapshot.empty) {
                        batch.update(referrerWaitlistSnapshot.docs[0].ref, { totalReferrals: increment(-1) });
                    }

                    // Delete the referral doc in WaitlistedUsers/{referrerId}/referrals/
                    const referralsRef = collection(this.firestore, `WaitlistedUsers/${referrerId}/referrals`);
                    const referralQuery = query(referralsRef, where('referredUserId', '==', user.waitlistedUserId || user.id));
                    const referralSnapshot = await getDocs(referralQuery);
                    referralSnapshot.forEach(referralDoc => batch.delete(referralDoc.ref));
                }
            }

            // 4. If user exists in WaitlistedUsers, remove this waitlist from their list
            if (user.waitlistedUserId) {
                const globalUserRef = doc(this.firestore, 'WaitlistedUsers', user.waitlistedUserId);
                const globalUserSnap = await getDoc(globalUserRef);
                if (globalUserSnap.exists()) {
                    const globalData = globalUserSnap.data();
                    const waitlistIds = (globalData['waitlistIds'] as string[]) || [globalData['waitlistId']];
                    if (waitlistIds.length <= 1) {
                        // Only in this waitlist — delete the global doc
                        batch.delete(globalUserRef);
                    } else {
                        // In multiple waitlists — just remove this one from the array
                        batch.update(globalUserRef, { waitlistIds: arrayRemove(waitlistId) });
                    }
                }
            }

            await batch.commit();

            // Remove user from local signal immediately — no reload needed
            this.users.update(users => users.filter(u => u.id !== user.id));
        } catch (error) {
            console.error('Error deleting user:', error);
            alert('Failed to delete user. Please try again.');
        } finally {
            this.isDeleting.set(false);
        }
    }

    // Pagination
    onPageChange(event: PageEvent): void {
        this.currentPage.set(event.pageIndex);
        this.pageSize.set(event.pageSize);
    }

    getStartRecord(): number {
        return this.currentPage() * this.pageSize() + 1;
    }

    getEndRecord(): number {
        const end = (this.currentPage() + 1) * this.pageSize();
        return Math.min(end, this.totalUsers());
    }

    exportUsers(): void {
        const data = this.users().map(u => ({
            Name: u.firstName,
            Email: u.email,
            Status: u.emailVerified ? 'Verified' : (u.isConfirmed ? 'Confirmed' : 'Pending'),
            Position: u.queuePosition,
            Referrals: u.totalReferrals,
            Tags: this.getUserTags(u).map(t => t.label).join(', '),
            SignedUp: this.formatDate(u.signupTimestamp),
        }));

        // Convert to CSV
        const headers = Object.keys(data[0] || {});
        const csv = [
            headers.join(','),
            ...data.map(row => headers.map(h => `"${row[h as keyof typeof row] || ''}"`).join(','))
        ].join('\n');

        // Download
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `waitlist-${this.waitlistId()}-users.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
    }
}
