import { describe, it, expect } from 'vitest';
import { arcInstall } from '../../../environments/arc-install';
import { arcConfig, DEFAULT_DATABASE_ID, resolveArcConfig, withStoragePrefix } from './arc-config';

describe('arc-config (frontend)', () => {
    describe('defaults: an empty arc-install.ts behaves as before CO2', () => {
        it('resolves to the (default) database, the firebaseConfig bucket and no prefix', () => {
            expect(resolveArcConfig(undefined)).toEqual({
                databaseId: '(default)',
                storageBucket: null,
                storagePrefix: '',
            });
            expect(resolveArcConfig({})).toEqual(resolveArcConfig(undefined));
            expect(DEFAULT_DATABASE_ID).toBe('(default)');
        });

        it('arcConfig is arc-install.ts resolved (empty when committed, set by arc:configure)', () => {
            expect(arcConfig).toEqual(resolveArcConfig(arcInstall));
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
            });
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
});
