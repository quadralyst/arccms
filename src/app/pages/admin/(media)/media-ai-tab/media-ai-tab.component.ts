import { DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, input, OnDestroy, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { uploadProblem } from '../media-upload-problem';
import { firstValueFrom } from 'rxjs';
import { FileUploadService, type MediaUploadSettings, type UploadedMedia } from '../../../../../shared/services/file-upload.service';
import type { CropRatio } from '../../../../../shared/utils/image-crop';
import type { ImageSize } from '../../../../../shared/utils/image-sizes';
import { Auth } from '@angular/fire/auth';
import { MediaManagerStore } from '../media-manager.store';
import {
    fileNameFromPrompt, MEDIA_AI_ASPECTS, MediaAiService, titleFromPrompt,
    type MediaAiAspect, type MediaAiFile, type MediaAiImage, type MediaAiInfo, type MediaAiModel, type MediaAiNote, type MediaAiPreset,
} from '../media-ai.service';

/** A picture made in this visit, with its bytes loaded for the grid. */
interface MadePicture {
    file: MediaAiFile;
    url: string | null;
    blob: Blob | null;
    failed: boolean;
    saving: boolean;
    savedId: string | null;
    /** The call that made it: what the "Made with AI" note says. */
    made: { prompt: string; negativePrompt?: string; model: { connection: string; model: string }; settings: MediaAiImage; costUsd: number; recordId: string | null; purpose: string; perPicture: number; editOf?: string };
}

/** A library picture saved from the tab, as the media page selects it (like an image from a PDF). */
export interface MediaAiSaved {
    id: string;
    media: UploadedMedia & { ai: MediaAiNote; alt?: string };
}

/** The library picture Edit with AI changes (AM-D26). */
export interface MediaAiEditSource {
    id: string;
    url: string;
    title: string;
    /** Its size, so the edit starts at its shape. */
    width?: number;
    height?: number;
}

/** The shape nearest a picture's size, so an edit keeps the picture's own shape. */
export function aspectOfSize(width: number | undefined, height: number | undefined): MediaAiAspect | null {
    if (!width || !height) return null;
    const ratio = Math.log(width / height);
    const value = (a: MediaAiAspect) => {
        const [w, h] = a.split(':').map(Number);
        return Math.abs(Math.log(w / h) - ratio);
    };
    return [...MEDIA_AI_ASPECTS].sort((a, b) => value(a) - value(b))[0];
}

const MAX_PROMPT = 2000;

/** The aspect a picker's crop ratio starts the tab at (section 5): free and original start square. */
export function aspectForRatio(ratio: CropRatio | undefined): MediaAiAspect {
    return ratio && (MEDIA_AI_ASPECTS as readonly string[]).includes(ratio) ? (ratio as MediaAiAspect) : '1:1';
}

/** The resolution a picker's size starts at: S and M standard, L and XL high. */
export function resolutionForSize(size: ImageSize | undefined): 'standard' | 'high' {
    return size === 'l' || size === 'xl' ? 'high' : 'standard';
}

/**
 * The Media Manager's "Create with AI" tab (docs/features/media.html, Create with AI;
 * specs/ai-media-spec.md, section 5). Prompt, model and the settings that model takes, the
 * cost before Generate, then a grid of pictures. A picture saved goes into My Uploads as an
 * ordinary upload with a "Made with AI" note; in a picker it is then selected there, so the
 * crop and size steps and Insert work as for any upload. With `editOf` it changes a library
 * picture instead (Edit with AI), and the result is a new library picture.
 */
@Component({
    selector: 'arc-media-ai-tab',
    standalone: true,
    imports: [FormsModule, TranslocoPipe, DecimalPipe],
    templateUrl: './media-ai-tab.component.html',
    styleUrl: './media-ai-tab.component.scss',
})
export class MediaAiTabComponent implements OnDestroy {
    private readonly ai = inject(MediaAiService);
    private readonly upload = inject(FileUploadService);
    private readonly mediaStore = inject(MediaManagerStore);
    private readonly i18n = inject(TranslocoService);
    private readonly auth = inject(Auth, { optional: true });

    readonly preset = input<MediaAiPreset | null>(null);
    readonly editOf = input<MediaAiEditSource | null>(null);
    readonly cropRatio = input<CropRatio | undefined>(undefined);
    readonly size = input<ImageSize | undefined>(undefined);
    readonly uploadSettings = input.required<MediaUploadSettings>();
    /** In a picker: a saved picture is chosen at once ("Use this picture"). */
    readonly insertable = input(false);

    readonly saved = output<MediaAiSaved>();
    /** Edit with AI was left: the tab makes new pictures again. */
    readonly editClosed = output<void>();

    readonly aspects = MEDIA_AI_ASPECTS;
    readonly maxPrompt = MAX_PROMPT;
    readonly counts = [1, 2, 3, 4];

    readonly prompt = signal('');
    readonly negativePrompt = signal('');
    readonly seed = signal<number | null>(null);
    readonly modelKey = signal('');
    readonly aspect = signal<MediaAiAspect>('1:1');
    readonly resolution = signal<'standard' | 'high'>('standard');
    readonly quality = signal<'low' | 'medium' | 'high'>('medium');
    readonly count = signal(1);
    readonly moreOpen = signal(false);

    readonly info = signal<MediaAiInfo | null>(null);
    readonly infoState = signal<'loading' | 'ready' | 'failed'>('loading');
    readonly busy = signal(false);
    readonly error = signal('');
    readonly pictures = signal<MadePicture[]>([]);
    readonly placeholders = signal<number[]>([]);

    private destroyed = false;
    /** The newest request: an answer to an older one, or one the admin cancelled, is dropped. */
    private asked = 0;
    private infoAsked = 0;
    private infoTimer: ReturnType<typeof setTimeout> | null = null;
    /** The last estimate asked for: the same request is not sent again (each answer is a new object). */
    private lastInfoKey = '';

    readonly models = computed(() => this.info()?.models ?? []);
    readonly model = computed<MediaAiModel | null>(() => this.models().find((m) => `${m.connection}/${m.model}` === this.modelKey()) ?? this.models()[0] ?? null);
    /** What the chosen model makes; a model Arc knows nothing of shows every control. */
    readonly abilities = computed(() => this.model()?.image ?? null);
    readonly shownAspects = computed(() => (this.abilities()?.aspects.length ? this.aspects.filter((a) => this.abilities()!.aspects.includes(a)) : this.aspects));
    readonly offersHigh = computed(() => !this.abilities() || this.abilities()!.resolutions.includes('high'));
    readonly qualities = computed(() => this.abilities()?.qualities ?? []);
    readonly takesSeed = computed(() => !!this.abilities()?.seed);
    readonly takesNegative = computed(() => !!this.abilities()?.negativePrompt);
    readonly shownCounts = computed(() => this.counts.filter((n) => n <= Math.min(4, this.abilities()?.maxCount ?? 4)));
    readonly editing = computed(() => this.editOf() !== null);

    /** The settings sent: only what the chosen model takes (AM-D19). */
    readonly image = computed<MediaAiImage>(() => {
        const image: MediaAiImage = { aspect: this.aspect(), resolution: this.offersHigh() ? this.resolution() : 'standard', count: Math.min(this.count(), this.shownCounts().at(-1) ?? 1) };
        if (this.qualities().length) image.quality = this.qualities().includes(this.quality()) ? this.quality() : this.qualities()[0];
        if (this.takesSeed() && this.seed() !== null && Number.isInteger(this.seed())) image.seed = this.seed()!;
        if (this.takesNegative() && this.negativePrompt().trim()) image.negativePrompt = this.negativePrompt().trim();
        return image;
    }, { equal: (a, b) => JSON.stringify(a) === JSON.stringify(b) });

    /** Why Generate is off, or '' when it may run. */
    readonly blockedBy = computed(() => {
        const info = this.info();
        if (!info) return '';
        if (!info.purpose.enabled) return this.t('admin.media.ai.off');
        if (!info.models.length) return this.t(this.editing() ? 'admin.media.ai.no_edit_model' : 'admin.media.ai.no_model');
        const count = this.image().count ?? 1;
        if (info.allowance && info.allowance.left < count) return this.t('admin.media.ai.no_allowance', { left: info.allowance.left, perDay: info.allowance.perDay });
        // Off when this call would take the month past its budget, not only once it is spent.
        if (!info.test && (info.budget.left <= 0 || (info.estimate?.priced && info.estimate.usd > info.budget.left))) return this.t('admin.media.ai.no_budget');
        return '';
    });

    readonly canGenerate = computed(() => !this.busy() && !!this.prompt().trim() && this.prompt().length <= MAX_PROMPT && this.infoState() === 'ready' && !this.blockedBy());

    /** "Cost: about $0.17. Pictures left today: 16. $12.40 of this month's $20.00 left." */
    readonly estimateLine = computed(() => {
        const info = this.info();
        if (!info) return '';
        const parts: string[] = [];
        if (info.test) parts.push(this.t('admin.media.ai.estimate_test'));
        else if (info.estimate?.priced) parts.push(this.t(info.estimate.about ? 'admin.media.ai.estimate_about' : 'admin.media.ai.estimate', { usd: money(info.estimate.usd) }));
        else if (info.estimate) parts.push(this.t('admin.media.ai.estimate_none'));
        if (info.allowance) parts.push(this.t('admin.media.ai.left_today', { left: info.allowance.left }));
        if (!info.test) parts.push(this.t('admin.media.ai.budget_left', { left: money(info.budget.left), monthly: money(info.budget.monthlyUsd) }));
        return parts.join(' ');
    });

    constructor() {
        // The caller's preset first, else the picker's ratio and size (section 5).
        effect(() => {
            const p = this.preset();
            const ratio = this.cropRatio();
            const size = this.size();
            const source = this.editOf();
            untracked(() => {
                this.prompt.set(p?.prompt ?? '');
                this.negativePrompt.set(p?.negativePrompt ?? '');
                this.seed.set(Number.isInteger(p?.seed) ? p!.seed! : null);
                this.modelKey.set(p?.model ?? '');
                // An edit keeps the picture's own shape.
                this.aspect.set(aspectOfSize(source?.width, source?.height) ?? (p?.aspect && (MEDIA_AI_ASPECTS as readonly string[]).includes(p.aspect) ? p.aspect : aspectForRatio(ratio)));
                this.resolution.set(p?.resolution ?? resolutionForSize(size));
                if (p?.quality) this.quality.set(p.quality);
                if (p?.count) this.count.set(Math.min(4, Math.max(1, p.count)));
                if (p?.negativePrompt || p?.seed !== undefined) this.moreOpen.set(true);
            });
        });
        // What the server says before Generate, again whenever a setting changes the estimate.
        effect(() => {
            const request = { purpose: this.preset()?.purpose, editOf: this.editOf()?.id, model: this.modelRef(), image: this.image() };
            untracked(() => this.loadInfo(request));
        });
    }

    ngOnDestroy(): void {
        this.destroyed = true;
        if (this.infoTimer) clearTimeout(this.infoTimer);
        for (const p of this.pictures()) if (p.url) URL.revokeObjectURL(p.url);
    }

    private t(key: string, params?: Record<string, unknown>): string {
        return this.i18n.translate(key, params);
    }

    private modelRef(): { connection: string; model: string } | undefined {
        const key = this.modelKey();
        const slash = key.indexOf('/');
        return slash > 0 ? { connection: key.slice(0, slash), model: key.slice(slash + 1) } : undefined;
    }

    /** Asks for the estimate a moment after the last change, so typing a seed sends one request. */
    private loadInfo(request: Parameters<MediaAiService['info']>[0], again = false): void {
        // The same settings need no new estimate, unless the allowance or the month changed.
        const key = JSON.stringify(request);
        if (!again && key === this.lastInfoKey) return;
        this.lastInfoKey = key;
        if (this.infoTimer) clearTimeout(this.infoTimer);
        const asked = ++this.infoAsked;
        this.infoTimer = setTimeout(async () => {
            if (!this.info()) this.infoState.set('loading');
            try {
                const info = await this.ai.info(request);
                if (this.destroyed || asked !== this.infoAsked) return;
                this.info.set(info);
                this.infoState.set('ready');
                // A model the caller named that is not in the list: the first one is used.
                if (this.modelKey() && !info.models.some((m) => `${m.connection}/${m.model}` === this.modelKey())) this.modelKey.set('');
            } catch (err) {
                // A model the server no longer lists: ask again with the list's first.
                if (this.destroyed || asked !== this.infoAsked) return;
                if (request.model && /not in this purpose/i.test(String((err as Error)?.message ?? ''))) {
                    this.modelKey.set('');
                    return;
                }
                console.error('Create with AI: the settings could not be read', err);
                this.infoState.set('failed');
            }
        }, this.info() ? 300 : 0);
    }

    chooseModel(key: string): void {
        this.modelKey.set(key);
    }

    setSeed(value: unknown): void {
        const n = typeof value === 'number' ? value : Number(String(value ?? '').trim());
        this.seed.set(String(value ?? '').trim() === '' || !Number.isInteger(n) ? null : n);
    }

    async generate(): Promise<void> {
        if (!this.canGenerate()) return;
        const asked = ++this.asked;
        const prompt = this.prompt().trim();
        const model = this.model();
        const image = this.image();
        // What was asked, kept: leaving Edit with AI while it works must not relabel the result.
        const editOf = this.editOf()?.id;
        const purpose = this.preset()?.purpose;
        this.busy.set(true);
        this.error.set('');
        this.placeholders.set(Array.from({ length: image.count ?? 1 }, (_, i) => i));
        try {
            const r = await this.ai.generate({ purpose, prompt, model: model ? { connection: model.connection, model: model.model } : undefined, image, editOf });
            if (this.destroyed || asked !== this.asked) return;
            if (!r.ok) {
                this.error.set(this.failureText(r.reason, r.detail));
                return;
            }
            const each = r.files.length ? r.costUsd / r.files.length : 0;
            const made: MadePicture[] = r.files.map((file) => ({
                file, url: null, blob: null, failed: false, saving: false, savedId: null,
                made: { prompt, ...(image.negativePrompt ? { negativePrompt: image.negativePrompt } : {}), model: r.model, settings: r.settings, costUsd: r.costUsd, recordId: r.recordId, purpose: r.purpose, perPicture: each, ...(editOf ? { editOf } : {}) },
            }));
            // Newest first: Generate again adds above what was made before.
            this.pictures.update((list) => [...made, ...list]);
            await Promise.all(made.map((m) => this.loadPicture(m)));
        } catch (err) {
            if (this.destroyed || asked !== this.asked) return;
            console.error('Create with AI: the pictures could not be made', err);
            this.error.set(this.t('admin.media.ai.failed_connection'));
        } finally {
            if (!this.destroyed && asked === this.asked) {
                this.busy.set(false);
                this.placeholders.set([]);
                // The allowance and the month's totals changed.
                this.loadInfo({ purpose: this.preset()?.purpose, editOf: this.editOf()?.id, model: this.modelRef(), image: this.image() }, true);
            }
        }
    }

    /**
     * Stops waiting. The provider may still finish and bill, so those pictures are recorded as
     * usual and left in Arc's folder until they are deleted (section 5).
     */
    cancel(): void {
        this.asked++;
        this.busy.set(false);
        this.placeholders.set([]);
    }

    private failureText(reason: string, detail: string): string {
        const key = ['blocked', 'limit', 'unavailable', 'timeout', 'off', 'too-large', 'unreadable'].includes(reason) ? `admin.media.ai.reason_${reason.replace('-', '_')}` : 'admin.media.ai.reason_unreadable';
        return this.t(key, { detail });
    }

    private async loadPicture(p: MadePicture): Promise<void> {
        try {
            const blob = await this.ai.read(p.file.path);
            if (this.destroyed) return;
            this.patch(p, { blob, url: URL.createObjectURL(blob) });
        } catch (err) {
            console.error('Create with AI: a picture could not be read', err);
            if (!this.destroyed) this.patch(p, { failed: true });
        }
    }

    private patch(p: MadePicture, change: Partial<MadePicture>): void {
        this.pictures.update((list) => list.map((x) => (x.file.path === p.file.path ? Object.assign(x, change) : x)).slice());
    }

    /**
     * Saves one picture to the library as an ordinary upload (every size, WebP when that
     * setting is on) with its "Made with AI" note (AM-D25), then hands it to the media page.
     */
    async save(p: MadePicture): Promise<void> {
        if (!p.blob || p.saving || p.savedId) return;
        this.patch(p, { saving: true });
        try {
            const file = new File([p.blob], fileNameFromPrompt(p.made.prompt, p.blob.type), { type: p.blob.type || p.file.mimeType });
            const uploaded = await this.upload.uploadFile(file, this.uploadSettings(), () => undefined);
            const note: MediaAiNote = {
                prompt: p.made.prompt,
                ...(p.made.negativePrompt ? { negativePrompt: p.made.negativePrompt } : {}),
                model: p.made.model.model,
                connection: p.made.model.connection,
                settings: p.made.settings,
                costUsd: Math.round(p.made.perPicture * 1e6) / 1e6,
                createdAt: new Date(),
                createdBy: this.auth?.currentUser?.uid ?? '',
                recordId: p.made.recordId,
                purpose: p.made.purpose,
                ...(p.made.editOf ? { editOf: p.made.editOf } : {}),
            };
            const record: MediaAiSaved['media'] = { ...uploaded, title: titleFromPrompt(p.made.prompt), ai: note };
            let id: string;
            try {
                [id] = await firstValueFrom(this.mediaStore.addBatch([record]));
            } catch (error) {
                // A picture no tab lists could never be found or deleted: take it back out.
                await this.upload.removeStored(FileUploadService.storedPaths(uploaded));
                throw error;
            }
            if (this.destroyed) return;
            this.patch(p, { saving: false, savedId: id });
            this.saved.emit({ id, media: record });
        } catch (err) {
            console.error('Create with AI: the picture could not be saved', err);
            if (this.destroyed) return;
            this.patch(p, { saving: false });
            const problem = uploadProblem(err, this.uploadSettings().maxFileSize);
            this.error.set(this.t('admin.media.ai.save_failed', { reason: this.t(problem.key, problem.params) }));
        }
    }

    leaveEdit(): void {
        this.editClosed.emit();
    }

    modelLabel(m: MediaAiModel): string {
        return `${m.label} · ${m.model}`;
    }
}

function money(usd: number): string {
    if (usd > 0 && usd < 0.01) return `$${usd.toFixed(3)}`;
    return `$${usd.toFixed(2)}`;
}
