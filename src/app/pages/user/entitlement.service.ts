import { computed, inject, Injectable, signal } from '@angular/core';
import { Observable, of, tap } from 'rxjs';
import { AuthState } from '../(auth)/auth.store';
import { MembershipService } from '../payments-ui/membership.service';
import { IUser } from '../admin/users/user.model';

/**
 * Reactive view of the signed-in user's entitlement, shared across the member
 * area. Reads the `users/{uid}` doc (the Cloud-Function-written premium/credit
 * fields) and exposes signals so pages, the sidebar, guards and the
 * `*appIfEntitled` directive all react to the same source of truth.
 */
@Injectable({ providedIn: 'root' })
export class EntitlementService {
    private membership = inject(MembershipService);
    private authState = inject(AuthState);

    private _entitlement = signal<IUser | null>(null);
    entitlement = this._entitlement.asReadonly();

    isPro = computed(() => this._entitlement()?.isPro === true);
    premiumType = computed(() => this._entitlement()?.premiumType ?? null);
    premiumStatus = computed(() => this._entitlement()?.premiumStatus ?? null);
    tierRank = computed(() => this._entitlement()?.premiumTierRank ?? -1);
    creditBalance = computed(() => this._entitlement()?.creditBalance ?? 0);

    /** True when the user holds a paid tier at or above `minRank`. */
    hasTier(minRank: number): boolean {
        return this.isPro() && this.tierRank() >= minRank;
    }

    /**
     * Load the entitlement for `uid` (defaults to the current user) and cache it
     * into the signals. Returns the loaded user doc (or null when signed out).
     */
    load(uid?: string): Observable<IUser | null> {
        const id = uid ?? this.authState.currentUser()?.uid;
        if (!id) {
            this._entitlement.set(null);
            return of(null);
        }
        return this.membership.getById(id).pipe(tap((user) => this._entitlement.set(user)));
    }
}
