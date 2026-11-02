/**
 * A speech connection's voices in Settings, AI (docs/features/ai.html; specs/ai-media-spec.md,
 * AM-D17, AM-D18): the provider's list, searchable, each voice with Play. Play uses the
 * provider's own sample file when it has one; otherwise it asks the server for a short
 * sample, made once as Arc's purpose arc-voice-sample and kept for a year (in test mode, a
 * silent stand-in). In `choose` mode each voice also has Use, for a purpose's named voice.
 */
import { Component, computed, inject, input, OnDestroy, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { AiSettingsService, type AiVoice } from './ai-settings.service';

const SHOWN = 40;

@Component({
    selector: 'arc-ai-voices',
    standalone: true,
    imports: [FormsModule, TranslocoPipe],
    template: `
        <div class="voices border rounded p-2 mt-2">
            <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
                <input type="search" class="form-control form-control-sm voices-search" [ngModel]="search()" (ngModelChange)="search.set($event)"
                    [placeholder]="'admin.settings.ai.voices_search' | transloco" [attr.aria-label]="'admin.settings.ai.voices_search' | transloco" />
                @if (!loading()) {
                    <span class="small text-muted voices-count">{{ 'admin.settings.ai.voices_count' | transloco: { shown: matching().length, all: voices().length } }}</span>
                    <button type="button" class="btn btn-link btn-sm p-0 ms-auto voices-reload" (click)="load(true)"><i class="fa-solid fa-rotate me-1"></i>{{ 'admin.settings.ai.refresh' | transloco }}</button>
                }
            </div>
            @if (loading()) {
                <div class="small text-muted"><i class="fas fa-spinner fa-spin me-1"></i>{{ 'admin.settings.ai.voices_loading' | transloco }}</div>
            } @else if (error()) {
                <div class="small text-danger voices-error"><i class="fa-solid fa-circle-exclamation me-1"></i>{{ 'admin.settings.ai.voices_failed' | transloco: { error: error() } }}</div>
            } @else if (!voices().length) {
                <div class="small text-muted">{{ 'admin.settings.ai.voices_none' | transloco }}</div>
            } @else {
                <ul class="list-unstyled mb-0 voice-list">
                    @for (v of shown(); track v.id) {
                        <li class="voice d-flex align-items-center gap-2 py-1 border-top" [class.chosen]="v.id === chosen()">
                            <button type="button" class="btn btn-sm btn-outline-secondary play" (click)="play(v)" [disabled]="busyId() === v.id" [attr.aria-pressed]="playingId() === v.id"
                                [attr.aria-label]="(playingId() === v.id ? 'admin.settings.ai.voice_stop' : 'admin.settings.ai.voice_play') | transloco: { name: v.name }">
                                @if (busyId() === v.id) { <i class="fas fa-spinner fa-spin"></i> } @else if (playingId() === v.id) { <i class="fa-solid fa-stop"></i> } @else { <i class="fa-solid fa-play"></i> }
                            </button>
                            <span class="voice-text">
                                <strong>{{ v.name }}</strong>
                                @if (v.name !== v.id) { <code class="small ms-1 text-muted">{{ v.id }}</code> }
                                <span class="d-block small text-muted">{{ describe(v) }}</span>
                            </span>
                            @if (mode() === 'choose') {
                                <button type="button" class="btn btn-sm use" [class.btn-primary]="v.id !== chosen()" [class.btn-success]="v.id === chosen()" (click)="picked.emit(v.id)" [disabled]="v.id === chosen()">
                                    {{ (v.id === chosen() ? 'admin.settings.ai.voice_chosen' : 'admin.settings.ai.voice_use') | transloco }}
                                </button>
                            }
                        </li>
                    }
                </ul>
                @if (matching().length > shown().length) {
                    <button type="button" class="btn btn-link btn-sm px-0 more" (click)="showMore()">{{ 'admin.settings.ai.voices_more' | transloco: { count: matching().length - shown().length } }}</button>
                }
            }
            @if (note()) { <div class="small mt-1 voice-note" [class.text-danger]="!noteOk()" [class.text-muted]="noteOk()" role="status">{{ note() }}</div> }
        </div>
    `,
    styles: [`
        .voices-search { max-width: 18rem; }
        .voice-list { max-height: 24rem; overflow-y: auto; }
        .voice.chosen { background: var(--bs-success-bg-subtle); }
        /* The name takes what is left beside Play and Use, and wraps inside it, never under Play. */
        .voice-text { flex: 1 1 0; min-width: 0; overflow-wrap: anywhere; }
        .voice .play, .voice .use { flex: none; }
    `],
})
export class AiVoicesComponent implements OnInit, OnDestroy {
    private readonly service = inject(AiSettingsService);
    private readonly transloco = inject(TranslocoService);

    readonly connection = input.required<string>();
    /** The connection's speech models: a sample is made with the first one the voice works with. */
    readonly models = input<string[]>([]);
    readonly mode = input<'browse' | 'choose'>('browse');
    /** The voice id now chosen, in choose mode. */
    readonly chosen = input<string | null>(null);
    readonly picked = output<string>();

    readonly voices = signal<AiVoice[]>([]);
    readonly loading = signal(true);
    readonly error = signal('');
    readonly search = signal('');
    readonly limit = signal(SHOWN);
    readonly busyId = signal<string | null>(null);
    readonly playingId = signal<string | null>(null);
    readonly note = signal('');
    readonly noteOk = signal(true);
    private audio: HTMLAudioElement | null = null;
    private objectUrl: string | null = null;
    /** Each Play, and Stop, ends the one before: a sample that comes back late is dropped. */
    private asked = 0;
    private destroyed = false;

    /** The chosen voice first, then the rest as the search finds them. */
    readonly matching = computed(() => {
        const q = this.search().trim().toLowerCase();
        const all = this.voices().filter((v) => !q || [v.name, v.id, ...v.languages, ...v.labels, v.gender ?? ''].join(' ').toLowerCase().includes(q));
        const chosen = this.chosen();
        return chosen ? [...all.filter((v) => v.id === chosen), ...all.filter((v) => v.id !== chosen)] : all;
    });
    readonly shown = computed(() => this.matching().slice(0, this.limit()));

    ngOnInit(): void {
        void this.load(false);
    }

    ngOnDestroy(): void {
        this.destroyed = true;
        this.stop();
    }

    async load(fresh: boolean): Promise<void> {
        this.loading.set(true);
        this.error.set('');
        try {
            const r = await this.service.voices(this.connection(), fresh);
            if (r.ok) this.voices.set(r.voices);
            else this.error.set(r.detail);
        } catch (err: any) {
            this.error.set(err?.message ?? '');
        } finally {
            this.loading.set(false);
        }
    }

    describe(v: AiVoice): string {
        const gender = v.gender ? this.transloco.translate(`admin.settings.ai.gender_${v.gender}`) : '';
        const languages = v.languages.length > 3 ? `${v.languages.slice(0, 3).join(', ')} +${v.languages.length - 3}` : v.languages.join(', ');
        return [gender, languages, ...v.labels].filter(Boolean).join(' · ');
    }

    /**
     * The language a sample is said in: the admin's own when the voice speaks it, else English
     * when it does, else its first. A Sarvam v3 voice speaks 11 languages, Bengali first.
     */
    sampleLanguage(v: AiVoice): string | undefined {
        const primary = (tag: string) => tag.split('-')[0].toLowerCase();
        const own = primary(this.transloco.getActiveLang() || 'en');
        return v.languages.find((l) => primary(l) === own) ?? v.languages.find((l) => primary(l) === 'en') ?? v.languages[0];
    }

    /** The model a sample of this voice is made with: one it works with, else the connection's first. */
    sampleModel(v: AiVoice): string | null {
        const models = this.models();
        return models.find((m) => v.models.includes(m)) ?? (v.models.length ? null : models[0] ?? null);
    }

    async play(v: AiVoice): Promise<void> {
        if (this.playingId() === v.id) {
            this.stop();
            return;
        }
        this.stop();
        this.note.set('');
        if (v.previewUrl) {
            this.start(v.id, v.previewUrl);
            return;
        }
        const model = this.sampleModel(v);
        if (!model) {
            this.say(false, this.transloco.translate('admin.settings.ai.voice_no_model'));
            return;
        }
        this.busyId.set(v.id);
        const ask = this.asked;
        const late = () => ask !== this.asked || this.destroyed;
        try {
            const r = await this.service.voiceSample(this.connection(), model, v.id, this.sampleLanguage(v));
            if (late()) return;
            if (!r.ok) {
                this.say(false, this.transloco.translate('admin.settings.ai.voice_sample_failed', { error: r.detail || r.reason }));
                return;
            }
            const file = await this.service.aiFileUrl(r.path);
            if (late()) {
                URL.revokeObjectURL(file.url);
                return;
            }
            this.objectUrl = file.url;
            this.start(v.id, file.url);
            if (r.test) this.say(true, this.transloco.translate('admin.settings.ai.voice_sample_test'));
            else if (!r.cached && r.costUsd > 0) this.say(true, this.transloco.translate('admin.settings.ai.voice_sample_cost', { cost: r.costUsd < 0.0001 ? '< $0.0001' : `$${r.costUsd.toFixed(4)}` }));
        } catch (err: any) {
            if (!late()) this.say(false, this.transloco.translate('admin.settings.ai.voice_sample_failed', { error: err?.message ?? '' }));
        } finally {
            if (this.busyId() === v.id) this.busyId.set(null);
        }
    }

    private start(id: string, url: string): void {
        const audio = new Audio(url);
        this.audio = audio;
        this.playingId.set(id);
        audio.onended = () => this.stop();
        audio.onerror = () => {
            this.stop();
            this.say(false, this.transloco.translate('admin.settings.ai.voice_play_failed'));
        };
        audio.play().catch(() => {
            this.stop();
            this.say(false, this.transloco.translate('admin.settings.ai.voice_play_failed'));
        });
    }

    private stop(): void {
        this.asked++;
        if (this.audio) {
            this.audio.onended = null;
            this.audio.onerror = null;
            this.audio.pause();
            this.audio = null;
        }
        if (this.objectUrl) {
            URL.revokeObjectURL(this.objectUrl);
            this.objectUrl = null;
        }
        this.playingId.set(null);
    }

    showMore(): void {
        this.limit.set(this.limit() + SHOWN);
    }

    private say(ok: boolean, text: string): void {
        this.noteOk.set(ok);
        this.note.set(text);
    }
}
