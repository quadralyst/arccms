import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal, computed, HostListener } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Firestore, collection, getDocs, orderBy, query } from '@angular/fire/firestore';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { GlobalTableComponent, TableColumn } from '../../../../../shared/components/global-table/global-table.component';
import { WaitlistAdminStore } from '../waitlist.store';

interface Subscriber {
    id: string;
    email: string;
    firstName: string;
    emailVerified: boolean;
    isConfirmed: boolean;
    totalReferrals: number;
    signupTimestamp: any;
    waitlistIds: string[];
    waitlistNames?: string;
}

@Component({
    selector: 'arc-subscribers',
    templateUrl: './subscribers.page.html',
    styleUrls: ['./subscribers.page.scss'],
    standalone: true,
    imports: [
        CommonModule,
        RouterLink,
        MatPaginatorModule,
        GlobalTableComponent,
    ],
})
export default class SubscribersComponent implements OnInit {
    private router = inject(Router);
    private firestore = inject(Firestore);
    private waitlistAdminStore = inject(WaitlistAdminStore);

    loading = signal(false);
    rawSubscribers = signal<Subscriber[]>([]);

    // Build waitlist name lookup from store
    private waitlistNameMap = computed(() => {
        const map: Record<string, string> = {};
        this.waitlistAdminStore.items().forEach((w: any) => {
            map[w.id] = w.name;
        });
        return map;
    });

    // Resolve waitlist IDs to names
    subscribers = computed(() => {
        const raw = this.rawSubscribers();
        const nameMap = this.waitlistNameMap();

        return raw.map(sub => ({
            ...sub,
            waitlistNames: (sub.waitlistIds || [])
                .map(id => nameMap[id] || id)
                .join(', '),
        }));
    });

    // Pagination
    pageSize = signal(10);
    currentPage = signal(0);

    paginatedSubscribers = computed(() => {
        const start = this.currentPage() * this.pageSize();
        const end = start + this.pageSize();
        return this.subscribers().slice(start, end);
    });

    totalSubscribers = computed(() => this.subscribers().length);

    // Table Config
    tableColumns: TableColumn[] = [];

    ngOnInit(): void {
        this.waitlistAdminStore.subscribe();
        this.initColumns();
        this.loadSubscribers();
    }

    private initColumns(): void {
        this.tableColumns = [
            { key: 'index', header: '#', type: 'index' },
            {
                key: 'user',
                header: 'User',
                transformFn: (row: Subscriber) => `${row.firstName || '—'} (${row.email})`,
                classFn: () => 'fw-bold',
            },
            {
                key: 'waitlistNames',
                header: 'Waitlists',
                type: 'html',
                transformFn: (row: Subscriber) => {
                    const nameMap = this.waitlistNameMap();
                    return (row.waitlistIds || [])
                        .map(id => {
                            const name = nameMap[id] || id;
                            return `<a href="/admin/waitlists/dashboard/${id}" class="waitlist-link">${name}</a>`;
                        })
                        .join(', ');
                },
            },
            {
                key: 'isConfirmed',
                header: 'Status',
                type: 'badge',
                badgeConfig: {
                    trueText: 'Confirmed',
                    falseText: 'Pending',
                    trueClass: 'active',
                    falseClass: 'inactive',
                },
            },
            {
                key: 'totalReferrals',
                header: 'Referrals',
                classFn: (row: Subscriber) => (row.totalReferrals > 0 ? 'text-success fw-bold' : ''),
            },
            {
                key: 'signupTimestamp',
                header: 'Signed Up',
                type: 'date',
                dateFormat: 'MMM d, y, h:mm a',
            },
        ];
    }

    private async loadSubscribers(): Promise<void> {
        this.loading.set(true);
        try {
            const usersRef = collection(this.firestore, 'WaitlistedUsers');
            const q = query(usersRef, orderBy('signupTimestamp', 'desc'));
            const snapshot = await getDocs(q);
            const list: Subscriber[] = [];
            snapshot.forEach((d) => {
                const data = d.data();
                list.push({
                    id: d.id,
                    email: data['email'] || '',
                    firstName: data['firstName'] || '',
                    emailVerified: data['emailVerified'] || false,
                    isConfirmed: data['isConfirmed'] || false,
                    totalReferrals: data['totalReferrals'] || 0,
                    signupTimestamp: data['signupTimestamp'],
                    // Support both old (waitlistId) and new (waitlistIds) field formats
                    waitlistIds: data['waitlistIds'] || (data['waitlistId'] ? [data['waitlistId']] : []),
                });
            });
            this.rawSubscribers.set(list);
        } catch (error) {
            console.error('Error loading subscribers:', error);
        } finally {
            this.loading.set(false);
        }
    }

    exportSubscribers(): void {
        const data = this.subscribers().map(u => ({
            Name: u.firstName || '',
            Email: u.email,
            Waitlists: u.waitlistNames || '',
            Status: u.emailVerified ? 'Verified' : (u.isConfirmed ? 'Confirmed' : 'Pending'),
            Referrals: u.totalReferrals || 0,
            SignedUp: this.toDate(u.signupTimestamp)?.toISOString() || '',
        }));

        if (data.length === 0) return;

        const headers = Object.keys(data[0]);
        const csv = [
            headers.join(','),
            ...data.map(row => headers.map(h => `"${row[h as keyof typeof row] || ''}"`).join(','))
        ].join('\n');

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `subscribers-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
    }

    private toDate(date: any): Date | null {
        if (!date) return null;
        if (date?.toDate && typeof date.toDate === 'function') return date.toDate();
        if (date?.seconds) return new Date(date.seconds * 1000);
        if (date instanceof Date) return date;
        return new Date(date);
    }

    onPageChange(event: PageEvent): void {
        this.currentPage.set(event.pageIndex);
        this.pageSize.set(event.pageSize);
    }

    getStartRecord(): number {
        return this.currentPage() * this.pageSize() + 1;
    }

    getEndRecord(): number {
        return Math.min((this.currentPage() + 1) * this.pageSize(), this.totalSubscribers());
    }

    @HostListener('click', ['$event'])
    onHostClick(event: MouseEvent): void {
        const target = event.target as HTMLElement;
        if (target.classList.contains('waitlist-link')) {
            event.preventDefault();
            event.stopPropagation();
            const href = target.getAttribute('href');
            if (href) {
                this.router.navigateByUrl(href);
            }
        }
    }

    goBack(): void {
        this.router.navigate(['/admin/waitlists']);
    }
}
