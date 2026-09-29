import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, NavigationEnd, Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { filter } from 'rxjs';
import { FeedbackService, MAX_MESSAGE_LENGTH } from '../../../app/core/feedback/feedback.service';
import { canRecordVoice, MAX_VOICE_SECONDS, VoiceRecorder, type VoiceNote } from '../../../app/core/feedback/voice-recorder';

type Stage = 'compose' | 'sending' | 'sent';

/** Whether any route on the way to this page says `data: { feedbackButton: false }`. */
export function routeHidesFeedback(snapshot: ActivatedRouteSnapshot | null): boolean {
    for (let node = snapshot; node; node = node.firstChild) {
        if (node.data?.['feedbackButton'] === false) return true;
    }
    return false;
}

/** m:ss */
export function clock(seconds: number): string {
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * The feedback button and its panel (docs/feedback.md), placed once in the app
 * root. The button shows to signed-in people when an admin turned it on, except
 * on admin pages and pages that hide it (`data: { feedbackButton: false }`).
 * The panel opens from the button, or from an app's own button through
 * FeedbackService.openPanel().
 */
@Component({
    selector: 'arc-feedback',
    standalone: true,
    imports: [TranslocoPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { 'data-feedback-ignore': '' },
    template: `
        @if (showButton()) {
            <button type="button" class="fb-button" (click)="feedback.openPanel()"
                [attr.aria-label]="'common.feedback.title' | transloco">
                <i class="fa-solid fa-comment-dots" aria-hidden="true"></i>
                <span class="fb-button-label">{{ 'common.feedback.button' | transloco }}</span>
            </button>
        }

        @if (feedback.panelOpen()) {
            <div class="fb-backdrop" (click)="close()"></div>
            <section class="fb-panel" role="dialog" aria-modal="true" [attr.aria-label]="'common.feedback.title' | transloco">
                <header class="fb-head">
                    <h2>{{ 'common.feedback.title' | transloco }}</h2>
                    <button type="button" class="btn-close" [attr.aria-label]="'common.actions.close' | transloco" (click)="close()"></button>
                </header>

                @if (stage() === 'sent') {
                    <p class="fb-thanks"><i class="fa-solid fa-circle-check"></i> {{ 'common.feedback.thanks' | transloco }}</p>
                } @else {
                    <textarea class="form-control" rows="4" [maxLength]="maxLength"
                        [placeholder]="'common.feedback.placeholder' | transloco"
                        [value]="message()" (input)="message.set($any($event.target).value)"
                        [disabled]="stage() === 'sending'"></textarea>

                    @if (voiceSupported) {
                        <div class="fb-voice">
                            @if (voice(); as note) {
                                <audio controls [src]="voiceUrl()"></audio>
                                <button type="button" class="btn btn-link btn-sm text-danger" (click)="deleteVoice()"
                                    [disabled]="stage() === 'sending'" [attr.aria-label]="'common.feedback.delete_voice' | transloco">
                                    <i class="fa-solid fa-trash-can"></i>
                                </button>
                            } @else if (recording()) {
                                <span class="fb-rec-dot" aria-hidden="true"></span>
                                <span class="fb-rec-time">{{ clock(elapsed()) }} / {{ clock(maxVoice) }}</span>
                                <button type="button" class="btn btn-outline-danger btn-sm" (click)="stopRecording()">
                                    <i class="fa-solid fa-stop"></i> {{ 'common.feedback.stop' | transloco }}
                                </button>
                            } @else {
                                <button type="button" class="btn btn-outline-secondary btn-sm" (click)="startRecording()"
                                    [disabled]="stage() === 'sending' || startingMic()">
                                    <i class="fa-solid fa-microphone"></i> {{ 'common.feedback.record' | transloco }}
                                </button>
                            }
                        </div>
                        @if (micBlocked()) {
                            <p class="fb-note text-danger">{{ 'common.feedback.mic_blocked' | transloco }}</p>
                        }
                    }

                    @if (feedback.capturing()) {
                        <div class="fb-shot">
                            <span class="fb-shot-wait"><span class="spinner-border spinner-border-sm" aria-hidden="true"></span></span>
                            <div>
                                <span>{{ 'common.feedback.taking_screenshot' | transloco }}</span>
                                <button type="button" class="btn btn-link btn-sm p-0" (click)="removeScreenshot()">
                                    {{ 'common.feedback.remove_screenshot' | transloco }}</button>
                            </div>
                        </div>
                    } @else if (screenshotUrl(); as url) {
                        <div class="fb-shot">
                            <img [src]="url" [alt]="'common.feedback.screenshot' | transloco" />
                            <div>
                                <span>{{ 'common.feedback.screenshot' | transloco }}</span>
                                <button type="button" class="btn btn-link btn-sm p-0" (click)="removeScreenshot()"
                                    [disabled]="stage() === 'sending'">{{ 'common.feedback.remove_screenshot' | transloco }}</button>
                            </div>
                        </div>
                    }

                    @if (error()) {
                        <p class="fb-note text-danger">{{ error() | transloco }}</p>
                    }

                    <footer class="fb-actions">
                        <button type="button" class="btn btn-link" (click)="close()">{{ 'common.actions.cancel' | transloco }}</button>
                        <button type="button" class="btn btn-primary" (click)="send()" [disabled]="!canSend()">
                            {{ (stage() === 'sending' ? 'common.feedback.sending' : 'common.feedback.send') | transloco }}
                        </button>
                    </footer>
                }
            </section>
        }
    `,
    styles: [`
        .fb-button {
            position: fixed;
            right: 1rem;
            bottom: max(1rem, env(safe-area-inset-bottom));
            z-index: 1070;
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.5rem 0.875rem;
            border: 0;
            border-radius: 999px;
            background: #1f2937;
            color: #fff;
            font-size: 0.875rem;
            box-shadow: 0 6px 18px rgba(0, 0, 0, 0.2);
        }
        .fb-button:disabled { opacity: 0.8; }
        @media (max-width: 575px) {
            .fb-button { padding: 0.625rem 0.75rem; }
            .fb-button-label { display: none; }
        }
        .fb-backdrop {
            position: fixed;
            inset: 0;
            z-index: 1090;
            background: rgba(0, 0, 0, 0.35);
        }
        .fb-panel {
            position: fixed;
            z-index: 1091;
            right: 1rem;
            bottom: 1rem;
            width: min(420px, calc(100vw - 2rem));
            max-height: calc(100vh - 2rem);
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
            padding: 1rem 1.25rem;
            border-radius: 14px;
            background: var(--bs-body-bg, #fff);
            color: var(--bs-body-color, #212529);
            box-shadow: 0 16px 40px rgba(0, 0, 0, 0.25);
        }
        @media (max-width: 575px) {
            .fb-panel {
                left: 0;
                right: 0;
                bottom: 0;
                width: 100%;
                border-radius: 16px 16px 0 0;
                padding-bottom: max(1rem, env(safe-area-inset-bottom));
            }
        }
        .fb-head { display: flex; align-items: center; justify-content: space-between; }
        .fb-head h2 { font-size: 1.05rem; font-weight: 600; margin: 0; }
        .fb-voice { display: flex; align-items: center; gap: 0.5rem; min-height: 2.25rem; }
        .fb-voice audio { flex: 1 1 auto; min-width: 0; height: 2.25rem; }
        .fb-rec-dot { width: 0.625rem; height: 0.625rem; border-radius: 50%; background: #dc3545; animation: fb-pulse 1s infinite; }
        .fb-rec-time { font-variant-numeric: tabular-nums; font-size: 0.875rem; }
        @keyframes fb-pulse { 50% { opacity: 0.3; } }
        .fb-shot { display: flex; gap: 0.75rem; align-items: center; font-size: 0.85rem; }
        .fb-shot-wait { width: 88px; height: 64px; display: grid; place-items: center; border: 1px dashed var(--bs-border-color, #dee2e6); border-radius: 6px; }
        .fb-shot img { width: 88px; max-height: 120px; object-fit: cover; object-position: top; border: 1px solid var(--bs-border-color, #dee2e6); border-radius: 6px; }
        .fb-shot div { display: flex; flex-direction: column; align-items: flex-start; gap: 0.125rem; color: var(--bs-secondary-color, #6c757d); }
        .fb-note { font-size: 0.85rem; margin: 0; }
        .fb-thanks { margin: 0.5rem 0 0.75rem; font-size: 0.95rem; }
        .fb-thanks i { color: #198754; margin-right: 0.375rem; }
        .fb-actions { display: flex; justify-content: flex-end; gap: 0.5rem; }
    `],
})
export class FeedbackComponent {
    readonly feedback = inject(FeedbackService);
    private router = inject(Router);

    readonly maxLength = MAX_MESSAGE_LENGTH;
    readonly maxVoice = MAX_VOICE_SECONDS;
    readonly voiceSupported = canRecordVoice();
    readonly clock = clock;

    private readonly hiddenHere = signal(false);
    readonly showButton = computed(() => this.feedback.available() && !this.hiddenHere());

    readonly stage = signal<Stage>('compose');
    readonly message = signal('');
    readonly voice = signal<VoiceNote | null>(null);
    readonly recording = signal(false);
    /** Waiting for the microphone (the permission prompt): the Record button waits too. */
    readonly startingMic = signal(false);
    readonly elapsed = signal(0);
    readonly micBlocked = signal(false);
    readonly error = signal('');

    readonly screenshotUrl = signal<string | null>(null);
    readonly voiceUrl = signal<string | null>(null);
    readonly canSend = computed(() =>
        this.stage() === 'compose' && !this.recording() && (this.message().trim().length > 0 || !!this.voice()));

    private recorder: VoiceRecorder | null = null;
    /** The recorder whose microphone is still starting; cleared when the panel closes. */
    private starting: VoiceRecorder | null = null;
    private ticker: ReturnType<typeof setInterval> | null = null;
    private closeTimer: ReturnType<typeof setTimeout> | null = null;

    constructor() {
        this.feedback.start();
        this.router.events.pipe(filter((e) => e instanceof NavigationEnd), takeUntilDestroyed()).subscribe(() => {
            this.hiddenHere.set(
                this.router.url.startsWith('/admin') || routeHidesFeedback(this.router.routerState.snapshot.root),
            );
        });
        // A preview of the screenshot, freed when it changes.
        effect((onCleanup) => {
            const shot = this.feedback.screenshot();
            const url = shot ? URL.createObjectURL(shot) : null;
            this.screenshotUrl.set(url);
            onCleanup(() => url && URL.revokeObjectURL(url));
        });
        effect((onCleanup) => {
            const note = this.voice();
            const url = note ? URL.createObjectURL(note.blob) : null;
            this.voiceUrl.set(url);
            onCleanup(() => url && URL.revokeObjectURL(url));
        });
        inject(DestroyRef).onDestroy(() => this.reset());
    }

    /**
     * Start a voice note. The microphone can take a while (the permission
     * prompt), so a second press waits, and if the panel closed in the meantime
     * the microphone is released as soon as it starts (review F): it used to
     * record, unseen, for up to the time limit.
     */
    async startRecording(): Promise<void> {
        if (this.recorder || this.starting) return;
        this.micBlocked.set(false);
        const recorder = new VoiceRecorder();
        recorder.onLimit = (note) => this.recorded(note);
        this.starting = recorder;
        this.startingMic.set(true);
        try {
            await recorder.start();
        } catch {
            if (this.starting === recorder) {
                this.starting = null;
                this.startingMic.set(false);
                this.micBlocked.set(true);
            }
            return;
        }
        if (this.starting !== recorder) {
            recorder.cancel();
            return;
        }
        this.starting = null;
        this.startingMic.set(false);
        this.recorder = recorder;
        this.recording.set(true);
        this.elapsed.set(0);
        this.ticker = setInterval(() => this.elapsed.set(recorder.elapsed()), 250);
    }

    async stopRecording(): Promise<void> {
        this.recorded(await this.recorder?.stop() ?? null);
    }

    deleteVoice(): void {
        this.voice.set(null);
    }

    removeScreenshot(): void {
        this.feedback.removeScreenshot();
    }

    async send(): Promise<void> {
        if (!this.canSend()) return;
        this.stage.set('sending');
        this.error.set('');
        try {
            await this.feedback.screenshotReady(); // a second or two at most
            await this.feedback.send({ message: this.message(), screenshot: this.feedback.screenshot(), voice: this.voice() });
            this.stage.set('sent');
            this.closeTimer = setTimeout(() => this.close(), 2500);
        } catch (err) {
            console.error('Feedback: could not send.', err);
            this.error.set('common.feedback.send_failed');
            this.stage.set('compose');
        }
    }

    close(): void {
        if (this.stage() === 'sending') return;
        this.reset();
        this.feedback.closePanel();
    }

    private recorded(note: VoiceNote | null): void {
        if (this.ticker) clearInterval(this.ticker);
        this.ticker = null;
        this.recorder = null;
        this.recording.set(false);
        if (note) this.voice.set(note);
    }

    private reset(): void {
        this.recorder?.cancel();
        this.recorder = null;
        this.starting = null;
        this.startingMic.set(false);
        if (this.ticker) clearInterval(this.ticker);
        if (this.closeTimer) clearTimeout(this.closeTimer);
        this.ticker = null;
        this.closeTimer = null;
        this.recording.set(false);
        this.stage.set('compose');
        this.message.set('');
        this.voice.set(null);
        this.micBlocked.set(false);
        this.error.set('');
    }
}
