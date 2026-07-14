import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Firestore, doc, getDoc, setDoc } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTabsModule } from '@angular/material/tabs';
import { roleGuard } from '../../../guards/role.guard';
import { ToastService } from '../../../../shared/services/toast.service';

export const routeMeta: RouteMeta = {
    title: 'Announcements & Notifications | Arc CMS',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

interface TypeRow { key: string; label: string; enabled: boolean; email: boolean; userConfigurable: boolean; }
interface MappingRow { key: string; enabled: boolean; }

@Component({
    standalone: true,
    imports: [
        CommonModule, FormsModule, MatButtonModule, MatIconModule, MatInputModule,
        MatFormFieldModule, MatSelectModule, MatSlideToggleModule, MatTabsModule,
    ],
    templateUrl: './announcements.page.html',
    styleUrl: './announcements.page.scss',
})
export default class AnnouncementsPageComponent implements OnInit {
    private firestore = inject(Firestore);
    private functions = inject(Functions);
    private toast = inject(ToastService);

    // Composer
    title = ''; body = ''; link = '';
    audienceKind: 'all' | 'role' | 'list' = 'all';
    audienceRole = 'user';
    sendEmail = false;
    sending = signal(false);

    types = signal<TypeRow[]>([]);
    mappings = signal<MappingRow[]>([]);

    private rawTypes: Record<string, any> = {};
    private rawMappings: Record<string, any> = {};

    ngOnInit(): void {
        void this.seed();
    }

    private async seed(): Promise<void> {
        try {
            await httpsCallable(this.functions, 'seedEmailTemplates')({});
        } catch { /* non-fatal — may already be seeded */ }
        await this.loadConfig();
    }

    private async loadConfig(): Promise<void> {
        const typesSnap = await getDoc(doc(this.firestore, 'Settings', 'notification_types'));
        this.rawTypes = (typesSnap.data()?.['types'] as Record<string, any>) || {};
        this.types.set(Object.entries(this.rawTypes).map(([key, c]) => ({
            key, label: c.label || key, enabled: c.enabled !== false,
            email: c.defaultChannels?.email !== false, userConfigurable: !!c.userConfigurable,
        })));

        const mapSnap = await getDoc(doc(this.firestore, 'Settings', 'event_mappings'));
        this.rawMappings = (mapSnap.data()?.['mappings'] as Record<string, any>) || {};
        this.mappings.set(Object.entries(this.rawMappings).map(([key, m]) => ({ key, enabled: !!m.enabled })));
    }

    async publish(): Promise<void> {
        if (!this.title.trim() || !this.body.trim()) { this.toast.error('Title and body are required'); return; }
        this.sending.set(true);
        try {
            const audience: any = this.audienceKind === 'role'
                ? { kind: 'role', role: this.audienceRole }
                : { kind: this.audienceKind };
            const res: any = await httpsCallable(this.functions, 'sendAnnouncement')({
                title: this.title, body: this.body, link: this.link || undefined, audience, sendEmail: this.sendEmail,
            });
            const d = res?.data || {};
            this.toast.success(`Announced to ${d.notified || 0} users (${d.emailed || 0} emailed)`);
            this.title = ''; this.body = ''; this.link = '';
        } catch (e) {
            console.error(e);
            this.toast.error('Failed to send announcement');
        } finally {
            this.sending.set(false);
        }
    }

    async saveTypes(): Promise<void> {
        const merged = { ...this.rawTypes };
        for (const t of this.types()) {
            merged[t.key] = { ...merged[t.key], enabled: t.enabled, defaultChannels: { ...(merged[t.key]?.defaultChannels || { inApp: true }), email: t.email } };
        }
        await setDoc(doc(this.firestore, 'Settings', 'notification_types'), { types: merged }, { merge: true });
        this.toast.success('Notification types saved');
    }

    async saveMappings(): Promise<void> {
        const merged = { ...this.rawMappings };
        for (const m of this.mappings()) merged[m.key] = { ...merged[m.key], enabled: m.enabled };
        await setDoc(doc(this.firestore, 'Settings', 'event_mappings'), { mappings: merged }, { merge: true });
        this.toast.success('Event mappings saved');
    }
}
