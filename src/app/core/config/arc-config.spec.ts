import { describe, it, expect } from 'vitest';
import { arcInstall } from '../../../environments/arc-install';
import { arcConfig, DEFAULT_DATABASE_ID, installConfigFor, installEntryFor, resolveArcConfig, withStoragePrefix } from './arc-config';
import { environment } from '../../../environments/environment';

describe('arc-config (frontend)', () => {
    describe('defaults: an empty arc-install.ts behaves as before CO2', () => {
        it('resolves to the (default) database, the firebaseConfig bucket and no prefix', () => {
            expect(resolveArcConfig(undefined)).toEqual({
                databaseId: '(default)',
                storageBucket: null,
                storagePrefix: '',
                adminOnlySignIn: false,
                functionsRegion: 'us-central1',
                hostingSite: '',
                offlineCache: 'off',
                analyticsConsent: 'always',
            });
            expect(resolveArcConfig({})).toEqual(resolveArcConfig(undefined));
            expect(DEFAULT_DATABASE_ID).toBe('(default)');
        });

        it("arcConfig is this build's project entry in arc-install.ts, resolved", () => {
            expect(arcConfig).toEqual(resolveArcConfig(installEntryFor(arcInstall, environment)));
        });

        it('leaves upload paths untouched', () => {
            expect(withStoragePrefix('mediaImages/a.webp', '')).toBe('mediaImages/a.webp');
        });
    });

    describe('configured', () => {
        it('normalises the values', () => {
            expect(resolveArcConfig({
                databaseId: ' arccms ',
                storageBucket: 'gs://acme-arccms/',
                storagePrefix: '/arccms',
            })).toEqual({
                databaseId: 'arccms',
                storageBucket: 'acme-arccms',
                storagePrefix: 'arccms/',
                adminOnlySignIn: false,
                functionsRegion: 'us-central1',
                hostingSite: '',
                offlineCache: 'off',
                analyticsConsent: 'always',
            });
            expect(resolveArcConfig({ adminOnlySignIn: true }).adminOnlySignIn).toBe(true);
            expect(resolveArcConfig({ functionsRegion: ' asia-south1 ' }).functionsRegion).toBe('asia-south1');
            expect(resolveArcConfig({ hostingSite: ' acme-arccms ' }).hostingSite).toBe('acme-arccms');
        });

        it('waits for consent only when the install says required (docs/features/analytics.html)', () => {
            expect(resolveArcConfig({ analyticsConsent: 'required' }).analyticsConsent).toBe('required');
            expect(resolveArcConfig({ analyticsConsent: 'always' }).analyticsConsent).toBe('always');
            expect(resolveArcConfig({ analyticsConsent: 'Required' as never }).analyticsConsent).toBe('always');
            expect(resolveArcConfig({}).analyticsConsent).toBe('always');
        });

        it('turns the offline cache on only for a known mode (docs/app/offline.html)', () => {
            expect(resolveArcConfig({ offlineCache: 'single-tab' }).offlineCache).toBe('single-tab');
            expect(resolveArcConfig({ offlineCache: 'multi-tab' }).offlineCache).toBe('multi-tab');
            expect(resolveArcConfig({ offlineCache: 'off' }).offlineCache).toBe('off');
            // A typo never half-enables a cache.
            expect(resolveArcConfig({ offlineCache: 'multitab' as never }).offlineCache).toBe('off');
            expect(resolveArcConfig({}).offlineCache).toBe('off');
        });

        it('treats blank values as unset', () => {
            expect(resolveArcConfig({ databaseId: ' ', storageBucket: '', storagePrefix: ' ' }))
                .toEqual(resolveArcConfig(undefined));
        });

        it('prefixes new upload paths once', () => {
            expect(withStoragePrefix('mediaImages/a.webp', 'arccms/')).toBe('arccms/mediaImages/a.webp');
            expect(withStoragePrefix('/mediaImages/a.webp', 'arccms/')).toBe('arccms/mediaImages/a.webp');
            expect(withStoragePrefix('arccms/mediaImages/a.webp', 'arccms/')).toBe('arccms/mediaImages/a.webp');
        });
    });

    describe('installConfigFor (CO3.2)', () => {
        const file = { 'acme-prod': { databaseId: 'arccms' }, 'acme-dev': { storagePrefix: 'dev/' } };

        it("picks the build's own project", () => {
            expect(installConfigFor(file, 'acme-prod')).toEqual({ databaseId: 'arccms' });
            expect(installConfigFor(file, 'acme-dev')).toEqual({ storagePrefix: 'dev/' });
        });

        it('gives a project with no entry the defaults', () => {
            expect(resolveArcConfig(installConfigFor(file, 'someone-else'))).toEqual(resolveArcConfig(undefined));
            expect(installConfigFor({}, 'acme-prod')).toBeUndefined();
        });

        it('still reads a single-entry file written before CO3.2, for every project', () => {
            expect(installConfigFor({ databaseId: 'arccms' }, 'anything')).toEqual({ databaseId: 'arccms' });
        });

        it('takes the entry a generated web settings file carries when arc-install.ts has none, as in Arc CMS itself', () => {
            const env = { firebaseConfig: { projectId: 'acme-dev' }, arcInstall: { databaseId: 'arccms', storagePrefix: 'arccms/' } };
            expect(installEntryFor({}, env)).toEqual({ databaseId: 'arccms', storagePrefix: 'arccms/' });
            expect(installEntryFor({ 'acme-dev': { databaseId: 'other' } }, env)).toEqual({ databaseId: 'other' });
            expect(installEntryFor({}, { firebaseConfig: { projectId: 'acme-dev' } })).toBeUndefined();
        });
    });
});
