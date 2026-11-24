/**
 * The fresh code calls (docs/app/fresh-code.html): a refusal is in the member's language,
 * and can be said again in another (F52).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Functions } from '@angular/fire/functions';
import { MatDialog } from '@angular/material/dialog';
import { TranslocoService } from '@jsverse/transloco';

const { callable } = vi.hoisted(() => ({ callable: vi.fn() }));
vi.mock('@angular/fire/functions', () => ({ Functions: class {}, httpsCallable: vi.fn(() => callable) }));

import { FreshCodeService } from './fresh-code.service';
import { readSignInError } from '../../pages/(auth)/sign-in.service';

describe('FreshCodeService', () => {
    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                { provide: Functions, useValue: {} },
                { provide: MatDialog, useValue: {} },
            ],
        });
    });

    it('says a refusal in the page\'s language, its numbers kept, and again when the language changes (F52)', async () => {
        const transloco = TestBed.inject(TranslocoService);
        const words = (lang: string) => transloco.translate<string>('member.auth.server_error.wait', { wait: 40 }, lang);
        transloco.setActiveLang('hi');
        callable.mockImplementation(async () => {
            throw Object.assign(new Error('Please wait 40s'), { code: 'functions/resource-exhausted', details: { reason: 'wait', wait: 40 } });
        });
        const err = await TestBed.inject(FreshCodeService).request('change-email').catch((e: unknown) => e);
        expect((err as Error).message).toBe(words('hi'));
        const failed = readSignInError(err);
        transloco.setActiveLang('en');
        expect(failed.say()).toBe(words('en'));
        expect(words('en')).not.toBe(words('hi'));
    });
});
