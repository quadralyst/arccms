/** A voice note may run this long; recording stops by itself at the limit. */
export const MAX_VOICE_SECONDS = 120;

/**
 * Formats to record in, best first. MP4 (AAC) plays in every browser, Safari
 * included; Chrome, Edge and Firefox that cannot record it use WebM or Ogg (Opus).
 */
const FORMATS = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];

/** The first format this browser can record, or '' to let it choose. */
export function pickAudioFormat(isSupported: (type: string) => boolean): string {
    return FORMATS.find((type) => isSupported(type)) ?? '';
}

/** The file extension for a recorded type: `voice.mp4`, `voice.webm`. */
export function audioExtension(type: string): string {
    if (type.includes('mp4') || type.includes('aac')) return 'mp4';
    if (type.includes('ogg')) return 'ogg';
    return 'webm';
}

/** Whether this browser can record a voice note at all (and the page is secure). */
export function canRecordVoice(): boolean {
    return typeof window !== 'undefined'
        && typeof MediaRecorder !== 'undefined'
        && !!navigator.mediaDevices?.getUserMedia
        && window.isSecureContext;
}

export interface VoiceNote {
    blob: Blob;
    type: string;
    seconds: number;
}

/**
 * Records one voice note from the microphone. `start()` asks for the microphone
 * (the browser shows its own prompt the first time); `stop()` gives the note.
 */
export class VoiceRecorder {
    private recorder: MediaRecorder | null = null;
    private stream: MediaStream | null = null;
    private chunks: Blob[] = [];
    private startedAt = 0;
    private limitTimer: ReturnType<typeof setTimeout> | null = null;
    private done: ((note: VoiceNote | null) => void) | null = null;

    /** Called when the note ends by itself at the time limit. */
    onLimit: ((note: VoiceNote | null) => void) | null = null;

    async start(): Promise<void> {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const type = pickAudioFormat((t) => MediaRecorder.isTypeSupported(t));
        this.recorder = new MediaRecorder(this.stream, type ? { mimeType: type } : undefined);
        this.chunks = [];
        this.recorder.ondataavailable = (e) => {
            if (e.data.size) this.chunks.push(e.data);
        };
        this.recorder.onstop = () => this.finish();
        this.recorder.start();
        this.startedAt = Date.now();
        this.limitTimer = setTimeout(() => {
            void this.stop().then((note) => this.onLimit?.(note));
        }, MAX_VOICE_SECONDS * 1000);
    }

    /** Seconds recorded so far. */
    elapsed(): number {
        return this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : 0;
    }

    stop(): Promise<VoiceNote | null> {
        return new Promise((resolve) => {
            if (!this.recorder || this.recorder.state === 'inactive') {
                resolve(null);
                return;
            }
            this.done = resolve;
            this.recorder.stop();
        });
    }

    /** Stop without keeping anything, and release the microphone. */
    cancel(): void {
        this.done = null;
        if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
        this.release();
    }

    private finish(): void {
        const type = this.recorder?.mimeType || this.chunks[0]?.type || 'audio/webm';
        const seconds = Math.max(1, Math.round((Date.now() - this.startedAt) / 1000));
        const note = this.chunks.length ? { blob: new Blob(this.chunks, { type }), type, seconds } : null;
        this.release();
        this.done?.(note);
        this.done = null;
    }

    private release(): void {
        if (this.limitTimer) clearTimeout(this.limitTimer);
        this.limitTimer = null;
        this.stream?.getTracks().forEach((track) => track.stop());
        this.stream = null;
        this.recorder = null;
        this.startedAt = 0;
    }
}
