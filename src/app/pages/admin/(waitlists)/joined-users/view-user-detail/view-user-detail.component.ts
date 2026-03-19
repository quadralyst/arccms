/**
 * View User Detail Component
 * 
 * Sliding panel component showing waitlist user details including:
 * - All form data fields (dynamic)
 * - Referral information
 * - Tags management
 * - Notes/Journal entries
 */

import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, OnInit, OnChanges, SimpleChanges, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Firestore, collection, getDocs, addDoc, deleteDoc, doc, updateDoc, orderBy, query, Timestamp, where } from '@angular/fire/firestore';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { IWaitlistUserTag } from '../waitlist-user-tags.model';
import { IWaitlistUserNote, getWaitlistUserNotesPath } from '../waitlist-user-notes.model';
import { WaitlistUserTagsStore } from '../waitlist-user-tags.store';
import { GlobalService } from '../../../../../../shared/services/global.service';
import { ISignupMetadata } from '../../../../waitlist/signup-metadata.model';

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
    signupMetadata?: ISignupMetadata;
    referredBy?: string;
    waitlistedUserId?: string;
}

interface ReferralRecord {
    id: string;
    referredName: string;
    referredMaskedEmail: string;
    status: string;
    createdAt: any;
    completedAt: any;
}

@Component({
    selector: 'arc-view-user-detail',
    templateUrl: './view-user-detail.component.html',
    styleUrls: ['./view-user-detail.component.scss'],
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        MatIconModule,
        MatButtonModule
    ],
})
export class ViewUserDetailComponent implements OnInit, OnChanges {
    @Input() user: WaitlistUser | null = null;
    @Input() waitlistId: string = '';
    @Output() close = new EventEmitter<void>();
    @Output() userUpdated = new EventEmitter<WaitlistUser>();

    private firestore = inject(Firestore);
    private tagsStore = inject(WaitlistUserTagsStore);
    public globalService = inject(GlobalService);

    // User signal for reactive computed properties
    private userSignal = signal<WaitlistUser | null>(null);

    // Notes state
    notes = signal<IWaitlistUserNote[]>([]);
    newNoteContent = signal<string>('');
    isLoadingNotes = signal(false);
    isSavingNote = signal(false);

    // Note editing state
    editingNoteId = signal<string | null>(null);
    editNoteContent = signal<string>('');

    // Tags state
    allTags = computed(() => this.tagsStore.items());
    selectedTags = signal<IWaitlistUserTag[]>([]);
    tagSearchTerm = signal<string>('');
    showTagDropdown = signal(false);
    filteredTags = computed(() => {
        const term = this.tagSearchTerm().toLowerCase();
        const selected = this.selectedTags();
        return this.allTags().filter(tag =>
            tag.label.toLowerCase().includes(term) &&
            !selected.some(s => s.id === tag.id)
        );
    });
    isSavingTags = signal(false);

    // Referral detail state
    referredByCode = signal<string>('');
    referredByUser = signal<{ firstName: string; email: string } | null>(null);
    isLoadingReferredBy = signal(false);
    referredUsers = signal<ReferralRecord[]>([]);
    isLoadingReferredUsers = signal(false);

    // Form data keys for display - uses userSignal for reactivity
    formDataEntries = computed(() => {
        const user = this.userSignal();
        if (!user?.formData) return [];
        return Object.entries(user.formData).map(([key, value]) => ({
            key,
            label: this.formatFieldLabel(key),
            value: this.formatFieldValue(value)
        }));
    });

    // Signup metadata entries for display
    metadataEntries = computed(() => {
        const user = this.userSignal();
        if (!user?.signupMetadata) return [];

        const metadata = user.signupMetadata;
        const entries: { key: string; label: string; value: string; icon?: string }[] = [];

        // Attribution
        if (metadata.utmSource) entries.push({ key: 'utmSource', label: 'UTM Source', value: metadata.utmSource, icon: 'fa-bullhorn' });
        if (metadata.utmMedium) entries.push({ key: 'utmMedium', label: 'UTM Medium', value: metadata.utmMedium, icon: 'fa-layer-group' });
        if (metadata.utmCampaign) entries.push({ key: 'utmCampaign', label: 'UTM Campaign', value: metadata.utmCampaign, icon: 'fa-flag' });
        if (metadata.utmContent) entries.push({ key: 'utmContent', label: 'UTM Content', value: metadata.utmContent, icon: 'fa-file-alt' });
        if (metadata.utmTerm) entries.push({ key: 'utmTerm', label: 'UTM Term', value: metadata.utmTerm, icon: 'fa-search' });
        if (metadata.referrerUrl) entries.push({ key: 'referrerUrl', label: 'Referrer', value: this.truncateUrl(metadata.referrerUrl), icon: 'fa-link' });
        if (metadata.landingPage) entries.push({ key: 'landingPage', label: 'Landing Page', value: this.truncateUrl(metadata.landingPage), icon: 'fa-file' });
        if (metadata.queryParams && Object.keys(metadata.queryParams).length > 0) {
            const paramStr = Object.entries(metadata.queryParams).map(([k, v]) => `${k}=${v}`).join(', ');
            entries.push({ key: 'queryParams', label: 'Query Params', value: paramStr, icon: 'fa-question-circle' });
        }

        // Device
        if (metadata.deviceType) entries.push({ key: 'deviceType', label: 'Device', value: this.capitalize(metadata.deviceType), icon: this.getDeviceIcon(metadata.deviceType) });
        if (metadata.browser) entries.push({ key: 'browser', label: 'Browser', value: `${metadata.browser}${metadata.browserVersion ? ' ' + metadata.browserVersion : ''}`, icon: 'fa-globe' });
        if (metadata.operatingSystem) entries.push({ key: 'operatingSystem', label: 'OS', value: metadata.operatingSystem, icon: 'fa-desktop' });
        if (metadata.screenResolution) entries.push({ key: 'screenResolution', label: 'Screen', value: metadata.screenResolution, icon: 'fa-expand' });
        if (metadata.language) entries.push({ key: 'language', label: 'Language', value: metadata.language, icon: 'fa-language' });

        // Device Extended
        if (metadata.connectionType) entries.push({ key: 'connectionType', label: 'Connection', value: metadata.connectionType, icon: 'fa-wifi' });
        if (metadata.downlinkSpeed !== undefined) entries.push({ key: 'downlinkSpeed', label: 'Download Speed', value: `${metadata.downlinkSpeed} Mbps`, icon: 'fa-tachometer-alt' });
        if (metadata.prefersDarkMode !== undefined) entries.push({ key: 'prefersDarkMode', label: 'Dark Mode', value: metadata.prefersDarkMode ? 'Yes' : 'No', icon: 'fa-moon' });
        if (metadata.viewportSize) entries.push({ key: 'viewportSize', label: 'Viewport', value: metadata.viewportSize, icon: 'fa-window-maximize' });
        if (metadata.isTouchDevice !== undefined) entries.push({ key: 'isTouchDevice', label: 'Touch Device', value: metadata.isTouchDevice ? 'Yes' : 'No', icon: 'fa-hand-pointer' });
        if (metadata.pageLoadTimeMs !== undefined) entries.push({ key: 'pageLoadTimeMs', label: 'Page Load', value: `${metadata.pageLoadTimeMs}ms`, icon: 'fa-stopwatch' });

        // Behavioral (Phase 2)
        if (metadata.timeOnPageMs !== undefined && metadata.timeOnPageMs > 0) {
            entries.push({ key: 'timeOnPage', label: 'Time on Page', value: this.formatDuration(metadata.timeOnPageMs), icon: 'fa-clock' });
        }
        if (metadata.scrollDepthPercent !== undefined) {
            entries.push({ key: 'scrollDepth', label: 'Scroll Depth', value: `${metadata.scrollDepthPercent}%`, icon: 'fa-arrows-alt-v' });
        }
        if (metadata.isReturnVisitor !== undefined) {
            let encodedVal = metadata.isReturnVisitor ? 'Returning' : 'New';
            if (metadata.isReturnVisitor && metadata.visitCount && metadata.visitCount > 1) {
                encodedVal += ` (${metadata.visitCount})`;
            }
            entries.push({ key: 'isReturnVisitor', label: 'Visitor Type', value: encodedVal, icon: 'fa-user' });
        }

        // Cross-Session Behavioral (Phase 2b)
        if (metadata.firstVisitTimestamp && metadata.firstVisitTimestamp > 0) {
            entries.push({ key: 'firstVisit', label: 'First Visit', value: this.formatDate(new Date(metadata.firstVisitTimestamp)), icon: 'fa-calendar-plus' });
        }
        if (metadata.lastVisitTimestamp) {
            entries.push({ key: 'lastVisit', label: 'Last Visit', value: this.formatDate(new Date(metadata.lastVisitTimestamp)), icon: 'fa-calendar-check' });
        }
        if (metadata.totalTimeOnPageMs !== undefined && metadata.totalTimeOnPageMs > 0) {
            entries.push({ key: 'totalTimeOnPage', label: 'Total Time (All Visits)', value: this.formatDuration(metadata.totalTimeOnPageMs), icon: 'fa-hourglass-half' });
        }
        if (metadata.maxScrollDepthPercent !== undefined) {
            entries.push({ key: 'maxScrollDepth', label: 'Max Scroll Depth', value: `${metadata.maxScrollDepthPercent}%`, icon: 'fa-arrows-alt-v' });
        }

        // Engagement (Phase 2c)
        if (metadata.clickCount !== undefined && metadata.clickCount > 0) {
            entries.push({ key: 'clickCount', label: 'Clicks', value: `${metadata.clickCount} clicks`, icon: 'fa-mouse-pointer' });
        }
        if (metadata.tabSwitchCount !== undefined && metadata.tabSwitchCount > 0) {
            entries.push({ key: 'tabSwitchCount', label: 'Tab Switches', value: `${metadata.tabSwitchCount} times`, icon: 'fa-exchange-alt' });
        }
        if (metadata.formStartCount !== undefined && metadata.formStartCount > 0) {
            entries.push({ key: 'formStartCount', label: 'Form Interactions', value: `${metadata.formStartCount} session${metadata.formStartCount !== 1 ? 's' : ''}`, icon: 'fa-hand-pointer' });
        }

        // Geolocation (Phase 3)
        if (metadata.country) entries.push({ key: 'country', label: 'Country', value: metadata.country, icon: 'fa-globe-americas' });
        if (metadata.region) entries.push({ key: 'region', label: 'Region', value: metadata.region, icon: 'fa-map' });
        if (metadata.city) entries.push({ key: 'city', label: 'City', value: metadata.city, icon: 'fa-map-marker-alt' });
        if (metadata.timezone) entries.push({ key: 'timezone', label: 'Timezone', value: metadata.timezone, icon: 'fa-clock' });
        if (metadata.timezoneOffset !== undefined) {
            const offset = metadata.timezoneOffset;
            const sign = offset <= 0 ? '+' : '-';
            const absOffset = Math.abs(offset);
            const hours = Math.floor(absOffset / 60);
            const mins = absOffset % 60;
            entries.push({ key: 'timezoneOffset', label: 'UTC Offset', value: `UTC${sign}${hours}${mins > 0 ? ':' + String(mins).padStart(2, '0') : ''}`, icon: 'fa-globe' });
        }

        // Temporal
        if (metadata.signupHour !== undefined) {
            const hour = metadata.signupHour;
            const ampm = hour >= 12 ? 'PM' : 'AM';
            const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
            entries.push({ key: 'signupHour', label: 'Signup Hour', value: `${displayHour}:00 ${ampm}`, icon: 'fa-sun' });
        }
        if (metadata.signupDayOfWeek !== undefined) {
            const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            entries.push({ key: 'signupDayOfWeek', label: 'Signup Day', value: days[metadata.signupDayOfWeek] || 'Unknown', icon: 'fa-calendar-day' });
        }

        // Email Quality (Phase 4)
        if (metadata.isDisposableEmail !== undefined) {
            entries.push({
                key: 'isDisposableEmail',
                label: 'Email Type',
                value: metadata.isDisposableEmail ? '⚠️ Disposable' : '✓ Valid',
                icon: metadata.isDisposableEmail ? 'fa-exclamation-triangle' : 'fa-check-circle'
            });
        }

        return entries;
    });

    hasSignupMetadata = computed(() => this.metadataEntries().length > 0);

    ngOnInit(): void {
        if (this.waitlistId) {
            this.tagsStore.setWaitlistId(this.waitlistId);
            this.loadTags();
        }
    }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['user'] && this.user) {
            // Update signal for reactive computed
            this.userSignal.set(this.user);
            this.loadNotes();
            this.loadUserTags();
            this.loadReferredByInfo();
            this.loadReferredUsers();
        }
        if (changes['waitlistId'] && this.waitlistId) {
            this.tagsStore.setWaitlistId(this.waitlistId);
            this.loadTags();
        }
    }

    closePanel(): void {
        this.close.emit();
    }

    // --- Notes Methods ---

    async loadNotes(): Promise<void> {
        if (!this.user || !this.waitlistId) return;

        this.isLoadingNotes.set(true);
        try {
            const notesPath = getWaitlistUserNotesPath(this.waitlistId, this.user.id);
            const notesRef = collection(this.firestore, notesPath);
            const q = query(notesRef, orderBy('createdAt', 'desc'));
            const snapshot = await getDocs(q);

            const notesList: IWaitlistUserNote[] = [];
            snapshot.forEach((doc) => {
                notesList.push({ id: doc.id, ...doc.data() } as IWaitlistUserNote);
            });
            this.notes.set(notesList);
        } catch (error) {
            console.error('Error loading notes:', error);
        } finally {
            this.isLoadingNotes.set(false);
        }
    }

    async addNote(): Promise<void> {
        const content = this.newNoteContent().trim();
        if (!content || !this.user || !this.waitlistId) return;

        this.isSavingNote.set(true);
        try {
            const notesPath = getWaitlistUserNotesPath(this.waitlistId, this.user.id);
            const notesRef = collection(this.firestore, notesPath);
            await addDoc(notesRef, {
                content,
                createdAt: Timestamp.now(),
            });
            this.newNoteContent.set('');
            await this.loadNotes();
        } catch (error) {
            console.error('Error adding note:', error);
        } finally {
            this.isSavingNote.set(false);
        }
    }

    async deleteNote(note: IWaitlistUserNote): Promise<void> {
        if (!this.user || !this.waitlistId) return;

        try {
            const notesPath = getWaitlistUserNotesPath(this.waitlistId, this.user.id);
            const noteRef = doc(this.firestore, notesPath, note.id);
            await deleteDoc(noteRef);
            await this.loadNotes();
        } catch (error) {
            console.error('Error deleting note:', error);
        }
    }

    startEditNote(note: IWaitlistUserNote): void {
        this.editingNoteId.set(note.id);
        this.editNoteContent.set(note.content);
    }

    cancelEditNote(): void {
        this.editingNoteId.set(null);
        this.editNoteContent.set('');
    }

    async saveEditedNote(note: IWaitlistUserNote): Promise<void> {
        if (!this.user || !this.waitlistId) return;

        const content = this.editNoteContent().trim();
        if (!content) return;

        this.isSavingNote.set(true);
        try {
            const notesPath = getWaitlistUserNotesPath(this.waitlistId, this.user.id);
            const noteRef = doc(this.firestore, notesPath, note.id);
            await updateDoc(noteRef, { content });
            this.editingNoteId.set(null);
            this.editNoteContent.set('');
            await this.loadNotes();
        } catch (error) {
            console.error('Error updating note:', error);
        } finally {
            this.isSavingNote.set(false);
        }
    }

    // --- Tags Methods ---

    loadTags(): void {
        this.tagsStore.getAll({
            limitCount: 100,
            currentPageNumber: 0,
            previousPageNumber: -1
        });
    }

    loadUserTags(): void {
        if (!this.user?.tags) {
            this.selectedTags.set([]);
            return;
        }

        // Match user's tag IDs with full tag objects
        const userTagIds = this.user.tags;
        const matchedTags = this.allTags().filter(tag => userTagIds.includes(tag.id));
        this.selectedTags.set(matchedTags);
    }

    onTagSearchInput(event: Event): void {
        const value = (event.target as HTMLInputElement).value;
        this.tagSearchTerm.set(value);
    }

    onTagSearchFocus(): void {
        this.showTagDropdown.set(true);
    }

    onTagSearchBlur(): void {
        // Delay to allow click events on dropdown
        setTimeout(() => this.showTagDropdown.set(false), 200);
    }

    selectTag(tag: IWaitlistUserTag): void {
        this.selectedTags.update(tags => [...tags, tag]);
        this.tagSearchTerm.set('');
        this.saveTags();
    }

    removeTag(tag: IWaitlistUserTag): void {
        this.selectedTags.update(tags => tags.filter(t => t.id !== tag.id));
        this.saveTags();
    }

    async createTag(): Promise<void> {
        const label = this.tagSearchTerm().trim();
        if (!label || !this.waitlistId) return;

        const tagData = this.tagsStore.addTagWithAutoColor(label);

        // Create the new tag
        this.tagsStore.add({
            ...tagData,
            waitlistId: this.waitlistId,
            usageCount: 1,
        } as any).subscribe({
            next: (newTagId) => {
                this.tagSearchTerm.set('');

                // Create a tag object with the new ID and auto-assign it
                const newTag: IWaitlistUserTag = {
                    id: newTagId,
                    ...tagData,
                    waitlistId: this.waitlistId,
                    usageCount: 1,
                } as IWaitlistUserTag;

                this.selectedTags.update(tags => [...tags, newTag]);
                this.saveTags();
                this.loadTags();
            },
            error: (error) => {
                console.error('Error creating tag:', error);
            }
        });
    }

    hasMatchingTag(): boolean {
        const term = this.tagSearchTerm().toLowerCase();
        return this.allTags().some(tag => tag.label.toLowerCase() === term);
    }

    async saveTags(): Promise<void> {
        if (!this.user || !this.waitlistId) return;

        this.isSavingTags.set(true);
        try {
            const userRef = doc(this.firestore, `Waitlists/${this.waitlistId}/users`, this.user.id);
            const tagIds = this.selectedTags().map(t => t.id);
            await updateDoc(userRef, { tags: tagIds });
            this.userUpdated.emit({ ...this.user, tags: tagIds });
        } catch (error) {
            console.error('Error saving tags:', error);
        } finally {
            this.isSavingTags.set(false);
        }
    }

    // --- Referral Methods ---

    async loadReferredByInfo(): Promise<void> {
        if (!this.user?.referredBy) {
            this.referredByCode.set('');
            this.referredByUser.set(null);
            return;
        }

        this.referredByCode.set(this.user.referredBy);
        this.isLoadingReferredBy.set(true);
        this.referredByUser.set(null);

        try {
            const referrerQuery = query(
                collection(this.firestore, 'WaitlistedUsers'),
                where('referralCode', '==', this.user.referredBy)
            );
            const snapshot = await getDocs(referrerQuery);

            if (!snapshot.empty) {
                const data = snapshot.docs[0].data();
                this.referredByUser.set({
                    firstName: (data['firstName'] as string) || '',
                    email: (data['email'] as string) || '',
                });
            }
        } catch (error) {
            console.error('Error loading referrer info:', error);
        } finally {
            this.isLoadingReferredBy.set(false);
        }
    }

    async loadReferredUsers(): Promise<void> {
        if (!this.user?.waitlistedUserId) {
            this.referredUsers.set([]);
            return;
        }

        this.isLoadingReferredUsers.set(true);
        try {
            const referralsRef = collection(
                this.firestore, 'WaitlistedUsers', this.user.waitlistedUserId, 'referrals'
            );
            const snapshot = await getDocs(referralsRef);

            const records: ReferralRecord[] = snapshot.docs.map((docSnap) => {
                const data = docSnap.data();
                return {
                    id: docSnap.id,
                    referredName: (data['referredName'] as string) || '',
                    referredMaskedEmail: (data['referredMaskedEmail'] as string) || '',
                    status: (data['status'] as string) || '',
                    createdAt: data['createdAt'],
                    completedAt: data['completedAt'],
                };
            });
            this.referredUsers.set(records);
        } catch (error) {
            console.error('Error loading referred users:', error);
        } finally {
            this.isLoadingReferredUsers.set(false);
        }
    }

    // --- Formatting Helpers ---

    formatFieldLabel(key: string): string {
        // Convert camelCase or snake_case to Title Case
        return key
            .replace(/([A-Z])/g, ' $1')
            .replace(/_/g, ' ')
            .replace(/^\w/, c => c.toUpperCase())
            .trim();
    }

    formatFieldValue(value: any): string {
        if (value === null || value === undefined) return '—';
        if (typeof value === 'boolean') return value ? 'Yes' : 'No';
        if (Array.isArray(value)) return value.join(', ');
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value);
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

    /**
     * Copy text to clipboard
     */
    async copyToClipboard(text: string): Promise<void> {
        await this.globalService.copyToClipboard(text);
    }

    /**
     * Truncate URL for display
     */
    private truncateUrl(url: string): string {
        try {
            const parsed = new URL(url);
            const path = parsed.pathname.length > 30
                ? parsed.pathname.substring(0, 27) + '...'
                : parsed.pathname;
            return parsed.hostname + path;
        } catch {
            return url.length > 50 ? url.substring(0, 47) + '...' : url;
        }
    }

    /**
     * Capitalize first letter
     */
    private capitalize(str: string): string {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    /**
     * Get device icon based on type
     */
    private getDeviceIcon(deviceType: string): string {
        switch (deviceType) {
            case 'mobile': return 'fa-mobile-alt';
            case 'tablet': return 'fa-tablet-alt';
            default: return 'fa-laptop';
        }
    }

    /**
     * Format duration in milliseconds to human-readable string
     */
    private formatDuration(ms: number): string {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;

        if (minutes > 0) {
            return `${minutes}m ${remainingSeconds}s`;
        }
        return `${seconds}s`;
    }
}
