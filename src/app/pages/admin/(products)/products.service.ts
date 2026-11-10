import { Injectable, runInInjectionContext } from '@angular/core';
import { collection, deleteDoc, doc, getDocs, writeBatch } from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';
import { Observable } from 'rxjs';
import { DbService } from '../../../../shared/services/db.service';
import { arcCallable } from '../../../core/config/arc-functions';
import { AuthState } from '../../(auth)/auth.store';
import { IProduct, PRODUCT_CODES_COLLECTION, PRODUCTS_COLLECTION } from './product.model';

@Injectable({
    providedIn: 'root',
    useFactory: () => new ProductsService(),
    deps: [],
})
export class ProductsService extends DbService<IProduct> {
    constructor() {
        super(PRODUCTS_COLLECTION);
    }

    /**
     * The products on sale, for public pages. The rules let a visitor read a product
     * only while it is active, so a list for anyone but an admin must ask for
     * exactly those (firestore.rules, Products).
     */
    listActive(limitCount = 100): Observable<{ collectionData: IProduct[] }> {
        return this.getAll({
            whereConditions: [{ field: 'active', operator: '==', value: true }],
            limitCount,
            currentPageNumber: 0,
            previousPageNumber: 0,
        });
    }

    /** Every product's tier codes by product id (`ProductCodes`, admin only). */
    async loadCodes(): Promise<Record<string, string[]>> {
        const snap = await runInInjectionContext(this.injector, () => getDocs(collection(this.firestore, PRODUCT_CODES_COLLECTION)));
        const codes: Record<string, string[]> = {};
        for (const d of snap.docs) {
            const list = d.data()['discountCodes'];
            codes[d.id] = Array.isArray(list) ? list.map((code) => (typeof code === 'string' ? code : '')) : [];
        }
        return codes;
    }

    deleteCodes(productId: string): Promise<void> {
        return runInInjectionContext(this.injector, () => deleteDoc(doc(this.firestore, PRODUCT_CODES_COLLECTION, productId)));
    }

    /**
     * Save a product and its tier codes in one write, so neither is ever saved
     * without the other: a failed save leaves both as they were, and the codes always
     * line up with the tiers they belong to. `id` is the product's id, also for a new
     * product (newProductId()), so saving again after a failure never makes a second one.
     */
    async saveWithCodes(id: string, isNew: boolean, product: Partial<IProduct>, codes: string[]): Promise<void> {
        const now = new Date();
        // Firestore refuses an undefined field (a one-time product has no interval).
        const fields = Object.fromEntries(Object.entries(product).filter(([, value]) => value !== undefined));
        // Read here, not injected: the public pricing page uses this service too.
        const userId = this.injector.get(AuthState).currentUser()?.id || '';
        await runInInjectionContext(this.injector, () => {
            const batch = writeBatch(this.firestore);
            const productRef = doc(this.firestore, PRODUCTS_COLLECTION, id);
            if (isNew) {
                batch.set(productRef, { ...fields, id, purchaseCount: 0, createdAt: now, modifiedAt: now, createdBy: userId, modifiedBy: userId });
            } else {
                batch.update(productRef, { ...fields, modifiedAt: now, modifiedBy: userId });
            }
            batch.set(doc(this.firestore, PRODUCT_CODES_COLLECTION, id), { discountCodes: codes, updatedAt: now });
            return batch.commit();
        });
    }

    /** A fresh id for a product not saved yet. */
    newProductId(): string {
        return runInInjectionContext(this.injector, () => doc(collection(this.firestore, PRODUCTS_COLLECTION)).id);
    }

    /**
     * Move the tier codes older versions left on the public products into
     * ProductCodes, on the server (moveProductCodes, one transaction per product).
     * Returns how many products it changed.
     */
    async moveLegacyCodes(): Promise<number> {
        const result = await arcCallable<Record<string, never>, { moved?: number }>(this.injector.get(Functions), 'moveProductCodes')({});
        return result.data?.moved ?? 0;
    }
}
