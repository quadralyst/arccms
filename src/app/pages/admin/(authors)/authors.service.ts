/**
 * Authors Service
 *
 * CRUD for the `Authors` collection plus the default-author setting in
 * `Settings/discoverability` (docs/discoverability-spec.md, D2).
 */
import { Injectable, inject, runInInjectionContext } from '@angular/core';
import { collection, doc, getDoc, getDocs, limit, query, setDoc } from '@angular/fire/firestore';
import { Observable, firstValueFrom, map } from 'rxjs';
import { DbService } from '../../../../shared/services/db.service';
import { generateCommonFields } from '../../../../shared/models/base-model';
import { AuthState } from '../../(auth)/auth.store';
import { AboutSettingsService } from '../(settings)/about/about-settings.service';
import {
    DEFAULT_DISCOVERABILITY_SETTINGS,
    IAuthor,
    IAuthorData,
    IDiscoverabilitySettings,
    authorNameKey,
    normalizeAuthor,
} from '../../../../shared/models/author.model';
import { normalizeDiscoverabilitySettings } from '../../../../shared/models/discoverability.model';

@Injectable({ providedIn: 'root' })
export class AuthorsService extends DbService<IAuthor> {
    private authState = inject(AuthState);
    private aboutSettings = inject(AboutSettingsService);
    /** One seeding attempt per session; the result is shared by every caller. */
    private seeding: Promise<IAuthor | null> | null = null;

    constructor() {
        super('Authors');
    }

    /**
     * Smart default: a site with no authors yet gets its signed-in admin as
     * the first author and the default, so the first article carries a real
     * byline without anyone visiting Content → Authors. Idempotent: the
     * document id is derived from the admin's uid, so two tabs racing here
     * write the same document. Anything the admin edits later sticks, because
     * this only runs while the collection is empty.
     */
    ensureAdminAuthor(): Promise<IAuthor | null> {
        if (!this.seeding) {
            this.seeding = this.seedAdminAuthor().catch(error => {
                console.error('Could not seed the admin author:', error);
                return null;
            });
        }
        return this.seeding;
    }

    private async seedAdminAuthor(): Promise<IAuthor | null> {
        const user = this.authState.currentUser();
        if (!user?.uid || user.role !== 'admin') return null;

        const anyAuthor = await runInInjectionContext(this.injector, () =>
            getDocs(query(collection(this.firestore, 'Authors'), limit(1))),
        );
        if (!anyAuthor.empty) return null;

        const about = await this.aboutSettings.load().catch(() => null);
        const siteName = (about?.name || '').trim();
        const id = `admin-${user.uid}`;
        const data = normalizeAuthor({
            name: (user.name || '').trim() || (user.email || '').split('@')[0] || 'Admin',
            bio: siteName ? `Admin of ${siteName}.` : 'Site administrator.',
            photoUrl: user.photo || '',
        });
        const ref = runInInjectionContext(this.injector, () => doc(this.firestore, 'Authors', id));
        await setDoc(ref, { ...data, ...generateCommonFields(user.uid) });

        const settings = await this.loadSettings();
        if (!settings.defaultAuthorId) {
            await this.setDefaultAuthor(id);
        }
        return { ...data, id } as IAuthor;
    }

    /** Live, name-ordered list of every author. */
    list(): Observable<IAuthor[]> {
        return this.getAll({
            limitCount: 0,
            currentPageNumber: 0,
            previousPageNumber: 0,
            orderByField: 'name',
            orderByDirection: 'asc',
        }).pipe(map(result => result.collectionData));
    }

    create(input: Partial<IAuthorData>): Promise<string> {
        return firstValueFrom(this.add(normalizeAuthor(input)));
    }

    save(id: string, input: Partial<IAuthorData>): Promise<void> {
        return firstValueFrom(this.update(id, normalizeAuthor(input)));
    }

    remove(id: string): Promise<void> {
        return firstValueFrom(this.delete(id));
    }

    /**
     * The author with this display name, or a new one. Used by bulk import,
     * where a CSV column carries names rather than ids.
     */
    async findOrCreateByName(name: string, existing: IAuthor[]): Promise<IAuthor | null> {
        const key = authorNameKey(name);
        if (!key) return null;
        const found = existing.find(author => authorNameKey(author.name) === key);
        if (found) return found;
        const id = await this.create({ name: name.trim() });
        const created = { ...normalizeAuthor({ name: name.trim() }), id } as IAuthor;
        existing.push(created);
        return created;
    }

    async loadSettings(): Promise<IDiscoverabilitySettings> {
        try {
            const snap = await runInInjectionContext(this.injector, () =>
                getDoc(doc(this.firestore, 'Settings', 'discoverability')),
            );
            return normalizeDiscoverabilitySettings(snap.exists() ? snap.data() : null);
        } catch (error) {
            console.error('Error loading discoverability settings:', error);
            return { ...DEFAULT_DISCOVERABILITY_SETTINGS };
        }
    }

    async setDefaultAuthor(authorId: string): Promise<void> {
        const ref = runInInjectionContext(this.injector, () =>
            doc(this.firestore, 'Settings', 'discoverability'),
        );
        await setDoc(ref, { defaultAuthorId: authorId || '' }, { merge: true });
    }
}
