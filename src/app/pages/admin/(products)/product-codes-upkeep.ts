/**
 * Tier discount codes that older versions kept on the public Products documents
 * stay readable by anyone until they move to the admin-only ProductCodes. The
 * moveProductCodes function moves them; the admin calls it quietly once a session,
 * from the admin shell (admin.page.ts), so any admin visit after an update closes
 * the codes, not only a visit to Products.
 */
import { afterNextRender, inject, Injector } from '@angular/core';
import { Functions } from '@angular/fire/functions';
import { arcCallable } from '../../../core/config/arc-functions';
import { isOn } from '../../../core/features/features';
import { AuthState } from '../../(auth)/auth.store';

/** Set in sessionStorage once the codes were moved in this browser session. */
export const PRODUCT_CODES_MOVED_KEY = 'arc.productCodesMoved';

let startedThisLoad = false;

/** For the admin shell: move the codes once the page is drawn, once a session, admins only. */
export function useProductCodesUpkeep(): void {
    if (!isOn('payments')) return;
    const injector = inject(Injector);
    afterNextRender(() => void moveProductCodesOnce(injector));
}

function sessionStore(): Storage | null {
    try {
        return typeof sessionStorage === 'undefined' ? null : sessionStorage;
    } catch {
        return null;
    }
}

/**
 * Ask the server to move the codes, unless this session already did. Never throws
 * and never shows anything: a failure is logged and tried again on the next load.
 * True when it asked.
 */
export async function moveProductCodesOnce(injector: Injector, storage: Storage | null = sessionStore()): Promise<boolean> {
    try {
        if (startedThisLoad || storage?.getItem(PRODUCT_CODES_MOVED_KEY)) return false;
        const record = await injector.get(AuthState).recordReady();
        if (record?.role !== 'admin' || startedThisLoad) return false;
        startedThisLoad = true;
        await arcCallable(injector.get(Functions), 'moveProductCodes')({});
        storage?.setItem(PRODUCT_CODES_MOVED_KEY, '1');
        return true;
    } catch (error) {
        startedThisLoad = false;
        console.warn('Moving tier codes into ProductCodes failed; it is tried again on the next load.', error);
        return false;
    }
}

/** Tests only: forget this load's attempt. */
export function resetProductCodesUpkeep(): void {
    startedThisLoad = false;
}
