/**
 * ArcStorage (F34): the bucket is opened, and Firebase Storage's code fetched, only when
 * something first uses it, and once.
 */
import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { arcStorage } = vi.hoisted(() => ({ arcStorage: vi.fn() }));
vi.mock('./arc-storage-bucket', () => ({ arcStorage }));

import { ArcStorage } from './arc-storage';

describe('ArcStorage', () => {
    it('opens the bucket on the first get, and gives the same one after', async () => {
        const bucket = { kind: 'bucket' };
        arcStorage.mockReset().mockReturnValue(bucket);
        const service = TestBed.inject(ArcStorage);
        expect(arcStorage).not.toHaveBeenCalled();
        expect(await service.get()).toBe(bucket);
        expect(await service.get()).toBe(bucket);
        expect(arcStorage).toHaveBeenCalledTimes(1);
    });

    it('tries again after a failed first try, such as a chunk that did not download', async () => {
        arcStorage.mockReset().mockImplementationOnce(() => { throw new Error('offline'); }).mockReturnValue({ kind: 'bucket' });
        const service = TestBed.inject(ArcStorage);
        await expect(service.get()).rejects.toThrow('offline');
        expect(await service.get()).toEqual({ kind: 'bucket' });
    });

    it('is the only way the app reaches Storage: the app config no longer provides it', () => {
        const config = readFileSync(resolve(__dirname, '../../app.config.ts'), 'utf8');
        expect(config).not.toContain('@angular/fire/storage');
        expect(readFileSync(resolve(__dirname, './arc-storage.ts'), 'utf8')).toContain("import type { FirebaseStorage } from '@angular/fire/storage';");
    });
});
