/**
 * Tests for AuthorsService (docs/discoverability-spec.md, D2): the smart
 * default that seeds the admin as the first author, and default-author settings.
 */
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Firestore } from '@angular/fire/firestore';
import { AuthorsService } from './authors.service';
import { AuthState } from '../../(auth)/auth.store';
import { AboutSettingsService } from '../(settings)/about/about-settings.service';

vi.mock('@angular/fire/firestore', async () => {
    const actual = await vi.importActual<any>('@angular/fire/firestore');
    return {
        ...actual,
        collection: vi.fn(() => ({ path: 'Authors' })),
        doc: vi.fn((_db: unknown, col: string, id: string) => ({ path: `${col}/${id}` })),
        query: vi.fn((ref: unknown) => ref),
        limit: vi.fn(),
        getDocs: vi.fn(),
        getDoc: vi.fn(),
        setDoc: vi.fn(),
    };
});

import { getDocs, getDoc, setDoc } from '@angular/fire/firestore';

describe('AuthorsService', () => {
    let service: AuthorsService;
    let authState: { currentUser: ReturnType<typeof vi.fn> };
    let about: { load: ReturnType<typeof vi.fn> };

    const ADMIN = { uid: 'u1', name: 'Gunjan Karun', email: 'gunjan@example.com', role: 'admin', photo: 'https://x.com/me.jpg' };

    beforeEach(() => {
        authState = { currentUser: vi.fn().mockReturnValue(ADMIN) };
        about = { load: vi.fn().mockResolvedValue({ name: 'Arc CMS' }) };
        TestBed.configureTestingModule({
            providers: [
                AuthorsService,
                { provide: Firestore, useValue: {} },
                { provide: AuthState, useValue: authState },
                { provide: AboutSettingsService, useValue: about },
            ],
        });
        service = TestBed.inject(AuthorsService);
        vi.clearAllMocks();
        vi.mocked(getDoc).mockResolvedValue({ exists: () => false, data: () => ({}) } as any);
        vi.mocked(setDoc).mockResolvedValue(undefined);
    });

    describe('ensureAdminAuthor', () => {
        it('seeds the admin as the first author and makes them the default', async () => {
            vi.mocked(getDocs).mockResolvedValue({ empty: true } as any);

            const author = await service.ensureAdminAuthor();

            expect(author).toEqual(expect.objectContaining({
                id: 'admin-u1',
                name: 'Gunjan Karun',
                slug: 'gunjan-karun',
                bio: 'Admin of Arc CMS.',
                photoUrl: 'https://x.com/me.jpg',
            }));
            expect(setDoc).toHaveBeenCalledWith(
                { path: 'Authors/admin-u1' },
                expect.objectContaining({ name: 'Gunjan Karun', bio: 'Admin of Arc CMS.', createdBy: 'u1' }),
            );
            expect(setDoc).toHaveBeenCalledWith(
                { path: 'Settings/discoverability' },
                { defaultAuthorId: 'admin-u1' },
                { merge: true },
            );
        });

        it('does nothing when an author already exists', async () => {
            vi.mocked(getDocs).mockResolvedValue({ empty: false } as any);
            expect(await service.ensureAdminAuthor()).toBeNull();
            expect(setDoc).not.toHaveBeenCalled();
        });

        it('does nothing for a non-admin or a signed-out visitor', async () => {
            authState.currentUser.mockReturnValue({ ...ADMIN, role: 'user' });
            expect(await service.ensureAdminAuthor()).toBeNull();
            expect(getDocs).not.toHaveBeenCalled();
        });

        it('falls back to the email local part and a generic bio', async () => {
            authState.currentUser.mockReturnValue({ uid: 'u2', email: 'jane@x.com', role: 'admin', name: '' });
            about.load.mockResolvedValue({ name: '' });
            vi.mocked(getDocs).mockResolvedValue({ empty: true } as any);

            const author = await service.ensureAdminAuthor();

            expect(author?.name).toBe('jane');
            expect(author?.bio).toBe('Site administrator.');
        });

        it('keeps an existing default author', async () => {
            vi.mocked(getDocs).mockResolvedValue({ empty: true } as any);
            vi.mocked(getDoc).mockResolvedValue({ exists: () => true, data: () => ({ defaultAuthorId: 'other' }) } as any);

            await service.ensureAdminAuthor();

            expect(setDoc).toHaveBeenCalledTimes(1);
            expect(setDoc).not.toHaveBeenCalledWith({ path: 'Settings/discoverability' }, expect.anything(), expect.anything());
        });

        it('runs once per session and swallows failures', async () => {
            vi.mocked(getDocs).mockRejectedValue(new Error('down'));
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
            expect(await service.ensureAdminAuthor()).toBeNull();
            expect(await service.ensureAdminAuthor()).toBeNull();
            expect(getDocs).toHaveBeenCalledTimes(1);
            errorSpy.mockRestore();
        });
    });

    describe('settings', () => {
        it('loadSettings returns the stored default author id or empty', async () => {
            expect((await service.loadSettings()).defaultAuthorId).toBe('');
            vi.mocked(getDoc).mockResolvedValue({ exists: () => true, data: () => ({ defaultAuthorId: 'a1' }) } as any);
            expect((await service.loadSettings()).defaultAuthorId).toBe('a1');
        });

        it('setDefaultAuthor merges into Settings/discoverability', async () => {
            await service.setDefaultAuthor('a9');
            expect(setDoc).toHaveBeenCalledWith({ path: 'Settings/discoverability' }, { defaultAuthorId: 'a9' }, { merge: true });
        });
    });
});
