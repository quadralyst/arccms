import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { NotificationService } from '../../../shared/services/notification.service';
import { INotification } from '../../../shared/services/notification.model';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { AuthState } from '../(auth)/auth.store';
import { ToastService } from '../../../shared/services/toast.service';
import { UserShellComponent } from '../user/user-shell.component';

export const routeMeta: RouteMeta = {
    title: 'Notifications | Arc CMS',
};

interface PrefRow { key: string; label: string; description: string; email: boolean; }

/**
 * Shared for two routes: /admin/notifications (nested under the admin shell,
 * which supplies the sidebar) and /notifications (top-level, for signed-in
 * members — self-wraps in the user shell here since there's no parent route
 * to supply one).
 */
@Component({
    standalone: true,
    imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule, MatSlideToggleModule, PageHeaderComponent, UserShellComponent],
    templateUrl: './notifications.page.html',
    styles: [`
        /* Mirrors the global .arc-admin .page-container so this page lines up with
           every other admin page. Repeated here (rather than relying on the global)
           because the same component also renders in the user shell, outside .arc-admin. */
        .page-container { padding: 24px; max-width: 1400px; margin: 0 auto; }

        .notif-list { background: #fff; border: 1px solid #e9ecef; border-radius: 8px; overflow: hidden; }
        .notif-row {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 16px;
            padding: 16px 20px;
            border-bottom: 1px solid #f1f3f5;
        }
        .notif-row:last-child { border-bottom: none; }
        .notif-row.unread { background: #f0f7ff; }
        .notif-main { min-width: 0; }
        .notif-title { font-weight: 500; color: #1a1a1a; margin-bottom: 2px; }
        .notif-row.unread .notif-title { font-weight: 600; }
        .notif-body-text { color: #6c757d; font-size: 14px; line-height: 1.4; }
        .notif-link { display: inline-block; margin-top: 6px; font-size: 14px; }
        .notif-empty { text-align: center; color: #868e96; padding: 48px 20px; }
    `],
})
export default class NotificationsPageComponent implements OnInit {
    private service = inject(NotificationService);
    protected authStore = inject(AuthState);
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
