import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, Injector, runInInjectionContext, signal } from '@angular/core';
import { Firestore, collection, query, where, getCountFromServer } from '@angular/fire/firestore';
import { Router, RouterLink } from '@angular/router';
import { environment } from '../../../../environments/environment';
import { BaseComponent } from '../../../../shared/components/base/base.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { AnalyticsConnectionStatusService } from '../../../../shared/services/analytics-connection-status.service';
import { EmailConfigStatusService } from '../../../../shared/services/email-config-status.service';
import { GoogleOAuthService } from '../../../../shared/services/google-oauth.service';
import { AnalyticsStore } from './analytics.store';
import { ContentTypesStore } from '../contents/content-types/content-types.store';
import { DraftContentsService } from '../contents/draft-content-store/draft-contents.service';
import { MediaManagerService } from '../(media)/media-manager.service';
import { WaitlistAdminStore } from '../(waitlists)/waitlist.store';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AudienceService } from '../(audience)/audience.service';
import { UserService } from '../users/user.service';
import { roleGuard } from '../../../guards/role.guard';

export const routeMeta: RouteMeta = {
  title: 'Dashboard | Arc CMS',
  canActivate: [roleGuard],
  data: { allowedRoles: ['admin'] },
};

@Component({
  selector: 'arc-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, PageHeaderComponent],
  templateUrl: './dashboard.html',
  styleUrls: ['./dashboard.scss'],
})
export default class DashboardComponent extends BaseComponent {
  // Auto-refresh throttle: skip if last sync was less than 5 minutes ago
  private static readonly REFRESH_THROTTLE_MS = 5 * 60 * 1000;

  // Analytics
  analyticsStore = inject(AnalyticsStore);
  analyticsData = computed(() => this.analyticsStore.items());

  // Google Analytics OAuth
  analyticsConnectionStatus = inject(AnalyticsConnectionStatusService);
  private googleOAuthService = inject(GoogleOAuthService);
  isRefreshing = signal(false);
 
  // True only when the cached analytics data belongs to the currently configured GA property.
  // Prevents showing stale data from a previously connected property while a refresh is in flight.
  isAnalyticsDataCurrent = computed(() => {
    if (this.analyticsConnectionStatus.isLoading()) return false;

    const data = this.analyticsStore.items();
    if (!data?.length || !data[0]?.metrics?.length) return false;

    const configuredPropertyId = this.analyticsConnectionStatus.propertyId();
    if (!configuredPropertyId) return false;

    const cachedPropertyId = (data[0] as any).propertyId;
    // Data without a stored propertyId cannot be verified — show skeleton instead of stale data
    if (!cachedPropertyId) return false;

    return cachedPropertyId === configuredPropertyId;
  });

  // Content & Media - using services for efficient count queries
  contentTypesStore = inject(ContentTypesStore);
  contentsService = inject(DraftContentsService);
  mediaService = inject(MediaManagerService);

  // Growth & Leads - using services for efficient count queries
  waitlistAdminStore = inject(WaitlistAdminStore);
  userService = inject(UserService);
  private audienceService = inject(AudienceService);
  private destroyRef = inject(DestroyRef);
  private appRouter = inject(Router);
  private firestore = inject(Firestore);
  private injector = inject(Injector);

  // Email configuration status
  emailConfigService = inject(EmailConfigStatusService);

  // Content types list (need actual items for names/icons)
  contentTypes = computed(() => this.contentTypesStore.items());

  // Content type names as comma-separated string (for template display)
  contentTypeNames = computed(() => {
    const types = this.contentTypesStore.items();
    return types?.map(ct => ct.name).join(', ') || '';
  });

  // Media count (using efficient server-side count)
  mediaCount = signal(0);

  // Content counts per type (will be populated after loading)
  contentCounts = signal<Record<string, { total: number; published: number; draft: number }>>({});

  // Growth & Leads counts
  totalWaitlistCount = signal(0);
  last7DaysWaitlistCount = signal(0);
  totalUsersCount = signal(0);
  verifiedUsersCount = signal(0);

  // Recent data for tables
  recentWaitlistSignups = signal<any[]>([]);
  recentActivity = signal<any[]>([]);

  // Waitlists list for Growth & Leads cards
  waitlists = computed(() => this.waitlistAdminStore.items());

  // Per-waitlist user counts (queried from subcollections)
  waitlistCounts = signal<Record<string, { total: number; thisWeek: number }>>({});
  private waitlistCountsLoaded = false;

  // Track if content counts have been loaded
  private countsLoaded = false;
  // Track if auto-refresh has already been triggered this visit
  private autoRefreshTriggered = false;

  constructor() {
    super();

    // Use effect to reactively load counts and recent activity when content types become available
    effect(() => {
      const types = this.contentTypesStore.items();
      if (types?.length && !this.countsLoaded) {
        this.countsLoaded = true;
        this.fetchContentCountsForTypes(types);
        this.loadRecentActivity();
      }
    });

    // Reactively load per-waitlist user counts when waitlists become available
    effect(() => {
      const wls = this.waitlistAdminStore.items();
      if (wls?.length && !this.waitlistCountsLoaded) {
        this.waitlistCountsLoaded = true;
        this.loadPerWaitlistCounts(wls);
      }
    });

    // Reactively auto-refresh analytics when connection status becomes available
    effect(() => {
      const connected = this.analyticsConnectionStatus.isConnected();
      const loading = this.analyticsConnectionStatus.isLoading();
      if (loading || this.autoRefreshTriggered) return;
      this.autoRefreshTriggered = true;

      if (connected) {
        const lastSync = this.analyticsConnectionStatus.lastSyncDate();
        const lastSyncMs = lastSync?.seconds ? lastSync.seconds * 1000 : 0;
        const elapsed = Date.now() - lastSyncMs;
        if (elapsed >= DashboardComponent.REFRESH_THROTTLE_MS) {
          this.refreshAnalytics();
        }
      }
    });
  }

  ngOnInit(): void {
    this.subscribeToData(this.analyticsStore);
    this.subscribeToData(this.contentTypesStore);
    this.waitlistAdminStore.subscribe();
    this.loadMediaCount();
    this.loadGrowthAndLeadsCounts();
    this.loadRecentWaitlistSignups();
    // Auto-refresh is handled reactively by the effect in the constructor
  }

  // Navigation helpers for clickable cards
  navigateToContentType(slug: string): void {
    this.appRouter.navigate(['/admin/contents', slug]);
  }

  navigateToMedia(): void {
    this.appRouter.navigate(['/admin/media']);
  }

  navigateToWaitlistDashboard(waitlistId: string): void {
    this.appRouter.navigate(['/admin/waitlists/dashboard', waitlistId]);
  }

  navigateToWaitlists(): void {
    this.appRouter.navigate(['/admin/waitlists']);
  }

  /**
   * Load actual user counts per waitlist from subcollections
   */
  private async loadPerWaitlistCounts(waitlists: any[]): Promise<void> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const counts: Record<string, { total: number; thisWeek: number }> = {};

    for (const wl of waitlists) {
      const usersRef = runInInjectionContext(this.injector, () => collection(this.firestore, `Waitlists/${wl.id}/users`));

      try {
        // Total users in this waitlist
        const totalSnap = await runInInjectionContext(this.injector, () => getCountFromServer(usersRef));
        const total = totalSnap.data().count;

        // Users signed up in last 7 days
        const weekQuery = runInInjectionContext(this.injector, () => query(usersRef, where('signupTimestamp', '>=', sevenDaysAgo)));
        const weekSnap = await runInInjectionContext(this.injector, () => getCountFromServer(weekQuery));
        const thisWeek = weekSnap.data().count;

        counts[wl.id] = { total, thisWeek };
        this.waitlistCounts.set({ ...counts });
      } catch (err) {
        console.error(`Error loading counts for waitlist ${wl.id}:`, err);
        counts[wl.id] = { total: 0, thisWeek: 0 };
        this.waitlistCounts.set({ ...counts });
      }
    }
  }

  getWaitlistCount(waitlistId: string): { total: number; thisWeek: number } {
    return this.waitlistCounts()[waitlistId] || { total: 0, thisWeek: 0 };
  }

  private fetchContentCountsForTypes(types: any[]): void {
    const counts: Record<string, { total: number; published: number; draft: number }> = {};

    types.forEach((contentType) => {
      const slug = contentType.slug;

      // Get total count — query the per-type collection (arc_{slug}_drafts) via collectionSuffix
      this.contentsService.getCollectionTotalCount({
        limitCount: 0,
        currentPageNumber: 0,
        previousPageNumber: 0
      }, slug).subscribe((total) => {
        if (!counts[slug]) {
          counts[slug] = { total: 0, published: 0, draft: 0 };
        }
        counts[slug].total = total;
        counts[slug].draft = Math.max(0, total - counts[slug].published);
        this.contentCounts.set({ ...counts });
      });

      // Get published count — filter by status only (no type filter needed, collection is per-type)
      this.contentsService.getCollectionTotalCount({
        whereConditions: [
          { field: 'status', operator: '==', value: 'publish' }
        ],
        limitCount: 0,
        currentPageNumber: 0,
        previousPageNumber: 0
      }, slug).subscribe((published) => {
        if (!counts[slug]) {
          counts[slug] = { total: 0, published: 0, draft: 0 };
        }
        counts[slug].published = published;
        counts[slug].draft = Math.max(0, counts[slug].total - published);
        this.contentCounts.set({ ...counts });
      });
    });
  }

  getContentCount(slug: string): { total: number; published: number; draft: number } {
    return this.contentCounts()[slug] || { total: 0, published: 0, draft: 0 };
  }

  /**
   * Load media count using efficient server-side count
   */
  private loadMediaCount(): void {
    this.mediaService.getCollectionTotalCount({
      limitCount: 0,
      currentPageNumber: 0,
      previousPageNumber: 0
    }).subscribe((count) => {
      this.mediaCount.set(count);
    });
  }

  /**
   * Load Growth & Leads counts using efficient server-side queries
   */
  private loadGrowthAndLeadsCounts(): void {
    // U4: these read the unified `Contacts` audience rather than `WaitlistedUsers`,
    // which U6 retires. Contacts exist from the moment of signup (U2), so the
    // totals now include people mid-funnel who have not verified yet — which is
    // what "signups" always meant here.
    void this.audienceService.countContacts().then((c) => this.totalWaitlistCount.set(c));

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    void this.audienceService.countContactsSince(sevenDaysAgo).then((c) => this.last7DaysWaitlistCount.set(c));

    // "Verified" is now "mailable": U2 promotes a contact to `subscribed` exactly
    // when they confirm their address.
    void this.audienceService.countContactsByConsent('subscribed').then((c) => this.verifiedUsersCount.set(c));

    // Total admin users
    this.userService.getCollectionTotalCount({
      limitCount: 0,
      currentPageNumber: 0,
      previousPageNumber: 0
    }).subscribe((count) => {
      this.totalUsersCount.set(count);
    });
  }

  /**
   * Maps metric titles to their icon and color classes
   */
  private metricStyleMap: Record<string, { color: string; icon: string }> = {
    'Users': { color: 'green', icon: 'fas fa-user' },
    'New Users': { color: 'teal', icon: 'fas fa-user-plus' },
    'Sessions': { color: 'blue', icon: 'fas fa-users' },
    'Bounce Rate': { color: 'red', icon: 'fas fa-percentage' },
    'Avg. Duration': { color: 'navy', icon: 'fas fa-clock' },
    'Pages/Session': { color: 'navy', icon: 'fas fa-layer-group' },
    'Pageviews': { color: 'orange', icon: 'fas fa-eye' },
    'Event Count': { color: 'blue', icon: 'fas fa-bolt' },
    'Engaged Sessions': { color: 'green', icon: 'fas fa-heart' },
  };

  // Color palette for content type cards
  private contentTypeColors = ['blue', 'navy', 'orange', 'teal', 'red', 'green'];

  getMetricColor(title: string): string {
    return this.metricStyleMap[title]?.color || 'blue';
  }

  getContentTypeColor(index: number): string {
    return this.contentTypeColors[index % this.contentTypeColors.length];
  }

  /**
   * Load recent waitlist signups (last 7, ordered by signupTimestamp desc)
   */
  private loadRecentWaitlistSignups(): void {
    // Contacts, newest first (U4) — same list, sourced from the audience layer.
    this.audienceService.getRecentContacts(7)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((contacts) => this.recentWaitlistSignups.set(contacts as any[]));
  }

  /**
   * Load recent activity (last 5 content items, ordered by modifiedAt desc)
   */
  private loadRecentActivity(): void {
    const types = this.contentTypesStore.items();
    if (!types.length) return;

    const allItems: any[] = [];
    let completed = 0;

    const finalizeIfDone = () => {
      if (completed === types.length) {
        allItems.sort((a, b) => {
          const dateA = a.modifiedAt?.toDate?.() ? a.modifiedAt.toDate() : new Date(a.modifiedAt || 0);
          const dateB = b.modifiedAt?.toDate?.() ? b.modifiedAt.toDate() : new Date(b.modifiedAt || 0);
          return dateB.getTime() - dateA.getTime();
        });
        this.recentActivity.set(allItems.slice(0, 5));
      }
    };

    types.forEach((contentType) => {
      this.contentsService.getAll({
        orderByField: 'modifiedAt',
        orderByDirection: 'desc',
        limitCount: 5,
        currentPageNumber: 0,
        previousPageNumber: 0
      }, contentType.slug).subscribe({
        next: (result) => {
          // Tag each item with its content type info
          const tagged = (result.collectionData || []).map((item: any) => ({
            ...item,
            _contentTypeName: contentType.singularName || contentType.name,
            _contentTypeSlug: contentType.slug,
            _contentTypeIcon: contentType.icon || 'bi bi-file-text',
          }));
          allItems.push(...tagged);
          completed++;
          finalizeIfDone();
        },
        error: () => {
          completed++;
          finalizeIfDone();
        }
      });
    });
  }

  /**
   * Get source badge class based on source type
   */
  getSourceBadgeClass(source: string | undefined): string {
    if (!source) return 'bg-secondary';
    const sourceLower = source.toLowerCase();
    if (sourceLower.includes('referral')) return 'bg-success';
    if (sourceLower.includes('product hunt')) return 'bg-primary';
    if (sourceLower.includes('google')) return 'bg-info';
    if (sourceLower.includes('twitter') || sourceLower.includes('x')) return 'bg-warning text-dark';
    return 'bg-secondary';
  }

  /**
   * Get time ago string from date
   */
  getTimeAgo(date: any): string {
    if (!date) return '';

    // Handle different Firestore timestamp formats
    let dateObj: Date;
    if (date?.toDate && typeof date.toDate === 'function') {
      dateObj = date.toDate();
    } else if (date?.seconds) {
      dateObj = new Date(date.seconds * 1000);
    } else if (date instanceof Date) {
      dateObj = date;
    } else {
      dateObj = new Date(date);
    }

    // Check for invalid date
    if (isNaN(dateObj.getTime())) {
      return '';
    }

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

  /**
   * Get status badge class
   */
  getStatusBadgeClass(status: string): string {
    return status === 'publish' ? 'bg-success' : 'bg-warning text-dark';
  }

  /**
   * Standard fields to exclude when finding the first custom formData field
   */
  private standardFormFields = ['email', 'firstName', 'lastName', 'name'];

  /**
   * Get the first non-standard field name from the first signup's formData
   */
  getFormFieldColumnName(): string {
    const signups = this.recentWaitlistSignups();
    if (!signups?.length) return 'Details';

    for (const signup of signups) {
      if (signup.formData) {
        const customField = Object.keys(signup.formData).find(
          key => !this.standardFormFields.includes(key) && signup.formData[key]
        );
        if (customField) {
          // Capitalize first letter
          return customField.charAt(0).toUpperCase() + customField.slice(1);
        }
      }
    }
    return 'Details';
  }

  /**
   * Get the first non-standard field value from a signup's formData
   */
  getFirstFormFieldValue(signup: any): string {
    if (!signup?.formData) return '';

    const customField = Object.keys(signup.formData).find(
      key => !this.standardFormFields.includes(key) && signup.formData[key]
    );
    return customField ? signup.formData[customField] : '';
  }

  /**
   * Format a date as "Mon d, yyyy" for the date-range badge, handling Firestore timestamps.
   */
  formatShortDate(date: any): string {
    if (!date) return '';
    let d: Date;
    if (date?.toDate && typeof date.toDate === 'function') {
      d = date.toDate();
    } else if (date?.seconds) {
      d = new Date(date.seconds * 1000);
    } else if (date instanceof Date) {
      d = date;
    } else {
      d = new Date(date);
    }
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  /**
   * Format date for display, handling Firestore timestamps
   */
  override formatDate(date: any): string {
    if (!date) return '';

    // Handle different Firestore timestamp formats
    let dateObj: Date;
    if (date?.toDate && typeof date.toDate === 'function') {
      // Firestore Timestamp with toDate() method
      dateObj = date.toDate();
    } else if (date?.seconds) {
      // Firestore Timestamp serialized as {seconds, nanoseconds}
      dateObj = new Date(date.seconds * 1000);
    } else if (date instanceof Date) {
      dateObj = date;
    } else {
      dateObj = new Date(date);
    }

    // Check for invalid date
    if (isNaN(dateObj.getTime())) {
      return '';
    }

    return dateObj.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }

  // ── Google Analytics OAuth ──

  getGa4Url(): string {
    const projectId = environment.firebaseConfig.projectId;
    return `https://console.firebase.google.com/u/0/project/${projectId}/analytics/`;
  }

  async refreshAnalytics(): Promise<void> {
    if (!this.analyticsConnectionStatus.isConnected() || this.isRefreshing()) return;
    this.isRefreshing.set(true);
    try {
      await this.googleOAuthService.refreshAnalyticsData();
    } catch (error: any) {
      console.error('Refresh analytics error:', error);
      this.toastService.error(error?.message || 'Failed to refresh analytics data.');
    } finally {
      this.isRefreshing.set(false);
    }
  }

}

