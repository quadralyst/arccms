/**
 * The store's auth listener ends with the store. On the server every render
 * builds its own store around one shared Auth, so a listener left behind kept
 * each rendered page, and in dev each old dev server, in memory.
 */
import { describe, it, expect, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Auth, onAuthStateChanged } from '@angular/fire/auth';

const stopListening = vi.fn();
vi.mock('@angular/fire/auth', () => ({ Auth: class {}, onAuthStateChanged: vi.fn(() => stopListening) }));

import { AuthState } from './auth.store';
import { AuthService } from './auth.service';
import { SignInService } from './sign-in.service';
import { ToastService } from '../../../shared/services/toast.service';

describe('AuthState auth listener', () => {
    it('starts with the store and stops when the store is destroyed', () => {
        TestBed.configureTestingModule({
            providers: [
                AuthState,
                { provide: AuthService, useValue: {} },
                { provide: ToastService, useValue: {} },
                { provide: Auth, useValue: {} },
                { provide: SignInService, useValue: {} },
                { provide: Router, useValue: { navigate: vi.fn() } },
            ],
        });
        TestBed.inject(AuthState);
        expect(onAuthStateChanged).toHaveBeenCalledTimes(1);
        expect(stopListening).not.toHaveBeenCalled();

        TestBed.resetTestingModule();
        expect(stopListening).toHaveBeenCalledTimes(1);
    });
});
