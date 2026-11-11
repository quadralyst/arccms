/**
 * One sign-up, in a side panel: their answers, where they came from, their tags
 * and the admin's notes on them.
 */

import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, OnInit, OnChanges, SimpleChanges, Injector, inject, runInInjectionContext, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Firestore, collection, getDocs, addDoc, deleteDoc, doc, updateDoc, orderBy, query, Timestamp } from '@angular/fire/firestore';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { IWaitlistUserTag } from '../waitlist-user-tags.model';
import { IWaitlistUserNote, getWaitlistUserNotesPath } from '../waitlist-user-notes.model';
import { WaitlistUserTagsStore } from '../waitlist-user-tags.store';
import { GlobalService } from '../../../../../../shared/services/global.service';
import { ISignupMetadata } from '../../../../waitlist/signup-metadata.model';
import { LoaderComponent } from '../../../../../../shared/components/loader/loader.component';
import { NotifyService } from '../../../../../../shared/services/notify.service';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { toSignal } from '@angular/core/rxjs-interop';

interface WaitlistUser {
    id: string;
    email: string;
    firstName: string;
    emailVerified: boolean;
    isConfirmed: boolean;
    signupTimestamp: any;
    verifiedAt?: any;
    formData?: Record<string, any>;
    tags?: string[];
    signupMetadata?: ISignupMetadata;
}

@Component({
    selector: 'arc-view-user-detail',
    templateUrl: './view-user-detail.component.html',
    styleUrls: ['./view-user-detail.component.scss'],
    standalone: true,
    imports: [
        LoaderComponent, CommonModule,
        FormsModule,
        MatIconModule,
        MatButtonModule,
        TranslocoPipe
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
    private injector = inject(Injector);
    private notify = inject(NotifyService);
    private transloco = inject(TranslocoService);
    /** The admin language, so the details below re-read their words when it changes. */
    private lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

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

    // Form data keys for display - uses userSignal for reactivity
    formDataEntries = computed(() => {
        const user = this.userSignal();
        if (!user?.formData) return [];
        this.lang();
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
        this.lang();
        const t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(key, params);
        const yesNo = (v: boolean) => t(v ? 'common.yes' : 'common.no');

        const metadata = user.signupMetadata;
        const entries: { key: string; label: string; value: string; icon?: string }[] = [];

        // Attribution
        if (metadata.utmSource) entries.push({ key: 'utmSource', label: t('admin.forms.detail.meta.utm_source'), value: metadata.utmSource, icon: 'fa-bullhorn' });
        if (metadata.utmMedium) entries.push({ key: 'utmMedium', label: t('admin.forms.detail.meta.utm_medium'), value: metadata.utmMedium, icon: 'fa-layer-group' });
        if (metadata.utmCampaign) entries.push({ key: 'utmCampaign', label: t('admin.forms.detail.meta.utm_campaign'), value: metadata.utmCampaign, icon: 'fa-flag' });
        if (metadata.utmContent) entries.push({ key: 'utmContent', label: t('admin.forms.detail.meta.utm_content'), value: metadata.utmContent, icon: 'fa-file-alt' });
        if (metadata.utmTerm) entries.push({ key: 'utmTerm', label: t('admin.forms.detail.meta.utm_term'), value: metadata.utmTerm, icon: 'fa-search' });
        if (metadata.referrerUrl) entries.push({ key: 'referrerUrl', label: t('admin.forms.detail.meta.referrer'), value: this.truncateUrl(metadata.referrerUrl), icon: 'fa-link' });
        if (metadata.landingPage) entries.push({ key: 'landingPage', label: t('admin.forms.detail.meta.landing_page'), value: this.truncateUrl(metadata.landingPage), icon: 'fa-file' });
        if (metadata.queryParams && Object.keys(metadata.queryParams).length > 0) {
            const paramStr = Object.entries(metadata.queryParams).map(([k, v]) => `${k}=${v}`).join(', ');
            entries.push({ key: 'queryParams', label: t('admin.forms.detail.meta.query_params'), value: paramStr, icon: 'fa-question-circle' });
        }

        // Device
        if (metadata.deviceType) entries.push({ key: 'deviceType', label: t('admin.forms.detail.meta.device'), value: this.capitalize(metadata.deviceType), icon: this.getDeviceIcon(metadata.deviceType) });
        if (metadata.browser) entries.push({ key: 'browser', label: t('admin.forms.detail.meta.browser'), value: `${metadata.browser}${metadata.browserVersion ? ' ' + metadata.browserVersion : ''}`, icon: 'fa-globe' });
        if (metadata.operatingSystem) entries.push({ key: 'operatingSystem', label: t('admin.forms.detail.meta.os'), value: metadata.operatingSystem, icon: 'fa-desktop' });
        if (metadata.screenResolution) entries.push({ key: 'screenResolution', label: t('admin.forms.detail.meta.screen'), value: metadata.screenResolution, icon: 'fa-expand' });
        if (metadata.language) entries.push({ key: 'language', label: t('admin.forms.detail.meta.language'), value: metadata.language, icon: 'fa-language' });

        // Device Extended
        if (metadata.connectionType) entries.push({ key: 'connectionType', label: t('admin.forms.detail.meta.connection'), value: metadata.connectionType, icon: 'fa-wifi' });
        if (metadata.downlinkSpeed !== undefined) entries.push({ key: 'downlinkSpeed', label: t('admin.forms.detail.meta.download_speed'), value: `${metadata.downlinkSpeed} Mbps`, icon: 'fa-tachometer-alt' });
        if (metadata.prefersDarkMode !== undefined) entries.push({ key: 'prefersDarkMode', label: t('admin.forms.detail.meta.dark_mode'), value: yesNo(metadata.prefersDarkMode), icon: 'fa-moon' });
        if (metadata.viewportSize) entries.push({ key: 'viewportSize', label: t('admin.forms.detail.meta.viewport'), value: metadata.viewportSize, icon: 'fa-window-maximize' });
        if (metadata.isTouchDevice !== undefined) entries.push({ key: 'isTouchDevice', label: t('admin.forms.detail.meta.touch_device'), value: yesNo(metadata.isTouchDevice), icon: 'fa-hand-pointer' });
        if (metadata.pageLoadTimeMs !== undefined) entries.push({ key: 'pageLoadTimeMs', label: t('admin.forms.detail.meta.page_load'), value: `${metadata.pageLoadTimeMs}ms`, icon: 'fa-stopwatch' });

        // Behavioral (Phase 2)
        if (metadata.timeOnPageMs !== undefined && metadata.timeOnPageMs > 0) {
            entries.push({ key: 'timeOnPage', label: t('admin.forms.detail.meta.time_on_page'), value: this.formatDuration(metadata.timeOnPageMs), icon: 'fa-clock' });
        }
        if (metadata.scrollDepthPercent !== undefined) {
            entries.push({ key: 'scrollDepth', label: t('admin.forms.detail.meta.scroll_depth'), value: `${metadata.scrollDepthPercent}%`, icon: 'fa-arrows-alt-v' });
        }
        if (metadata.isReturnVisitor !== undefined) {
            let encodedVal = t(metadata.isReturnVisitor ? 'admin.forms.detail.returning' : 'admin.forms.detail.new_visitor');
            if (metadata.isReturnVisitor && metadata.visitCount && metadata.visitCount > 1) {
                encodedVal += ` (${metadata.visitCount})`;
            }
            entries.push({ key: 'isReturnVisitor', label: t('admin.forms.detail.meta.visitor_type'), value: encodedVal, icon: 'fa-user' });
        }

        // Cross-Session Behavioral (Phase 2b)
        if (metadata.firstVisitTimestamp && metadata.firstVisitTimestamp > 0) {
            entries.push({ key: 'firstVisit', label: t('admin.forms.detail.meta.first_visit'), value: this.formatDate(new Date(metadata.firstVisitTimestamp)), icon: 'fa-calendar-plus' });
        }
        if (metadata.lastVisitTimestamp) {
            entries.push({ key: 'lastVisit', label: t('admin.forms.detail.meta.last_visit'), value: this.formatDate(new Date(metadata.lastVisitTimestamp)), icon: 'fa-calendar-check' });
        }
        if (metadata.totalTimeOnPageMs !== undefined && metadata.totalTimeOnPageMs > 0) {
            entries.push({ key: 'totalTimeOnPage', label: t('admin.forms.detail.meta.total_time'), value: this.formatDuration(metadata.totalTimeOnPageMs), icon: 'fa-hourglass-half' });
        }
        if (metadata.maxScrollDepthPercent !== undefined) {
            entries.push({ key: 'maxScrollDepth', label: t('admin.forms.detail.meta.max_scroll_depth'), value: `${metadata.maxScrollDepthPercent}%`, icon: 'fa-arrows-alt-v' });
        }

        // Engagement (Phase 2c)
        if (metadata.clickCount !== undefined && metadata.clickCount > 0) {
            entries.push({ key: 'clickCount', label: t('admin.forms.detail.meta.clicks'), value: String(metadata.clickCount), icon: 'fa-mouse-pointer' });
        }
        if (metadata.tabSwitchCount !== undefined && metadata.tabSwitchCount > 0) {
            entries.push({ key: 'tabSwitchCount', label: t('admin.forms.detail.meta.tab_switches'), value: String(metadata.tabSwitchCount), icon: 'fa-exchange-alt' });
        }
        if (metadata.formStartCount !== undefined && metadata.formStartCount > 0) {
            entries.push({ key: 'formStartCount', label: t('admin.forms.detail.meta.form_interactions'), value: String(metadata.formStartCount), icon: 'fa-hand-pointer' });
        }

        // Geolocation (Phase 3)
        if (metadata.country) entries.push({ key: 'country', label: t('admin.forms.detail.meta.country'), value: metadata.country, icon: 'fa-globe-americas' });
        if (metadata.region) entries.push({ key: 'region', label: t('admin.forms.detail.meta.region'), value: metadata.region, icon: 'fa-map' });
        if (metadata.city) entries.push({ key: 'city', label: t('admin.forms.detail.meta.city'), value: metadata.city, icon: 'fa-map-marker-alt' });
        if (metadata.timezone) entries.push({ key: 'timezone', label: t('admin.forms.detail.meta.timezone'), value: metadata.timezone, icon: 'fa-clock' });
        if (metadata.timezoneOffset !== undefined) {
            const offset = metadata.timezoneOffset;
            const sign = offset <= 0 ? '+' : '-';
            const absOffset = Math.abs(offset);
            const hours = Math.floor(absOffset / 60);
            const mins = absOffset % 60;
            entries.push({ key: 'timezoneOffset', label: t('admin.forms.detail.meta.utc_offset'), value: `UTC${sign}${hours}${mins > 0 ? ':' + String(mins).padStart(2, '0') : ''}`, icon: 'fa-globe' });
        }

        // Temporal
        if (metadata.signupHour !== undefined) {
            const at = new Date(2024, 0, 1, metadata.signupHour);
            const hour = new Intl.DateTimeFormat(this.lang(), { hour: 'numeric' }).format(at);
            entries.push({ key: 'signupHour', label: t('admin.forms.detail.meta.signup_hour'), value: hour, icon: 'fa-sun' });
        }
        if (metadata.signupDayOfWeek !== undefined) {
            // 7 January 2024 was a Sunday, so day n of the week is 7 + n January.
            const day = metadata.signupDayOfWeek >= 0 && metadata.signupDayOfWeek <= 6
                ? new Intl.DateTimeFormat(this.lang(), { weekday: 'long' }).format(new Date(2024, 0, 7 + metadata.signupDayOfWeek))
                : t('admin.forms.detail.unknown');
            entries.push({ key: 'signupDayOfWeek', label: t('admin.forms.detail.meta.signup_day'), value: day, icon: 'fa-calendar-day' });
        }

        // Email Quality (Phase 4)
        if (metadata.isDisposableEmail !== undefined) {
            entries.push({
                key: 'isDisposableEmail',
                label: t('admin.forms.detail.meta.email_type'),
                value: t(metadata.isDisposableEmail ? 'admin.forms.detail.email_disposable' : 'admin.forms.detail.email_valid'),
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
            const notesRef = runInInjectionContext(this.injector, () => collection(this.firestore, notesPath));
            const q = runInInjectionContext(this.injector, () => query(notesRef, orderBy('createdAt', 'desc')));
            const snapshot = await runInInjectionContext(this.injector, () => getDocs(q));

            const notesList: IWaitlistUserNote[] = [];
            snapshot.forEach((doc) => {
                notesList.push({ id: doc.id, ...doc.data() } as IWaitlistUserNote);
            });
            this.notes.set(notesList);
        } catch (error) {
            console.error('Error loading notes:', error);
            this.notify.error('admin.forms.detail.notes_load_failed');
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
            this.notify.error('admin.forms.detail.note_save_failed');
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
            this.notify.error('admin.forms.detail.note_delete_failed');
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
            this.notify.error('admin.forms.detail.note_save_failed');
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
                this.notify.error('admin.forms.tags.add_failed');
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
            this.notify.error('admin.forms.detail.tags_save_failed');
        } finally {
            this.isSavingTags.set(false);
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
        if (value === null || value === undefined) return '-';
        if (typeof value === 'boolean') return this.transloco.translate(value ? 'common.yes' : 'common.no');
        if (Array.isArray(value)) return value.join(', ');
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value);
    }

    formatDate(timestamp: any): string {
        if (!timestamp) return '-';
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
