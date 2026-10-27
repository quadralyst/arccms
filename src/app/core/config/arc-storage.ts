/**
 * The install's Storage bucket, loaded the first time something uses it (F34). Firebase
 * Storage is not in the first script every page loads: a visitor who never uploads or
 * opens a file never downloads it.
 *
 *     private readonly arcStorage = inject(ArcStorage);
 *     const storage = await this.arcStorage.get();
 *     await uploadBytes(ref(storage, path), file);
 *
 * Use this in place of AngularFire's `Storage`, which the app no longer provides.
 */
import { Injectable, Injector, inject } from '@angular/core';
import type { FirebaseStorage } from '@angular/fire/storage';

@Injectable({ providedIn: 'root' })
export class ArcStorage {
    private readonly injector = inject(Injector);
    private bucket: Promise<FirebaseStorage> | null = null;

    /** The bucket; the first call fetches Firebase Storage's code. A failed fetch is tried again next time. */
    get(): Promise<FirebaseStorage> {
        this.bucket ??= import('./arc-storage-bucket').then((m) => m.arcStorage(this.injector)).catch((error) => {
            this.bucket = null;
            throw error;
        });
        return this.bucket;
    }
}
