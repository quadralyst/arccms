import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Injector } from '@angular/core';

const call = vi.hoisted(() => vi.fn());
vi.mock('@angular/fire/functions', () => ({
    Functions: class {},
    httpsCallable: vi.fn((_functions: unknown, name: string) => (data: unknown) => call(name, data)),
}));

import { Functions } from '@angular/fire/functions';
import { AuthState } from '../../(auth)/auth.store';
import { moveProductCodesOnce, PRODUCT_CODES_MOVED_KEY, resetProductCodesUpkeep } from './product-codes-upkeep';

function memoryStorage(): Storage {
    const data = new Map<string, string>();
    return {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => void data.set(key, value),
        removeItem: (key: string) => void data.delete(key),
        clear: () => data.clear(),
        key: () => null,
        get length() { return data.size; },
    } as Storage;
}

const injectorFor = (role: string) => Injector.create({
    providers: [
        { provide: AuthState, useValue: { recordReady: async () => ({ role }) } },
        { provide: Functions, useValue: {} },
    ],
});

describe('moveProductCodesOnce (the admin shell)', () => {
    beforeEach(() => {
        call.mockReset().mockResolvedValue({ data: { moved: 1 } });
        resetProductCodesUpkeep();
    });

    it('asks the server to move the codes for an admin, once a session', async () => {
        const storage = memoryStorage();
        expect(await moveProductCodesOnce(injectorFor('admin'), storage)).toBe(true);
        expect(call).toHaveBeenCalledWith('arccms-moveProductCodes', {});
        expect(storage.getItem(PRODUCT_CODES_MOVED_KEY)).toBe('1');

        resetProductCodesUpkeep();
        expect(await moveProductCodesOnce(injectorFor('admin'), storage)).toBe(false);
        expect(call).toHaveBeenCalledTimes(1);
    });

    it('never asks for an editor', async () => {
        expect(await moveProductCodesOnce(injectorFor('editor'), memoryStorage())).toBe(false);
        expect(call).not.toHaveBeenCalled();
    });

    it('stays quiet when the call fails, and tries again on the next load', async () => {
        const storage = memoryStorage();
        call.mockRejectedValueOnce(new Error('offline'));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        expect(await moveProductCodesOnce(injectorFor('admin'), storage)).toBe(false);
        expect(storage.getItem(PRODUCT_CODES_MOVED_KEY)).toBeNull();
        expect(await moveProductCodesOnce(injectorFor('admin'), storage)).toBe(true);
        warn.mockRestore();
    });
});
