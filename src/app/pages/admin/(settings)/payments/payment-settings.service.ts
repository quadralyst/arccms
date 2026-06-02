import { inject, Injectable, Injector, PLATFORM_ID, runInInjectionContext } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
    Firestore, doc, getDoc, setDoc, serverTimestamp,
    collection, getDocs, query, where, addDoc, updateDoc,
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { from, map, Observable, of, catchError } from 'rxjs';
import { DEFAULT_DODO_PAYMENT_SETTINGS, IDodoPaymentSettings, MASKED_VALUE } from './payment-settings.model';
import {
    IEmailTemplate, PaymentEmailType,
    DEFAULT_PAYMENT_SUCCEEDED_TEMPLATE, DEFAULT_PAYMENT_FAILED_TEMPLATE,
    DEFAULT_SUBSCRIPTION_LIFECYCLE_TEMPLATE, DEFAULT_TRIAL_ENDING_TEMPLATE,
} from '../../(waitlists)/email-template.model';

const SETTINGS_COLLECTION = 'Settings';
const DODO_DOC = 'dodo-payments';
const EMAIL_TEMPLATE_COLLECTION = 'EmailTemplate';

/** The four payment email types with their default content and labels. */
export const PAYMENT_EMAIL_DEFINITIONS: { type: PaymentEmailType; label: string; subject: string; template: string }[] = [
    { type: 'payment_succeeded_email', label: 'Payment succeeded', subject: 'Your payment was successful', template: DEFAULT_PAYMENT_SUCCEEDED_TEMPLATE },
    { type: 'payment_failed_email', label: 'Payment / renewal failed', subject: 'Your payment failed', template: DEFAULT_PAYMENT_FAILED_TEMPLATE },
    { type: 'subscription_lifecycle_email', label: 'Subscription lifecycle', subject: 'An update to your subscription', template: DEFAULT_SUBSCRIPTION_LIFECYCLE_TEMPLATE },
    { type: 'trial_ending_email', label: 'Trial ending soon', subject: 'Your trial ends soon', template: DEFAULT_TRIAL_ENDING_TEMPLATE },
];

@Injectable({
    providedIn: 'root',
})
export class PaymentSettingsService {
    private firestore = inject(Firestore);
    private functions = inject(Functions);
    private injector = inject(Injector);
    private platformId = inject(PLATFORM_ID);

    private get isBrowser(): boolean {
        return isPlatformBrowser(this.platformId);
    }

    /** Run a Firebase call inside the Angular injection context (avoids AngularFire zone warnings). */
    private inCtx<T>(fn: () => Promise<T>): Promise<T> {
        return runInInjectionContext(this.injector, fn);
    }

    /** Fetch settings; secret fields are masked (never read back to the browser). */
    getSettings(): Observable<IDodoPaymentSettings> {
        // Admin-only doc — skip on the server (no auth context during SSR).
        if (!this.isBrowser) {
            return of({ ...DEFAULT_DODO_PAYMENT_SETTINGS });
        }
        const docRef = doc(this.firestore, SETTINGS_COLLECTION, DODO_DOC);
        return from(getDoc(docRef)).pipe(
            map((snapshot) => {
                if (!snapshot.exists()) {
                    return { ...DEFAULT_DODO_PAYMENT_SETTINGS };
                }
                const data = snapshot.data();
                return {
                    enabled: data['enabled'] ?? false,
                    mode: data['mode'] ?? 'test',
                    brandId: data['brandId'] ?? '',
                    successUrl: data['successUrl'] ?? '',
                    cancelUrl: data['cancelUrl'] ?? '',
                    // Only indicate whether a secret is set — never expose it.
                    testApiKey: data['testApiKey'] ? MASKED_VALUE : '',
                    liveApiKey: data['liveApiKey'] ? MASKED_VALUE : '',
                    webhookSecret: data['webhookSecret'] ? MASKED_VALUE : '',
                };
            }),
            catchError((error) => {
                console.error('Error fetching Dodo payment settings:', error);
                return of({ ...DEFAULT_DODO_PAYMENT_SETTINGS });
            }),
        );
    }

    /** Save settings, persisting secrets only when a non-masked value was entered. */
    async saveSettings(settings: IDodoPaymentSettings): Promise<void> {
        const docRef = doc(this.firestore, SETTINGS_COLLECTION, DODO_DOC);

        const dataToSave: Record<string, unknown> = {
            enabled: settings.enabled,
            mode: settings.mode,
            brandId: settings.brandId,
            successUrl: settings.successUrl,
            cancelUrl: settings.cancelUrl,
            updatedAt: serverTimestamp(),
        };

        this.setIfChanged(dataToSave, 'testApiKey', settings.testApiKey);
        this.setIfChanged(dataToSave, 'liveApiKey', settings.liveApiKey);
        this.setIfChanged(dataToSave, 'webhookSecret', settings.webhookSecret);

        const snapshot = await this.inCtx(() => getDoc(docRef));
        if (!snapshot.exists()) {
            dataToSave['createdAt'] = serverTimestamp();
        }

        await this.inCtx(() => setDoc(docRef, dataToSave, { merge: true }));
    }

    /** Ask the backend to validate the stored credentials. */
    async testConnection(): Promise<{ success: boolean; mode?: string; error?: string }> {
        const result = await this.inCtx(() => httpsCallable(this.functions, 'testDodoConnection')({}));
        return result.data as { success: boolean; mode?: string; error?: string };
    }

    private setIfChanged(target: Record<string, unknown>, key: string, value: string): void {
        if (value && value !== MASKED_VALUE) {
            target[key] = value;
        }
    }

    // ── Payment email templates (global scope) ──

    /** Load the saved payment email templates keyed by type. Resilient: returns {} on error/SSR. */
    async getPaymentTemplates(): Promise<Record<string, IEmailTemplate>> {
        if (!this.isBrowser) return {};
        try {
            const ref = collection(this.firestore, EMAIL_TEMPLATE_COLLECTION);
            const snap = await this.inCtx(() => getDocs(query(ref, where('scope', '==', 'payments'))));
            const result: Record<string, IEmailTemplate> = {};
            snap.forEach((d) => {
                const data = d.data() as IEmailTemplate;
                result[data.type] = { ...data, id: d.id };
            });
            return result;
        } catch (error) {
            console.error('Error fetching payment email templates:', error);
            return {};
        }
    }

    /** Create or update a payment email template. */
    async savePaymentTemplate(template: IEmailTemplate): Promise<void> {
        const payload = { ...template, scope: 'payments' as const, updatedAt: new Date() };

        if (template.id) {
            await this.inCtx(() => updateDoc(doc(this.firestore, EMAIL_TEMPLATE_COLLECTION, template.id!), { ...payload }));
        } else {
            await this.inCtx(() => addDoc(collection(this.firestore, EMAIL_TEMPLATE_COLLECTION), { ...payload, createdAt: new Date() }));
        }
    }
}
