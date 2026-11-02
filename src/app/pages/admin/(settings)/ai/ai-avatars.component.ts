import { Component, computed, effect, inject, input, OnDestroy, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { AiSettingsService, type AiAvatar } from './ai-settings.service';

/** How many avatars show before "Show more". */
const SHOWN = 24;

/**
 * A presenter connection's avatars (docs/features/ai.html, Avatars; specs/ai-media-spec.md,
 * AM-D33): each look's picture, name and gender, with a search. In choose mode each has Use,
 * which hands its id to the purpose's avatar it is being chosen for.
 */
@Component({
    selector: 'arc-ai-avatars',
    standalone: true,
    imports: [FormsModule, TranslocoPipe],
    template: `
        <div class="ai-avatars border rounded p-2 mt-2">
            @switch (state()) {
                @case ('loading') { <div class="small text-muted"><i class="fas fa-spinner fa-spin me-1" aria-hidden="true"></i>{{ 'admin.settings.ai.avatars_loading' | transloco }}</div> }
                @case ('failed') {
                    <div class="small text-danger avatars-error" role="alert">{{ 'admin.settings.ai.avatars_failed' | transloco: { detail: error() } }}</div>
                    <button type="button" class="btn btn-link btn-sm p-0 avatars-retry" (click)="load(true)">{{ 'admin.settings.ai.refresh' | transloco }}</button>
                }
                @default {
                    <div class="d-flex flex-wrap gap-2 align-items-center mb-2">
                        <input type="search" class="form-control form-control-sm avatars-search" [attr.aria-label]="'admin.settings.ai.avatars_search' | transloco"
                            [placeholder]="'admin.settings.ai.avatars_search' | transloco" [ngModel]="search()" (ngModelChange)="search.set($event)" />
                        <span class="small text-muted avatars-count">{{ 'admin.settings.ai.avatars_count' | transloco: { shown: found().length, total: avatars().length } }}</span>
                        <button type="button" class="btn btn-link btn-sm p-0 ms-auto" (click)="load(true)">{{ 'admin.settings.ai.refresh' | transloco }}</button>
                    </div>
                    @if (!avatars().length) { <div class="small text-muted">{{ 'admin.settings.ai.avatars_none' | transloco }}</div> }
                    <div class="avatar-grid">
                        @for (a of shown(); track a.id) {
                            <div class="avatar" [class.chosen]="a.id === chosen()" [attr.data-id]="a.id">
                                @if (a.previewUrl) { <img [src]="a.previewUrl" [alt]="a.name" loading="lazy" referrerpolicy="no-referrer" /> }
                                @else { <div class="avatar-blank" aria-hidden="true"><i class="fa-solid fa-user"></i></div> }
                                <div class="small avatar-text">
                                    <strong>{{ a.name }}</strong>
                                    @if (a.gender) { <div class="text-muted">{{ 'admin.settings.ai.gender_' + a.gender | transloco }}</div> }
                                </div>
                                @if (mode() === 'choose') {
                                    <button type="button" class="btn btn-sm btn-outline-primary use" (click)="picked.emit(a.id)" [disabled]="a.id === chosen()">
                                        {{ (a.id === chosen() ? 'admin.settings.ai.voice_in_use' : 'admin.settings.ai.voice_use') | transloco }}
                                    </button>
                                }
                            </div>
                        }
                    </div>
                    @if (found().length > shown().length) {
                        <button type="button" class="btn btn-link btn-sm p-0 mt-2" (click)="more.set(more() + 1)">{{ 'admin.settings.ai.voices_more' | transloco: { count: found().length - shown().length } }}</button>
                    }
                }
            }
        </div>
    `,
    styles: [`
        .avatar-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 0.5rem; }
        .avatar { border: 1px solid var(--bs-border-color, #dee2e6); border-radius: 0.375rem; padding: 0.375rem; display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; }
        .avatar.chosen { border-color: var(--bs-primary); }
        .avatar img, .avatar-blank { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 0.25rem; background: var(--bs-tertiary-bg, #f8f9fa); }
        .avatar-blank { display: flex; align-items: center; justify-content: center; font-size: 2rem; color: var(--bs-secondary-color, #6c757d); }
        .avatar-text { overflow-wrap: anywhere; }
        .avatars-search { max-width: 220px; }
    `],
})
export class AiAvatarsComponent implements OnDestroy {
    private readonly service = inject(AiSettingsService);

    readonly connection = input.required<string>();
    readonly mode = input<'browse' | 'choose'>('browse');
    readonly chosen = input<string | null>(null);
    readonly picked = output<string>();

    readonly state = signal<'loading' | 'ready' | 'failed'>('loading');
    readonly avatars = signal<AiAvatar[]>([]);
    readonly error = signal('');
    readonly search = signal('');
    readonly more = signal(0);
    private destroyed = false;
    private asked = 0;

    readonly found = computed(() => {
        const words = this.search().toLowerCase().split(/\s+/).filter(Boolean);
        const list = this.avatars().filter((a) => words.every((w) => `${a.name} ${a.gender ?? ''} ${a.id}`.toLowerCase().includes(w)));
        // The chosen one first, so it is in view.
        const chosen = this.chosen();
        return chosen ? [...list.filter((a) => a.id === chosen), ...list.filter((a) => a.id !== chosen)] : list;
    });
    readonly shown = computed(() => this.found().slice(0, SHOWN * (this.more() + 1)));

    constructor() {
        effect(() => {
            this.connection();
            untracked(() => void this.load(false));
        });
    }

    ngOnDestroy(): void {
        this.destroyed = true;
    }

    async load(fresh: boolean): Promise<void> {
        const asked = ++this.asked;
        this.state.set('loading');
        try {
            const r = await this.service.avatars(this.connection(), fresh);
            if (this.destroyed || asked !== this.asked) return;
            if (!r.ok) {
                this.error.set(r.detail);
                this.state.set('failed');
                return;
            }
            this.avatars.set(r.avatars);
            this.state.set('ready');
        } catch (err) {
            if (this.destroyed || asked !== this.asked) return;
            this.error.set(String((err as Error)?.message ?? ''));
            this.state.set('failed');
        }
    }
}
