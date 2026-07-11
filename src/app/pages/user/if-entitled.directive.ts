import { Directive, effect, inject, Input, signal, TemplateRef, ViewContainerRef } from '@angular/core';
import { EntitlementService } from './entitlement.service';

/**
 * Structural directive that renders its content only when the signed-in user has
 * a paid entitlement — optionally at or above a minimum tier rank.
 *
 *   <div *appIfEntitled>Members-only content</div>
 *   <div *appIfEntitled="2">Gold-and-above content</div>
 *
 * Reactive: it shows/hides automatically as the entitlement signals change (e.g.
 * after a purchase is confirmed).
 */
@Directive({ selector: '[appIfEntitled]', standalone: true })
export class IfEntitledDirective {
    private entitlements = inject(EntitlementService);
    private templateRef = inject(TemplateRef<unknown>);
    private viewContainer = inject(ViewContainerRef);

    private minTier = signal(0);
    private visible = false;

    @Input() set appIfEntitled(value: number | string | '') {
        this.minTier.set(typeof value === 'number' ? value : Number(value) || 0);
    }

    constructor() {
        effect(() => {
            const allowed = this.entitlements.isPro() && this.entitlements.tierRank() >= this.minTier();
            if (allowed && !this.visible) {
                this.viewContainer.createEmbeddedView(this.templateRef);
                this.visible = true;
            } else if (!allowed && this.visible) {
                this.viewContainer.clear();
                this.visible = false;
            }
        });
    }
}
