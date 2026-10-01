/**
 * Can phone sign-in sign people in on this project? The `checkPhoneSignIn` callable signs a
 * throwaway sign-in token as the functions do at the end of every phone sign-in, and when
 * the Google Cloud setup is missing, returns the fix (functions/src/auth/phoneSignInCheck.ts).
 */
import { inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
import { Functions } from '@angular/fire/functions';
import { arcCallable } from '../../../../core/config/arc-functions';

export interface PhoneSignInCheck {
    ready: boolean;
    smsProvider: 'log' | 'msg91';
    /** Set when not ready: what is missing, and how to fix it on this project. */
    problem?: 'token-creator-missing' | 'api-disabled';
    serviceAccount?: string;
    project?: string;
    command?: string;
    consoleUrl?: string;
}

@Injectable({ providedIn: 'root' })
export class PhoneSignInCheckService {
    private readonly functions = inject(Functions);
    private readonly injector = inject(Injector);

    /** Rejects when the check itself could not run (for example, the function is not deployed). */
    async check(): Promise<PhoneSignInCheck> {
        const result = await runInInjectionContext(this.injector, () => arcCallable(this.functions, 'checkPhoneSignIn')());
        return result.data as PhoneSignInCheck;
    }
}
