import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { NotificationService } from '../../../shared/services/notification.service';
import { INotification } from '../../../shared/services/notification.model';
import { AuthState } from '../(auth)/auth.store';
import { ToastService } from '../../../shared/services/toast.service';

export const routeMeta: RouteMeta = {
    title: 'Notifications | Arc CMS',
};

interface PrefRow { key: string; label: string; description: string; email: boolean; }

@Component({
    standalone: true,
    imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule, MatSlideToggleModule],
    templateUrl: './notifications.page.html',
})
export default class NotificationsPageComponent implements OnInit {
    private service = inject(NotificationService);
    private authStore = inject(AuthState);
    private toast = inject(ToastService);
    private destroyRef = inject(DestroyRef);

    notifications = signal<INotification[]>([]);
    prefs = signal<PrefRow[]>([]);
    savingPrefs = signal(false);

    ngOnInit(): void {
        const uid = this.authStore.currentUser()?.uid;
        if (uid) {
            const sub = this.service.watch(uid, 100).subscribe((n) => this.notifications.set(n));
            this.destroyRef.onDestroy(() => sub.unsubscribe());
        }
        this.loadPrefs();
    }

    private async loadPrefs(): Promise<void> {
        try {
            const res = await this.service.getMyPrefs();
            const { types, prefs } = res.data;
            this.prefs.set(types.map((t) => ({ ...t, email: prefs[t.key]?.email !== false })));
        } catch (e) {
            console.error('Failed to load notification prefs', e);
        }
    }

    async open(n: INotification): Promise<void> {
        if (!n.read) await this.service.markRead(n.id).catch(() => {});
    }

    async markAllRead(): Promise<void> {
        const uid = this.authStore.currentUser()?.uid;
        if (uid) {
            await this.service.markAllRead(uid);
            this.toast.success('All notifications marked read');
        }
    }

    async savePrefs(): Promise<void> {
        this.savingPrefs.set(true);
        try {
            const payload: Record<string, { email: boolean }> = {};
            for (const p of this.prefs()) payload[p.key] = { email: p.email };
            await this.service.updatePrefs(payload);
            this.toast.success('Preferences saved');
        } catch (e) {
            console.error(e);
            this.toast.error('Failed to save preferences');
        } finally {
            this.savingPrefs.set(false);
        }
    }
}
