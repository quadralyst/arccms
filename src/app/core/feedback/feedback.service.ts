import { computed, inject, Injectable, Injector, PLATFORM_ID, runInInjectionContext, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Auth, onIdTokenChanged } from '@angular/fire/auth';
import { Firestore, collection, doc, getDoc, serverTimestamp, setDoc } from '@angular/fire/firestore';
import { Storage, ref, uploadBytes } from '@angular/fire/storage';
import { withStoragePrefix } from '../config/arc-config';
import { detectPlatform } from '../pwa/pwa-platform';
import { PwaService } from '../pwa/pwa.service';
import { captureScreen } from './screenshot';
import { audioExtension, type VoiceNote } from './voice-recorder';

export const FEEDBACK_COLLECTION = 'Feedback';
export const FEEDBACK_SETTINGS = 'feedback';
export const MAX_MESSAGE_LENGTH = 5000;

export interface FeedbackDraft {
    message: string;
    screenshot: Blob | null;
    voice: VoiceNote | null;
}

/**
 * What the page and device were, for the person reading the feedback. The
 * rules take these keys only, with these lengths (firestore.rules,
 * isFeedbackPage and isFeedbackDevice).
 */
export function describeContext(installed: boolean) {
    const { platform } = detectPlatform(navigator.userAgent, navigator.maxTouchPoints);
    const cut = (value: unknown, max: number) => String(value ?? '').slice(0, max);
    return {
        // The path only: a full address can carry codes or tokens in its query.
        page: { path: cut(location.pathname, 500), title: cut(document.title, 300) },
        device: {
            platform: cut(platform, 40),
            userAgent: cut(navigator.userAgent, 500),
            screen: `${screen.width}x${screen.height}`,
            viewport: `${window.innerWidth}x${window.innerHeight}`,
            installed,
            language: cut(navigator.language, 40),
        },
    };
}

/**
 * The feedback button (docs/features/feedback.html): whether it shows, the screenshot taken
 * as it is pressed, and sending. Signed-in people only; an admin turns it on
 * (Settings/feedback). Apps can open it from their own button with `openPanel()`.
 */
@Injectable({ providedIn: 'root' })
export class FeedbackService {
    private injector = inject(Injector);
    private browser = isPlatformBrowser(inject(PLATFORM_ID));
    private started = false;

    /** The admin turned the feedback button on. */
    readonly enabled = signal(false);
    /** The signed-in person's record (the `arccms_uid` claim), or null. */
    readonly userDocId = signal<string | null>(null);
    readonly available = computed(() => this.browser && this.enabled() && !!this.userDocId());

    readonly panelOpen = signal(false);
    readonly capturing = signal(false);
    readonly screenshot = signal<Blob | null>(null);
    private capture: Promise<void> = Promise.resolve();

    /** Called by the feedback button once, in the browser. */
    start(): void {
        if (!this.browser || this.started) return;
        this.started = true;
        let settingLoaded = false;
        runInInjectionContext(this.injector, () =>
            onIdTokenChanged(this.injector.get(Auth), async (user) => {
                const claims = user ? (await user.getIdTokenResult()).claims : {};
                const id = claims['arccms_uid'];
                this.userDocId.set(typeof id === 'string' && id ? id : null);
                // Only someone signed in can see the button: visitors cost no read.
                if (this.userDocId() && !settingLoaded) {
                    settingLoaded = true;
                    void this.loadSetting();
                }
            }),
        );
    }

    async loadSetting(): Promise<void> {
        try {
            const snap = await runInInjectionContext(this.injector, () =>
                getDoc(doc(this.injector.get(Firestore), 'Settings', FEEDBACK_SETTINGS)));
            this.enabled.set(snap.data()?.['enabled'] === true);
        } catch {
            this.enabled.set(false);
        }
    }

    /**
     * Opens the panel at once and takes the screenshot behind it (the panel is
     * left out of the picture), so nobody waits for it.
     */
    openPanel(): void {
        if (this.panelOpen()) return;
        this.screenshot.set(null);
        this.capturing.set(true);
        this.panelOpen.set(true);
        this.capture = captureScreen().then((shot) => {
            if (this.capturing()) this.screenshot.set(shot);
            this.capturing.set(false);
        });
    }

    /** Resolves once the screenshot is ready (or given up on). */
    screenshotReady(): Promise<void> {
        return this.capture;
    }

    /** Leave the screenshot out, even one still being taken. */
    removeScreenshot(): void {
        this.capturing.set(false);
        this.screenshot.set(null);
    }

    closePanel(): void {
        this.removeScreenshot();
        this.panelOpen.set(false);
    }

    /** Uploads the files to the sender's own folder, then saves the feedback. */
    async send(draft: FeedbackDraft): Promise<void> {
        const userDocId = this.userDocId();
        const auth = this.injector.get(Auth);
        const uid = auth.currentUser?.uid;
        if (!userDocId || !uid) throw new Error('Sign in to send feedback.');

        const firestore = this.injector.get(Firestore);
        const storage = this.injector.get(Storage);
        const run = <T>(fn: () => T) => runInInjectionContext(this.injector, fn);

        const item = run(() => doc(collection(firestore, FEEDBACK_COLLECTION)));
        const folder = withStoragePrefix(`users/${userDocId}/feedback/${item.id}/`);
        const files: Record<string, unknown> = {};

        if (draft.screenshot) {
            // The screenshot is extra: if it will not upload, the words still go.
            const path = `${folder}screenshot.jpg`;
            try {
                await run(() => uploadBytes(ref(storage, path), draft.screenshot!, { contentType: 'image/jpeg' }));
                files['screenshotPath'] = path;
            } catch (err) {
                console.warn('Feedback: sending without the screenshot.', err);
            }
        }
        if (draft.voice) {
            const path = `${folder}voice.${audioExtension(draft.voice.type)}`;
            await run(() => uploadBytes(ref(storage, path), draft.voice!.blob, { contentType: draft.voice!.type.split(';')[0] }));
            files['voicePath'] = path;
            files['voiceSeconds'] = draft.voice.seconds;
        }

        await run(() => setDoc(item, {
            uid,
            userDocId,
            message: draft.message.trim().slice(0, MAX_MESSAGE_LENGTH),
            ...files,
            ...describeContext(this.injector.get(PwaService).installed()),
            status: 'new',
            createdAt: serverTimestamp(),
        }));
    }
}
