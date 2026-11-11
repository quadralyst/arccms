import { inject, Injectable, Injector, PLATFORM_ID, runInInjectionContext } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Firestore, doc, getDoc, setDoc, serverTimestamp } from '@angular/fire/firestore';
import { from, map, Observable, of, catchError, throwError } from 'rxjs';
import { IEmailBrandKit, DEFAULT_BRAND_KIT } from '../../../../shared/email-compiler/email-design.model';

const SETTINGS_COLLECTION = 'Settings';
const BRAND_DOC = 'email_brand';

/** Read/write the global email brand kit (Settings/email_brand, §3.2). */
@Injectable({ providedIn: 'root' })
export class BrandKitService {
    private firestore = inject(Firestore);
    private platformId = inject(PLATFORM_ID);
    private injector = inject(Injector);

    /**
     * The saved brand kit, or the default one when none is saved. A failed read also
     * gives the default, unless `surfaceErrors` is set: the Brand kit page needs to
     * know, or saving would replace the real kit with the default.
     */
    getBrandKit(opts: { surfaceErrors?: boolean } = {}): Observable<IEmailBrandKit> {
        // Reads require an authenticated admin (Firestore rules), which SSR never has:
        // skip the doomed request instead of letting it fail with permission-denied.
        if (!isPlatformBrowser(this.platformId)) {
            return of({ ...DEFAULT_BRAND_KIT });
        }
        return from(runInInjectionContext(this.injector, () => {
            const ref = doc(this.firestore, SETTINGS_COLLECTION, BRAND_DOC);
            return getDoc(ref);
        })).pipe(
            map((snap) => (snap.exists() ? { ...DEFAULT_BRAND_KIT, ...(snap.data() as IEmailBrandKit) } : { ...DEFAULT_BRAND_KIT })),
            catchError((err) => {
                console.error('Error fetching brand kit:', err);
                return opts.surfaceErrors ? throwError(() => err) : of({ ...DEFAULT_BRAND_KIT });
            }),
        );
    }

    async saveBrandKit(kit: IEmailBrandKit): Promise<void> {
        const ref = doc(this.firestore, SETTINGS_COLLECTION, BRAND_DOC);
        await setDoc(ref, { ...kit, updatedAt: serverTimestamp() }, { merge: true });
    }
}
