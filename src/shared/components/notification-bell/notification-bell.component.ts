import { CommonModule } from '@angular/common';
import { Component, DestroyRef, Injector, TemplateRef, ViewChild, ViewContainerRef, computed, effect, inject, runInInjectionContext, signal } from '@angular/core';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { Subscription } from 'rxjs';
import { NotificationService } from '../../services/notification.service';
import { INotification } from '../../services/notification.model';
import { AuthState } from '../../../app/pages/(auth)/auth.store';

/**
 * Header bell: realtime unread badge + a full-height panel of recent notifications.
 *
 * The panel goes through the CDK Overlay rather than being rendered inline.
 * `.mat-drawer-container` sets `position: relative; z-index: 1`, creating a stacking
 * context — anything rendered inside `.mat-drawer-content` (z-index 1) can never paint
 * above a sibling `.mat-drawer` (z-index 2), whatever z-index it asks for. That applies
 * to the pages' own right-side edit drawers too, which the panel shares an edge with.
 * The overlay attaches to document.body, escaping that context.
 */
@Component({
    selector: 'arc-notification-bell',
    standalone: true,
    imports: [CommonModule, MatIconModule, MatBadgeModule, MatButtonModule],
    templateUrl: './notification-bell.component.html',
    styleUrl: './notification-bell.component.scss',
})
export class NotificationBellComponent {
    private service = inject(NotificationService);
    private authStore = inject(AuthState);
    private router = inject(Router);
    private destroyRef = inject(DestroyRef);
    private injector = inject(Injector);
    private overlay = inject(Overlay);
    private vcr = inject(ViewContainerRef);

    @ViewChild('panelTpl') panelTpl!: TemplateRef<unknown>;

    notifications = signal<INotification[]>([]);
    unreadCount = computed(() => this.notifications().filter((n) => !n.read).length);
    /** Badge label: exact count up to 9, then "9+" (we don't surface the real total). */
    badgeText = computed(() => (this.unreadCount() > 9 ? '9+' : String(this.unreadCount())));
    /** Panel shows the 10 most recent; older ones live on the full notification list page. */
    recent = computed(() => this.notifications().slice(0, 10));

    private overlayRef: OverlayRef | null = null;
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
        this.destroyRef.onDestroy(() => {
            this.sub?.unsubscribe();
            this.overlayRef?.dispose();
        });
    }

    togglePanel(): void {
        if (this.overlayRef) {
            this.closePanel();
            return;
        }

        this.overlayRef = this.overlay.create({
            positionStrategy: this.overlay.position().global().right('0').top('0'),
            height: '100%',
            width: '400px',
            maxWidth: '90vw',
            hasBackdrop: true,
            backdropClass: 'cdk-overlay-dark-backdrop',
        });
        this.overlayRef.backdropClick().subscribe(() => this.closePanel());
        this.overlayRef.keydownEvents().subscribe((e) => {
            if (e.key === 'Escape') this.closePanel();
        });
        this.overlayRef.attach(new TemplatePortal(this.panelTpl, this.vcr));
    }

    closePanel(): void {
        this.overlayRef?.dispose();
        this.overlayRef = null;
    }

    async open(n: INotification): Promise<void> {
        if (!n.read) await this.service.markRead(n.id).catch(() => {});
        this.closePanel();
        if (n.link) this.router.navigateByUrl(n.link);
    }

    async markAllRead(): Promise<void> {
        const uid = this.authStore.currentUser()?.uid;
        if (uid) await this.service.markAllRead(uid).catch(() => {});
    }

    viewAll(): void {
        this.closePanel();
        this.router.navigate([this.authStore.isAdmin() ? '/admin/notifications' : '/notifications']);
    }
}
