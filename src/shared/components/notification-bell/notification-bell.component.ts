import { CommonModule } from '@angular/common';
import { Component, DestroyRef, Injector, computed, effect, inject, runInInjectionContext, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { Subscription } from 'rxjs';
import { NotificationService } from '../../services/notification.service';
import { INotification } from '../../services/notification.model';
import { AuthState } from '../../../app/pages/(auth)/auth.store';

/** Header bell: realtime unread badge + a dropdown of recent notifications. */
@Component({
    selector: 'arc-notification-bell',
    standalone: true,
    imports: [CommonModule, RouterModule, MatIconModule, MatBadgeModule, MatButtonModule, MatMenuModule],
    templateUrl: './notification-bell.component.html',
})
export class NotificationBellComponent {
    private service = inject(NotificationService);
    private authStore = inject(AuthState);
    private router = inject(Router);
    private destroyRef = inject(DestroyRef);
    private injector = inject(Injector);

    notifications = signal<INotification[]>([]);
    unreadCount = computed(() => this.notifications().filter((n) => !n.read).length);
    /** Badge label: exact count up to 9, then "9+" (we don't surface the real total). */
    badgeText = computed(() => (this.unreadCount() > 9 ? '9+' : String(this.unreadCount())));
    recent = computed(() => this.notifications().slice(0, 8));

    private sub: Subscription | null = null;

    constructor() {
        effect(() => {
            const uid = this.authStore.currentUser()?.uid;
            this.sub?.unsubscribe();
            if (uid) {
                this.sub = runInInjectionContext(this.injector, () => this.service.watch(uid))
                    .subscribe((n) => this.notifications.set(n));
            } else {
                this.notifications.set([]);
            }
        });
        this.destroyRef.onDestroy(() => this.sub?.unsubscribe());
    }

    async open(n: INotification): Promise<void> {
        if (!n.read) await this.service.markRead(n.id).catch(() => {});
        if (n.link) this.router.navigateByUrl(n.link);
    }

    async markAllRead(): Promise<void> {
        const uid = this.authStore.currentUser()?.uid;
        if (uid) await this.service.markAllRead(uid).catch(() => {});
    }

    viewAll(): void {
        this.router.navigate(['/notifications']);
    }
}
