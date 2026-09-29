import { describe, it, expect } from 'vitest';
import { arcInstall } from '../../../environments/arc-install';
import { arcConfig, DEFAULT_DATABASE_ID, installConfigFor, resolveArcConfig, withStoragePrefix } from './arc-config';
import { environment } from '../../../environments/environment';

describe('arc-config (frontend)', () => {
    describe('defaults: an empty arc-install.ts behaves as before CO2', () => {
        it('resolves to the (default) database, the firebaseConfig bucket and no prefix', () => {
            expect(resolveArcConfig(undefined)).toEqual({
                databaseId: '(default)',
                storageBucket: null,
                storagePrefix: '',
                adminOnlySignIn: false,
            });
            expect(resolveArcConfig({})).toEqual(resolveArcConfig(undefined));
            expect(DEFAULT_DATABASE_ID).toBe('(default)');
        });

        it("arcConfig is this build's project entry in arc-install.ts, resolved", () => {
            expect(arcConfig).toEqual(resolveArcConfig(installConfigFor(arcInstall, environment.firebaseConfig.projectId)));
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
            });
            expect(resolveArcConfig({ adminOnlySignIn: true }).adminOnlySignIn).toBe(true);
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
    });
});
