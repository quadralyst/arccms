import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { Component, inject, Injector, OnInit, runInInjectionContext, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Firestore, doc, getDoc, setDoc } from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTabsModule } from '@angular/material/tabs';
import { roleGuard } from '../../../guards/role.guard';
import { ToastService } from '../../../../shared/services/toast.service';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { AudienceService } from '../(audience)/audience.service';
import { IList, contactLists } from '../(audience)/audience.model';
import { arcCallable } from '../../../core/config/arc-functions';
import { TranslocoPipe } from '@jsverse/transloco';
import { injectT } from '../../../core/i18n/inject-t';

export const routeMeta: RouteMeta = {
    title: 'Announcements',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

interface TypeRow { key: string; label: string; enabled: boolean; email: boolean; userConfigurable: boolean; }
interface MappingRow { key: string; enabled: boolean; }

@Component({
    standalone: true,
    imports: [
        CommonModule, FormsModule, MatButtonModule, MatIconModule, MatInputModule,
        MatFormFieldModule, MatSelectModule, MatSlideToggleModule, MatTabsModule, PageHeaderComponent, TranslocoPipe,
    ],
    templateUrl: './announcements.page.html',
    styleUrl: './announcements.page.scss',
})
export default class AnnouncementsPageComponent implements OnInit {
    private firestore = inject(Firestore);
    private functions = inject(Functions);
    private toast = inject(ToastService);
    private injector = inject(Injector);
    private audience = inject(AudienceService);
    private readonly t = injectT();

    // Composer
    title = ''; body = ''; link = '';
    audienceKind: 'all' | 'role' | 'list' = 'all';
    audienceRole = 'user';
    /** Lists to announce to (U4), the same include and exclude shape broadcasts use. */
    includeListIds: string[] = [];
    excludeListIds: string[] = [];
    sendEmail = false;
    sending = signal(false);
    lists = signal<IList[]>([]);

    /**
     * Guards the case that previously fell through to "everyone": picking
     * "By list" and sending with no list selected resolved to all users.
     */
    canPublish(): boolean {
        if (!this.title.trim() || !this.body.trim()) return false;
        return this.audienceKind !== 'list' || this.includeListIds.length > 0;
    }

    /** True once the notification types and event mappings are in: saving before that would write an empty set. */
    configLoaded = signal(false);
    /** Set when they did not load: both tabs say so and offer Retry. */
    configError = signal(false);
    saving = signal(false);

    types = signal<TypeRow[]>([]);
    mappings = signal<MappingRow[]>([]);

    private rawTypes: Record<string, any> = {};
    private rawMappings: Record<string, any> = {};

    ngOnInit(): void {
        void this.seed();
        // A live list has no members an announcement could reach: not offered.
        this.audience.getLists().subscribe((l) => this.lists.set(contactLists(l)));
    }

    private async seed(): Promise<void> {
        try {
            await arcCallable(this.functions, 'seedEmailTemplates')({});
        } catch { /* non-fatal: may already be seeded */ }
        await this.loadConfig();
    }

    /** Read the notification types and event mappings. Retry calls it again after a failed read. */
    async loadConfig(): Promise<void> {
        this.configError.set(false);
        try {
            await this.readConfig();
            this.configLoaded.set(true);
        } catch (e) {
            console.error('Loading the notification settings failed:', e);
            this.configError.set(true);
        }
    }

    private async readConfig(): Promise<void> {
        const typesSnap = await runInInjectionContext(this.injector, () => getDoc(doc(this.firestore, 'Settings', 'notification_types')));
        this.rawTypes = (typesSnap.data()?.['types'] as Record<string, any>) || {};
        this.types.set(Object.entries(this.rawTypes).map(([key, c]) => ({
            key, label: c.label || key, enabled: c.enabled !== false,
            email: c.defaultChannels?.email !== false, userConfigurable: !!c.userConfigurable,
        })));

        const mapSnap = await runInInjectionContext(this.injector, () => getDoc(doc(this.firestore, 'Settings', 'event_mappings')));
        this.rawMappings = (mapSnap.data()?.['mappings'] as Record<string, any>) || {};
        this.mappings.set(Object.entries(this.rawMappings).map(([key, m]) => ({ key, enabled: !!m.enabled })));
    }

    async publish(): Promise<void> {
        if (!this.title.trim() || !this.body.trim()) { this.toast.error(this.t('admin.announcements.required')); return; }
        this.sending.set(true);
        try {
            const audience: any = this.audienceKind === 'role'
                ? { kind: 'role', role: this.audienceRole }
                : this.audienceKind === 'list'
                    ? { kind: 'list', include: [...this.includeListIds] }
                    : { kind: 'all' };
            if (this.excludeListIds.length) audience.exclude = [...this.excludeListIds];
            const res: any = await arcCallable(this.functions, 'sendAnnouncement')({
                title: this.title, body: this.body, link: this.link || undefined, audience, sendEmail: this.sendEmail,
            });
            const d = res?.data || {};
            this.toast.success(this.t('admin.announcements.sent', { notified: d.notified || 0, emailed: d.emailed || 0 }));
            this.title = ''; this.body = ''; this.link = '';
        } catch (e) {
            console.error(e);
            this.toast.error(this.t('admin.announcements.send_failed'));
        } finally {
            this.sending.set(false);
        }
    }

    async saveTypes(): Promise<void> {
        if (!this.configLoaded()) return;
        const merged = { ...this.rawTypes };
        for (const t of this.types()) {
            merged[t.key] = { ...merged[t.key], enabled: t.enabled, defaultChannels: { ...(merged[t.key]?.defaultChannels || { inApp: true }), email: t.email } };
        }
        this.saving.set(true);
        try {
            await runInInjectionContext(this.injector, () => setDoc(doc(this.firestore, 'Settings', 'notification_types'), { types: merged }, { merge: true }));
            this.toast.success(this.t('admin.announcements.types_saved'));
        } catch (e) {
            console.error('Saving the notification types failed:', e);
            this.toast.error(this.t('admin.announcements.save_failed'));
        } finally {
            this.saving.set(false);
        }
    }

    async saveMappings(): Promise<void> {
        if (!this.configLoaded()) return;
        const merged = { ...this.rawMappings };
        for (const m of this.mappings()) merged[m.key] = { ...merged[m.key], enabled: m.enabled };
        this.saving.set(true);
        try {
            await runInInjectionContext(this.injector, () => setDoc(doc(this.firestore, 'Settings', 'event_mappings'), { mappings: merged }, { merge: true }));
            this.toast.success(this.t('admin.announcements.mappings_saved'));
        } catch (e) {
            console.error('Saving the event mappings failed:', e);
            this.toast.error(this.t('admin.announcements.save_failed'));
        } finally {
            this.saving.set(false);
        }
    }
}
