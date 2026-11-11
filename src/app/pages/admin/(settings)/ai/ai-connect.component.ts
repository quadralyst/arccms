/**
 * Connecting a provider in Settings, AI, step by step for someone doing it the first time
 * (docs/features/ai.html): choose the provider, get a key with the provider's own steps and
 * links, paste it, then connect and test in one click. The connection is saved on its own,
 * so connecting commits none of the page's other changes, and the key goes straight to the
 * server, which answers with its preview. The same panel replaces an existing key.
 */
import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { failureAdvice, PROVIDER_GUIDES, type ProviderGuide } from './ai-provider-guide';
import { AiConnectionForm, AiPresetInfo, type AiPresetModel, AiSettingsService, blankConnection, connectionId, KEY_HEADERS, presetNeedsKey, safeHeaderName } from './ai-settings.service';

/** What a finished connect hands back to the page. */
export interface AiConnected {
    connection: AiConnectionForm;
    /** The model the test used, for "Use recommended models". */
    model: string;
    replaced: boolean;
}

type Phase = 'idle' | 'saving' | 'testing' | 'done' | 'failed';

@Component({
    selector: 'arc-ai-connect',
    standalone: true,
    imports: [FormsModule, TranslocoPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="connect card border-primary-subtle mb-3">
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-start gap-2">
                    <h5 class="mb-3">{{ (existing() ? 'admin.settings.ai.replace_title' : 'admin.settings.ai.connect_title') | transloco: { name: existing()?.label ?? '' } }}</h5>
                    <button type="button" class="btn-close" (click)="cancel.emit()" [attr.aria-label]="'admin.settings.ai.cancel' | transloco"></button>
                </div>

                @if (!existing()) {
                    <div class="step-title"><span class="step-no">1</span>{{ 'admin.settings.ai.step_choose' | transloco }}</div>
                    <div class="presets mb-3" role="radiogroup" [attr.aria-label]="'admin.settings.ai.step_choose' | transloco">
                        @for (p of shownPresets(); track p.id) {
                            <label class="preset" [class.chosen]="presetId() === p.id">
                                <input type="radio" class="form-check-input me-2" name="aiPreset" [value]="p.id" [checked]="presetId() === p.id" (change)="choose(p.id)" />
                                <span>
                                    <strong>{{ p.label }}</strong>
                                    @if (guideFor(p.id)?.easiest) { <span class="badge text-bg-success ms-1">{{ 'admin.settings.ai.easiest' | transloco }}</span> }
                                    @if (p.kind === 'vertex') { <span class="badge text-bg-secondary ms-1">{{ 'admin.settings.ai.no_key_needed' | transloco }}</span> }
                                    @if (p.testedLive === false) { <span class="badge text-bg-light border ms-1 untested-live">{{ 'admin.settings.ai.not_tested_live' | transloco }}</span> }
                                    <span class="d-block small text-muted">{{ 'admin.settings.ai.blurb_' + slug(p.id) | transloco }}</span>
                                    <span class="d-block small"><i class="fa-solid fa-location-dot me-1"></i>{{ 'admin.settings.ai.processes_in' | transloco: { place: p.processesIn } }}</span>
                                </span>
                            </label>
                        }
                    </div>
                    @if (chosen() && !choosing()) {
                        <button type="button" class="btn btn-link btn-sm px-0 mb-3 choose-another" (click)="choosing.set(true)">{{ 'admin.settings.ai.choose_another' | transloco }}</button>
                    }
                }

                @if (preset(); as p) {
                    <div class="step-title"><span class="step-no">{{ existing() ? 1 : 2 }}</span>{{ (p.kind === 'vertex' ? 'admin.settings.ai.step_google' : 'admin.settings.ai.step_get_key') | transloco: { name: p.label } }}</div>
                    <ol class="guide small mb-3">
                        @for (s of guide()?.steps ?? []; track s.key) {
                            <li>
                                {{ 'admin.settings.ai.' + s.key | transloco: { name: p.label } }}
                                @if (s.url) { <a [href]="s.url" target="_blank" rel="noopener" class="ms-1 text-nowrap">{{ 'admin.settings.ai.open_page' | transloco }} <i class="fa-solid fa-arrow-up-right-from-square small"></i></a> }
                            </li>
                        }
                    </ol>

                    <div class="step-title"><span class="step-no">{{ existing() ? 2 : 3 }}</span>{{ (p.kind === 'vertex' ? 'admin.settings.ai.step_location' : 'admin.settings.ai.step_paste') | transloco }}</div>
                    <div class="row g-2 mb-2">
                        @if (p.needsWorkspace && !existing()) {
                            <div class="col-sm-6">
                                <label class="form-label small mb-1" for="aiConnectWs">{{ 'admin.settings.ai.workspace' | transloco }}</label>
                                <input id="aiConnectWs" class="form-control" autocomplete="off" [ngModel]="workspace()" (ngModelChange)="workspace.set($event)" />
                            </div>
                        }
                        @if (p.needsAddress && !existing()) {
                            <div class="col-sm-6">
                                <label class="form-label small mb-1" for="aiConnectUrl">{{ 'admin.settings.ai.address' | transloco }}</label>
                                <input id="aiConnectUrl" class="form-control" placeholder="https://api.example.com/v1" [ngModel]="baseUrl()" (ngModelChange)="baseUrl.set($event)" />
                            </div>
                            <div class="col-sm-6">
                                <label class="form-label small mb-1" for="aiConnectWhere">{{ 'admin.settings.ai.where' | transloco }}</label>
                                <input id="aiConnectWhere" class="form-control" [ngModel]="where()" (ngModelChange)="where.set($event)" />
                            </div>
                            <div class="col-sm-6">
                                <label class="form-label small mb-1" for="aiConnectHeader">{{ 'admin.settings.ai.key_header' | transloco }}</label>
                                <select id="aiConnectHeader" class="form-select" [ngModel]="headerChoice()" (ngModelChange)="headerChoice.set($event)">
                                    @for (h of keyHeaders; track h) { <option [value]="h">{{ h || 'Authorization: Bearer' }}</option> }
                                    <option value="custom">{{ 'admin.settings.ai.key_header_custom' | transloco }}</option>
                                </select>
                            </div>
                            @if (headerChoice() === 'custom') {
                                <div class="col-sm-6">
                                    <label class="form-label small mb-1" for="aiConnectHeaderName">{{ 'admin.settings.ai.key_header_name' | transloco }}</label>
                                    <input id="aiConnectHeaderName" class="form-control" autocomplete="off" spellcheck="false" placeholder="x-my-key" [ngModel]="customHeader()" (ngModelChange)="customHeader.set($event)" />
                                </div>
                            }
                        }
                        @if (p.kind === 'vertex' && !existing()) {
                            <div class="col-sm-6">
                                <label class="form-label small mb-1" for="aiConnectLoc">{{ 'admin.settings.ai.location' | transloco }}</label>
                                <input id="aiConnectLoc" class="form-control" [placeholder]="defaultLocation()" [ngModel]="location()" (ngModelChange)="location.set($event)" />
                                <small class="text-muted">{{ 'admin.settings.ai.location_hint' | transloco }}</small>
                            </div>
                        }
                        @if (needsKey(p)) {
                            <div class="col-12">
                                <label class="form-label small mb-1" for="aiConnectKey">{{ 'admin.settings.ai.key' | transloco }}</label>
                                <div class="input-group">
                                    <input id="aiConnectKey" class="form-control" autocomplete="off" spellcheck="false" [type]="showKey() ? 'text' : 'password'"
                                        [placeholder]="guide()?.keyPrefix ? ('admin.settings.ai.key_placeholder' | transloco: { prefix: guide()?.keyPrefix }) : ''"
                                        [ngModel]="key()" (ngModelChange)="key.set($event)" />
                                    <button type="button" class="btn btn-outline-secondary" (click)="showKey.set(!showKey())" [attr.aria-label]="'admin.settings.ai.show_key' | transloco" [attr.aria-pressed]="showKey()">
                                        <i class="fa-solid" [class.fa-eye]="!showKey()" [class.fa-eye-slash]="showKey()"></i>
                                    </button>
                                </div>
                                @if (prefixWarning()) { <small class="d-block text-warning-emphasis mt-1 prefix-warning"><i class="fa-solid fa-triangle-exclamation me-1"></i>{{ 'admin.settings.ai.key_prefix_warning' | transloco: { name: p.label, prefix: guide()?.keyPrefix } }}</small> }
                                <small class="d-block text-muted mt-1">{{ 'admin.settings.ai.key_safe' | transloco }}</small>
                            </div>
                        }
                        @if (p.makesText !== false) {
                        <div class="col-sm-6">
                            <label class="form-label small mb-1" for="aiConnectModel">{{ 'admin.settings.ai.test_model' | transloco }}</label>
                            <input id="aiConnectModel" class="form-control" [attr.list]="'aiConnectModels'" [ngModel]="model()" (ngModelChange)="model.set($event)"
                                [placeholder]="'admin.settings.ai.model_placeholder' | transloco" />
                            <datalist id="aiConnectModels">@for (m of textModels(); track m.model) { <option [value]="m.model"></option> }</datalist>
                            @if (!textModels().length) { <small class="text-muted">{{ 'admin.settings.ai.model_name_hint' | transloco }}</small> }
                        </div>
                        } @else {
                            <div class="col-sm-6 small text-muted align-self-end voices-check-hint">{{ (preset()?.makesPresenters ? 'admin.settings.ai.connect_checks_avatars' : preset()?.makesSpeech ? 'admin.settings.ai.connect_checks_voices' : 'admin.settings.ai.connect_checks_balance') | transloco }}</div>
                        }
                    </div>

                    <button type="button" class="btn btn-primary connect-button" (click)="connect()" [disabled]="busy() || !ready()">
                        @if (busy()) { <i class="fas fa-spinner fa-spin me-1"></i>{{ (phase() === 'saving' ? 'admin.settings.ai.connecting' : 'admin.settings.ai.testing') | transloco }} }
                        @else { <i class="fa-solid fa-plug me-1"></i>{{ (existing() ? 'admin.settings.ai.save_and_test' : 'admin.settings.ai.connect_and_test') | transloco }} }
                    </button>
                    @if (!ready() && !busy()) { <small class="d-block text-muted mt-1 missing-hint">{{ missing() | transloco: { model: model().trim(), example: textModels()[0]?.model ?? '' } }}</small> }

                    @if (phase() === 'failed') {
                        <div class="alert alert-danger mt-3 mb-0 small result" role="alert">
                            <strong>{{ 'admin.settings.ai.connect_failed' | transloco }}</strong>
                            <div>{{ 'admin.settings.ai.' + advice() | transloco: { name: p.label, message: detail() } }}</div>
                            @if (detail()) { <details class="mt-1"><summary>{{ 'admin.settings.ai.details' | transloco }}</summary><code class="small">{{ detail() }}</code></details> }
                        </div>
                    }
                }
            </div>
        </div>
    `,
    styles: [`
        .step-title { font-weight: 600; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem; }
        .step-no { display: inline-flex; align-items: center; justify-content: center; width: 1.5rem; height: 1.5rem; border-radius: 50%; background: var(--bs-primary); color: #fff; font-size: 0.8rem; flex: none; }
        .presets { display: grid; gap: 0.5rem; }
        .preset { display: flex; align-items: flex-start; border: 1px solid var(--bs-border-color); border-radius: 0.5rem; padding: 0.6rem 0.75rem; cursor: pointer; }
        .preset.chosen { border-color: var(--bs-primary); background: var(--bs-primary-bg-subtle); }
        .guide { padding-left: 1.25rem; }
        .guide li { margin-bottom: 0.35rem; }
    `],
})
export class AiConnectComponent implements OnInit {
    private readonly service = inject(AiSettingsService);

    readonly presets = input.required<AiPresetInfo[]>();
    readonly takenIds = input<string[]>([]);
    readonly defaultLocation = input('');
    /** Set to replace this connection's key instead of adding one. */
    readonly existing = input<AiConnectionForm | null>(null);
    /** The connection, each time the server has more of it: saved, then its key's preview, then a test's error. */
    readonly saved = output<AiConnectionForm>();
    /** It answered a test: the panel's work is done. */
    readonly connected = output<AiConnected>();
    readonly cancel = output<void>();

    readonly chosen = signal('');
    /** The whole list shows until one is chosen, then only that one, unless the admin asks for the list again. */
    readonly choosing = signal(true);
    readonly workspace = signal('');
    readonly baseUrl = signal('');
    readonly where = signal('');
    readonly location = signal('');
    readonly key = signal('');
    readonly showKey = signal(false);
    readonly model = signal('');
    /** Other only: the header its key goes in (AM-D8); 'custom' takes the name typed. */
    readonly headerChoice = signal<string>('');
    readonly customHeader = signal('');
    readonly keyHeaders = KEY_HEADERS;
    readonly phase = signal<Phase>('idle');
    readonly advice = signal('advice_other');
    readonly detail = signal('');
    /** A new connection once saved, so trying again after a wrong key adds no second one. */
    private savedConnection: AiConnectionForm | null = null;
    /** The key last sent to the server, so a retry with the same key does not set it again. */
    private keySent = '';

    /** The providers, the easiest first; only the chosen one once chosen. */
    readonly shownPresets = computed(() => {
        const sorted = [...this.presets()].sort((a, b) => Number(!!PROVIDER_GUIDES[b.id]?.easiest) - Number(!!PROVIDER_GUIDES[a.id]?.easiest));
        return this.choosing() ? sorted : sorted.filter((p) => p.id === this.chosen());
    });
    readonly presetId = computed(() => this.existing()?.preset ?? this.chosen());
    readonly preset = computed(() => this.presets().find((p) => p.id === this.presetId()));
    readonly guide = computed<ProviderGuide | undefined>(() => PROVIDER_GUIDES[this.presetId()]);
    readonly busy = computed(() => this.phase() === 'saving' || this.phase() === 'testing');
    /** The header Other's key goes in, as saved: '' is Authorization (Bearer). */
    readonly header = computed(() => (this.headerChoice() === 'custom' ? this.customHeader().trim().toLowerCase() : this.headerChoice()));
    readonly prefixWarning = computed(() => {
        const prefix = this.guide()?.keyPrefix;
        const k = this.key().trim();
        return !!prefix && k.length > 3 && !k.startsWith(prefix);
    });
    /** What is still missing before Connect can run, as a translation key; '' when nothing is. */
    readonly missing = computed(() => {
        const p = this.preset();
        if (!p) return 'admin.settings.ai.missing_provider';
        if (!this.existing() && p.needsWorkspace && !this.workspace().trim()) return 'admin.settings.ai.missing_workspace';
        if (!this.existing() && p.needsAddress && !/^https:\/\/\S+$/.test(this.baseUrl().trim())) return 'admin.settings.ai.missing_address';
        if (!this.existing() && p.needsAddress && this.header() && !safeHeaderName(this.header())) return 'admin.settings.ai.header_invalid';
        if (!this.existing() && p.needsAddress && this.headerChoice() === 'custom' && !this.header()) return 'admin.settings.ai.header_invalid';
        if (this.needsKey(p) && this.key().trim().length < 8) return 'admin.settings.ai.missing_key';
        if (p.makesText !== false && !this.model().trim()) return 'admin.settings.ai.missing_model';
        // Test asks a question: a model the provider lists as making files cannot answer it.
        if (p.makesText !== false && p.models.some((m) => m.model === this.model().trim() && !isTextModel(m))) return this.textModels().length ? 'admin.settings.ai.test_model_not_text' : 'admin.settings.ai.test_model_not_text_type';
        return '';
    });
    /** The provider's models that answer in text, the only ones Test can try. */
    readonly textModels = computed(() => (this.preset()?.models ?? []).filter(isTextModel));
    readonly ready = computed(() => this.missing() === '');

    needsKey(p: AiPresetInfo): boolean {
        return presetNeedsKey(p);
    }

    guideFor(id: string): ProviderGuide | undefined {
        return PROVIDER_GUIDES[id];
    }

    /** A preset id as it appears in a translation key. */
    slug(id: string): string {
        return id.replace(/-/g, '_');
    }

    choose(id: string): void {
        this.chosen.set(id);
        this.choosing.set(false);
        this.phase.set('idle');
        const p = this.presets().find((x) => x.id === id);
        const text = (p?.models ?? []).filter(isTextModel);
        this.model.set(text.find((m) => m.recommend?.includes('fast'))?.model ?? text[0]?.model ?? '');
    }

    /** Replacing a key: the provider is known, and the model to test is its first recommended one. */
    ngOnInit(): void {
        const e = this.existing();
        if (e) this.choose(e.preset);
    }

    async connect(): Promise<void> {
        const p = this.preset();
        if (!p || !this.ready() || this.busy()) return;
        const existing = this.existing();
        this.phase.set('saving');
        this.detail.set('');
        const fields = { workspace: this.workspace().trim(), baseUrl: this.baseUrl().trim(), location: this.location().trim(), processesIn: this.where().trim(), header: p.needsAddress ? this.header() : '' };
        let base = existing ?? this.savedConnection;
        try {
            // New, or saved by a try whose workspace or address the admin has since corrected: save it (again).
            const changed = !existing && base && (Object.keys(fields) as Array<keyof typeof fields>).some((k) => base![k] !== fields[k]);
            if (!base || changed) {
                base = blankConnection({ id: base?.id ?? connectionId(p.label, this.takenIds()), preset: p.id, label: base?.label ?? p.label, ...fields });
                await this.service.saveConnection(base);
                this.savedConnection = base;
                this.keySent = '';
                this.saved.emit(base);
            }
            const key = this.key().trim();
            if (this.needsKey(p) && key !== this.keySent) {
                base = { ...base, ...(await this.service.setKey(base.id, key)), lastError: null };
                if (!existing) this.savedConnection = base;
                this.keySent = key;
                this.saved.emit(base);
            }
        } catch (err: any) {
            // The server's own words say what is wrong (a missing address, a key it cannot take).
            this.fail(err?.code && /invalid-argument|failed-precondition|not-found/.test(String(err.code)) ? 'advice_server' : 'advice_save', err?.message ?? '');
            return;
        }
        this.phase.set('testing');
        if (p.makesText === false) {
            await this.checkByList(base, !!existing, p);
            return;
        }
        try {
            const r = await this.service.test(base.id, this.model().trim());
            if (r.ok) {
                this.phase.set('done');
                // The key is kept until it worked, so a retry after a wrong model or a busy provider needs no new paste.
                this.key.set('');
                this.connected.emit({ connection: { ...base, lastOkAt: new Date().toISOString(), lastError: null }, model: this.model().trim(), replaced: !!existing });
                return;
            }
            this.saved.emit({ ...base, lastError: r.detail ?? r.failure ?? null });
            this.fail(failureAdvice(r.failure, r.detail), r.detail ?? r.failure ?? '');
        } catch (err: any) {
            // A model the admin set as making files in Settings, AI: the server refuses to test it.
            this.fail(/text models only/i.test(String(err?.message ?? '')) ? 'advice_not_text' : 'advice_other', err?.message ?? '');
        }
    }

    /**
     * A provider Arc makes no text with checks its key by a free read, at no cost: its voices
     * (ElevenLabs, MiniMax), its avatars (HeyGen), or its balance (Kling).
     */
    private async checkByList(base: AiConnectionForm, replaced: boolean, p: AiPresetInfo): Promise<void> {
        try {
            const r = p.makesPresenters ? await this.service.avatars(base.id, true)
                : p.makesSpeech ? await this.service.voices(base.id, true)
                    : await this.service.refreshBalance(base.id);
            if (r.ok) {
                this.phase.set('done');
                this.key.set('');
                this.connected.emit({ connection: { ...base, lastOkAt: new Date().toISOString(), lastError: null }, model: '', replaced });
                return;
            }
            this.saved.emit({ ...base, lastError: r.detail });
            this.fail(failureAdvice(undefined, r.detail), r.detail);
        } catch (err: any) {
            this.fail('advice_other', err?.message ?? '');
        }
    }

    private fail(advice: string, detail: string): void {
        this.advice.set(advice);
        this.detail.set(detail);
        this.phase.set('failed');
    }
}

/** A model that answers in text (data is text with a schema), which Test can ask its question. */
function isTextModel(m: AiPresetModel): boolean {
    return (m.makes ?? 'text') === 'text';
}
