/**
 * Settings, AI (docs/features/ai.html): test or live, the providers with their keys, the
 * models of each tier, each purpose's choices, the monthly budget, the month's usage and the
 * calls. Written for an admin doing this the first time: a checklist says what is left, a
 * provider is connected step by step with the provider's own instructions (ai-connect), and
 * "Use these models" fills the tiers with what Arc recommends. Keys go to the server and
 * come back only as a preview. Confirmations are in the page, never the browser's dialogs,
 * which some browsers close at once.
 *
 * Files (specs/ai-media-spec.md, AM1): a model makes text, pictures, speech, audio or video
 * and bills by its unit; the default lists of file models sit below the tiers; a purpose that
 * makes files says where they go, how long they stay and whether its cache is on; a call's
 * pictures, audio and video play in its details, read through readAiFile.
 */
import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { toSignal } from '@angular/core/rxjs-interop';
import { ArcTimePipe } from '../../../../core/time/arc-time.pipe';
import { injectT } from '../../../../core/i18n/inject-t';
import { AiConnectComponent, type AiConnected } from './ai-connect.component';
import { failureAdvice } from './ai-provider-guide';
import {
    AI_FILE_KINDS, AI_KINDS, AI_MODEL_KINDS, AI_TIERS, AI_UNITS, AiCallFile, AiCallRow, AiConnectionForm, AiFileKind, AiKind, AiModelKind, AiModelRef, AiMonthUsage,
    AiPresetInfo, AiPresetModel, AiPriceField, AiPurposeForm, AiPurposeInfo, AiReads, AiTotals, AiUnit,
    AiCallContent, AiSettingsForm, AiSettingsService, AiSetupInfo, AiTier, KEY_HEADERS, addressChanged, blankPurpose, callsCsv, emptyAiForm, isFileKind,
    modelKindFor, naturalUnit, presetNeedsKey, purposeKind, recommendedTiers, removalData, safeHeaderName,
} from './ai-settings.service';

type Tab = 'setup' | 'purposes' | 'usage' | 'calls';
/** How a provider stands, as its card says. */
export type ConnectionStatus = 'working' | 'error' | 'untested' | 'nokey';
const MAX_MODELS = 5;
const CONNECTION_TEST = 'arc-connection-test';
/** The most files of one call the page reads at once. */
const MAX_FILES_SHOWN = 6;
const TOKEN_PRICES: AiPriceField[] = ['priceIn', 'priceOut', 'priceCachedIn', 'priceCacheWrite'];
/** A model in use, for its details. */
type UsedModel = AiModelRef & { key: string };
/** A file of an open call, as the page has it. */
type FileView = { state: 'loading' | 'ready' | 'gone' | 'failed'; url?: string; type?: string; message?: string };

/** The last 12 months, newest first, as `yyyy-mm`. */
export function recentMonths(now = new Date(), count = 12): string[] {
    return Array.from({ length: count }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
}

/** A cost as people read it: cents and fractions of a cent for small sums. */
export function usd(n: number): string {
    if (!n) return '$0';
    // A short test or text call costs a few millionths of a dollar: say it cost something.
    if (n < 0.0001) return '< $0.0001';
    if (n < 0.01) return `$${n.toFixed(4)}`;
    return `$${n.toFixed(2)}`;
}

@Component({
    selector: 'arc-ai-settings',
    standalone: true,
    imports: [FormsModule, TranslocoPipe, DecimalPipe, ArcTimePipe, NgTemplateOutlet, AiConnectComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="settings-section">
            <h3 class="mb-2">{{ 'admin.settings.ai.title' | transloco }}</h3>
            <p class="text-muted mb-3">{{ 'admin.settings.ai.intro' | transloco }}</p>

            @if (loadError()) {
                <div class="alert alert-danger">{{ 'admin.settings.ai.load_failed' | transloco }} {{ loadError() }}</div>
            } @else if (!loaded() || !setup()) {
                <p class="text-muted loading"><i class="fas fa-spinner fa-spin me-2"></i>{{ 'admin.settings.ai.loading' | transloco }}</p>
            } @else {
                <div class="mode mb-2 d-flex flex-wrap gap-2 align-items-center">
                    <label class="form-label mb-0 fw-semibold" for="aiMode">{{ 'admin.settings.ai.mode' | transloco }}</label>
                    <select id="aiMode" class="form-select w-auto" [ngModel]="form().mode" (ngModelChange)="patch({ mode: $event })">
                        <option value="test">{{ 'admin.settings.ai.mode_test' | transloco }}</option>
                        <option value="live">{{ 'admin.settings.ai.mode_live' | transloco }}</option>
                    </select>
                </div>
                @if (form().mode === 'test') {
                    <div class="alert alert-info d-flex gap-2 align-items-start test-note small">
                        <i class="fa-solid fa-flask mt-1"></i><span>{{ 'admin.settings.ai.test_note' | transloco }}</span>
                    </div>
                } @else if (!providerReady() || !modelsReady()) {
                    <div class="alert alert-warning d-flex gap-2 align-items-start live-warning small">
                        <i class="fa-solid fa-triangle-exclamation mt-1"></i><span>{{ 'admin.settings.ai.live_not_ready' | transloco }}</span>
                    </div>
                }

                <ul class="nav nav-tabs mb-3" role="tablist">
                    @for (t of tabs; track t) {
                        <li class="nav-item" role="presentation">
                            <button type="button" class="nav-link" role="tab" [class.active]="tab() === t" [attr.aria-selected]="tab() === t" (click)="openTab(t)">
                                {{ 'admin.settings.ai.tab_' + t | transloco }}
                            </button>
                        </li>
                    }
                </ul>

                @switch (tab()) {
                    @case ('setup') {
                        @if (nothingUsesAi()) {
                        <div class="alert alert-info mb-4 nothing-uses-ai" role="status">
                            <strong>{{ 'admin.settings.ai.nothing_uses_ai_title' | transloco }}</strong>
                            <div class="small">{{ 'admin.settings.ai.nothing_uses_ai' | transloco }}</div>
                        </div>
                        } @else {
                        <div class="checklist card mb-4">
                            <div class="card-body">
                                <h4 class="mt-0">{{ 'admin.settings.ai.get_started' | transloco }}</h4>
                                <ol class="list-unstyled mb-0">
                                    <li class="check" [class.done]="providerReady()">
                                        <i [class]="providerReady() ? 'fa-solid fa-circle-check' : 'fa-regular fa-circle'"></i>
                                        <div><strong>{{ 'admin.settings.ai.check_provider' | transloco }}</strong><div class="small text-muted">{{ 'admin.settings.ai.check_provider_hint' | transloco }}</div></div>
                                        @if (!providerReady() && !connecting()) { <button type="button" class="btn btn-sm btn-primary ms-auto" (click)="startConnect()">{{ 'admin.settings.ai.connect_button' | transloco }}</button> }
                                    </li>
                                    <li class="check" [class.done]="modelsReady()">
                                        <i [class]="modelsReady() ? 'fa-solid fa-circle-check' : 'fa-regular fa-circle'"></i>
                                        <div><strong>{{ 'admin.settings.ai.check_models' | transloco }}</strong><div class="small text-muted">{{ 'admin.settings.ai.check_models_hint' | transloco }}</div></div>
                                    </li>
                                    <li class="check" [class.done]="!unpricedModels().length">
                                        <i [class]="unpricedModels().length ? 'fa-solid fa-triangle-exclamation text-warning' : 'fa-solid fa-circle-check'"></i>
                                        <div><strong>{{ 'admin.settings.ai.check_budget' | transloco: { budget: money(form().monthlyUsd) } }}</strong>
                                            @if (unpricedModels().length) {
                                                <div class="small text-warning-emphasis unpriced-warning">{{ 'admin.settings.ai.unpriced_warning' | transloco: { models: unpricedNames() } }}</div>
                                            } @else {
                                                <div class="small text-muted">{{ 'admin.settings.ai.check_budget_hint' | transloco }}</div>
                                            }
                                        </div>
                                    </li>
                                    <li class="check" [class.done]="savedLive()">
                                        <i [class]="savedLive() ? 'fa-solid fa-circle-check' : 'fa-regular fa-circle'"></i>
                                        <div><strong>{{ 'admin.settings.ai.check_live' | transloco }}</strong><div class="small text-muted">{{ 'admin.settings.ai.check_live_hint' | transloco }}</div></div>
                                    </li>
                                </ol>
                            </div>
                        </div>
                        }

                        <h4>{{ 'admin.settings.ai.providers' | transloco }}</h4>
                        <p class="text-muted small">{{ 'admin.settings.ai.providers_hint' | transloco }}</p>
                        @if (!form().connections.length && !connecting()) {
                            <p class="small no-providers">{{ 'admin.settings.ai.no_providers' | transloco }}</p>
                        }
                        @if (notice(); as n) {
                            <div class="alert d-flex flex-wrap gap-2 align-items-center small notice" role="status" [class.alert-success]="n.ok" [class.alert-danger]="!n.ok">
                                <span class="me-auto">{{ n.text }}</span>
                                @if (n.recommendFor) {
                                    <button type="button" class="btn btn-sm btn-success" (click)="useRecommended(n.recommendFor)">{{ 'admin.settings.ai.use_recommended' | transloco }}</button>
                                }
                            </div>
                        }

                        @for (c of form().connections; track c.id) {
                            <div class="card mb-3 connection" [attr.data-id]="c.id">
                                <div class="card-body">
                                    <div class="d-flex justify-content-between align-items-start gap-2 flex-wrap">
                                        <div>
                                            <strong>{{ c.label || preset(c.preset)?.label }}</strong>
                                            @if (c.label && c.label !== preset(c.preset)?.label) { <span class="small text-muted ms-1">({{ preset(c.preset)?.label }})</span> }
                                            <div class="small"><i class="fa-solid fa-location-dot me-1"></i>{{ 'admin.settings.ai.processes_in' | transloco: { place: processesIn(c) } }}</div>
                                            @if (untested(c.id)) {
                                                <div class="small text-muted untested-live-hint">{{ 'admin.settings.ai.not_tested_live_hint' | transloco: { date: preset(c.preset)?.docsReadOn ?? '' } }}</div>
                                            }
                                        </div>
                                        <div class="d-flex flex-wrap gap-1 justify-content-end">
                                            @if (untested(c.id)) { <span class="badge text-bg-light border untested-live">{{ 'admin.settings.ai.not_tested_live' | transloco }}</span> }
                                            <span class="badge status" [class]="'status-' + status(c)">{{ 'admin.settings.ai.status_' + status(c) | transloco }}</span>
                                        </div>
                                    </div>

                                    @if (needsKey(c)) {
                                        <div class="small mt-2 key-line">
                                            @if (c.keyPreview) {
                                                <i class="fa-solid fa-key me-1"></i>{{ 'admin.settings.ai.key_set' | transloco: { preview: c.keyPreview, by: c.keySetBy ?? '', on: (c.keySetAt | arcTime: 'date') } }}
                                            } @else {
                                                <i class="fa-solid fa-key me-1 text-muted"></i>{{ 'admin.settings.ai.no_key' | transloco }}
                                            }
                                        </div>
                                    }
                                    @if (preset(c.preset)?.readsBalance) {
                                        <div class="small mt-1 d-flex flex-wrap align-items-center gap-2 balance-line" [class.text-danger]="lowOnBalance(c)">
                                            <span><i class="fa-solid fa-wallet me-1"></i>
                                                @if (!c.balanceAt) { {{ 'admin.settings.ai.balance_not_read' | transloco }} }
                                                @else if (c.balance === null) { {{ 'admin.settings.ai.balance_no_limit' | transloco: { on: (c.balanceAt | arcTime: 'dateTime') } }} }
                                                @else { {{ 'admin.settings.ai.balance' | transloco: { amount: (c.balance | number: '1.0-4'), unit: c.balanceUnit ?? '', on: (c.balanceAt | arcTime: 'dateTime') } }} }
                                            </span>
                                            <button type="button" class="btn btn-link btn-sm p-0 refresh-balance" (click)="refreshBalance(c)" [disabled]="refreshing() === c.id || (needsKey(c) && !c.keyPreview)">
                                                @if (refreshing() === c.id) { <i class="fas fa-spinner fa-spin me-1"></i> } @else { <i class="fa-solid fa-rotate me-1"></i> }{{ 'admin.settings.ai.refresh' | transloco }}
                                            </button>
                                        </div>
                                    } @else if (preset(c.preset)?.billingUrl) {
                                        <div class="small mt-1 billing-line">
                                            <a [href]="preset(c.preset)?.billingUrl" target="_blank" rel="noopener"><i class="fa-solid fa-wallet me-1"></i>{{ 'admin.settings.ai.billing' | transloco }} <i class="fa-solid fa-arrow-up-right-from-square small"></i></a>
                                        </div>
                                    }
                                    @if (needsRate(c)) {
                                        <div class="small text-warning-emphasis mt-1 rate-warning"><i class="fa-solid fa-triangle-exclamation me-1"></i>{{ 'admin.settings.ai.rate_missing' | transloco: { currency: currency(c) } }}</div>
                                    }
                                    @if (c.lastError) {
                                        <div class="small text-danger mt-1 card-error">
                                            <i class="fa-solid fa-circle-exclamation me-1"></i>{{ 'admin.settings.ai.' + advice(c.lastError) | transloco: { name: c.label || preset(c.preset)?.label } }}
                                            <details><summary>{{ 'admin.settings.ai.details' | transloco }}</summary><code class="small">{{ c.lastError }}</code></details>
                                        </div>
                                    } @else if (c.lastOkAt) {
                                        <div class="small text-success mt-1"><i class="fa-solid fa-circle-check me-1"></i>{{ 'admin.settings.ai.last_ok' | transloco: { on: (c.lastOkAt | arcTime: 'dateTime') } }}</div>
                                    }

                                    <div class="d-flex flex-wrap gap-2 mt-3 actions">
                                        @if (needsKey(c)) {
                                            <button type="button" class="btn btn-sm btn-primary set-key" (click)="startReplace(c)">
                                                <i class="fa-solid fa-key me-1"></i>{{ (c.keyPreview ? 'admin.settings.ai.replace_key' : 'admin.settings.ai.set_key') | transloco }}
                                            </button>
                                        }
                                        <button type="button" class="btn btn-sm btn-outline-secondary test" (click)="test(c)" [disabled]="testing() === c.id || (needsKey(c) && !c.keyPreview)">
                                            @if (testing() === c.id) { <i class="fas fa-spinner fa-spin me-1"></i> } @else { <i class="fa-solid fa-vial me-1"></i> }
                                            {{ 'admin.settings.ai.test_with' | transloco: { model: testModel(c) } }}
                                        </button>
                                        <button type="button" class="btn btn-sm btn-outline-secondary" (click)="toggleDetails(c.id)">
                                            <i class="fa-solid fa-sliders me-1"></i>{{ 'admin.settings.ai.edit' | transloco }}
                                        </button>
                                        <button type="button" class="btn btn-sm btn-outline-danger ms-auto remove" (click)="askRemove(c.id)">
                                            <i class="fa-solid fa-trash me-1"></i>{{ 'admin.settings.ai.remove' | transloco }}
                                        </button>
                                    </div>
                                    @if (testResults()[c.id]; as r) {
                                        <div class="small mt-2" role="status" [class.text-success]="r.ok" [class.text-danger]="!r.ok">{{ r.text }}</div>
                                    }

                                    @if (removing() === c.id) {
                                        <div class="alert alert-danger mt-3 mb-0 small confirm-remove">
                                            <div class="mb-2">{{ 'admin.settings.ai.remove_confirm' | transloco: { name: c.label || c.id } }}</div>
                                            <button type="button" class="btn btn-sm btn-danger me-2 confirm-yes" (click)="removeConnection(c)">{{ 'admin.settings.ai.remove_yes' | transloco }}</button>
                                            <button type="button" class="btn btn-sm btn-outline-secondary" (click)="removing.set(null)">{{ 'admin.settings.ai.cancel' | transloco }}</button>
                                        </div>
                                    }

                                    @if (detailsOpen() === c.id) {
                                        <div class="row g-2 mt-2 details">
                                            <div class="col-sm-6">
                                                <label class="form-label small mb-1" [for]="'aiName-' + c.id">{{ 'admin.settings.ai.name' | transloco }}</label>
                                                <input class="form-control form-control-sm" [id]="'aiName-' + c.id" [ngModel]="c.label" (ngModelChange)="patchConnection(c.id, { label: $event })" />
                                            </div>
                                            @if (preset(c.preset)?.needsWorkspace) {
                                                <div class="col-sm-6">
                                                    <label class="form-label small mb-1" [for]="'aiWs-' + c.id">{{ 'admin.settings.ai.workspace' | transloco }}</label>
                                                    <input class="form-control form-control-sm" [id]="'aiWs-' + c.id" [ngModel]="c.workspace" (ngModelChange)="patchConnection(c.id, { workspace: $event })" />
                                                </div>
                                            }
                                            @if (preset(c.preset)?.needsAddress) {
                                                <div class="col-sm-6">
                                                    <label class="form-label small mb-1" [for]="'aiUrl-' + c.id">{{ 'admin.settings.ai.address' | transloco }}</label>
                                                    <input class="form-control form-control-sm" [id]="'aiUrl-' + c.id" placeholder="https://api.example.com/v1" [ngModel]="c.baseUrl" (ngModelChange)="patchConnection(c.id, { baseUrl: $event })" />
                                                </div>
                                                <div class="col-sm-6">
                                                    <label class="form-label small mb-1" [for]="'aiWhere-' + c.id">{{ 'admin.settings.ai.where' | transloco }}</label>
                                                    <input class="form-control form-control-sm" [id]="'aiWhere-' + c.id" [ngModel]="c.processesIn" (ngModelChange)="patchConnection(c.id, { processesIn: $event })" />
                                                </div>
                                            }
                                            @if (preset(c.preset)?.kind === 'vertex') {
                                                <div class="col-sm-6">
                                                    <label class="form-label small mb-1" [for]="'aiLoc-' + c.id">{{ 'admin.settings.ai.location' | transloco }}</label>
                                                    <input class="form-control form-control-sm" [id]="'aiLoc-' + c.id" [placeholder]="setup()?.defaultVertexLocation ?? ''" [ngModel]="c.location" (ngModelChange)="patchConnection(c.id, { location: $event })" />
                                                    <small class="text-muted">{{ 'admin.settings.ai.location_hint' | transloco }}</small>
                                                </div>
                                            }
                                            @if (c.preset === 'other') {
                                                <div class="col-sm-6">
                                                    <label class="form-label small mb-1" [for]="'aiHeader-' + c.id">{{ 'admin.settings.ai.key_header' | transloco }}</label>
                                                    <select class="form-select form-select-sm key-header" [id]="'aiHeader-' + c.id" [ngModel]="headerChoice(c)" (ngModelChange)="setHeaderChoice(c, $event)">
                                                        @for (h of keyHeaders; track h) { <option [value]="h">{{ h || 'Authorization: Bearer' }}</option> }
                                                        <option value="custom">{{ 'admin.settings.ai.key_header_custom' | transloco }}</option>
                                                    </select>
                                                </div>
                                                @if (headerChoice(c) === 'custom') {
                                                    <div class="col-sm-6">
                                                        <label class="form-label small mb-1" [for]="'aiHeaderName-' + c.id">{{ 'admin.settings.ai.key_header_name' | transloco }}</label>
                                                        <input class="form-control form-control-sm header-name" [id]="'aiHeaderName-' + c.id" autocomplete="off" spellcheck="false" placeholder="x-my-key"
                                                            [ngModel]="c.header" (ngModelChange)="patchConnection(c.id, { header: $event.trim().toLowerCase() })" />
                                                        @if (!headerOk(c)) { <small class="text-danger header-invalid">{{ 'admin.settings.ai.header_invalid' | transloco }}</small> }
                                                    </div>
                                                }
                                            }
                                            <div class="col-6 col-sm-3">
                                                <label class="form-label small mb-1" [for]="'aiPerMin-' + c.id">{{ 'admin.settings.ai.per_minute' | transloco }}</label>
                                                <input type="number" min="1" step="1" class="form-control form-control-sm per-minute" [id]="'aiPerMin-' + c.id"
                                                    [placeholder]="limitPlaceholder(c, 'perMinute')" [ngModel]="c.perMinute" (ngModelChange)="setLimit(c.id, 'perMinute', $event)" />
                                            </div>
                                            <div class="col-6 col-sm-3">
                                                <label class="form-label small mb-1" [for]="'aiAtOnce-' + c.id">{{ 'admin.settings.ai.at_once' | transloco }}</label>
                                                <input type="number" min="1" step="1" class="form-control form-control-sm at-once" [id]="'aiAtOnce-' + c.id"
                                                    [placeholder]="limitPlaceholder(c, 'atOnce')" [ngModel]="c.atOnce" (ngModelChange)="setLimit(c.id, 'atOnce', $event)" />
                                            </div>
                                            <small class="text-muted col-12">{{ 'admin.settings.ai.limits_hint' | transloco }}</small>
                                            @if (currency(c) !== 'USD') {
                                                <div class="col-sm-6">
                                                    <label class="form-label small mb-1" [for]="'aiRate-' + c.id">{{ 'admin.settings.ai.usd_rate' | transloco: { currency: currency(c) } }}</label>
                                                    <input type="number" min="0" step="any" class="form-control form-control-sm usd-rate" [id]="'aiRate-' + c.id"
                                                        [ngModel]="c.usdRate" (ngModelChange)="setAmount(c.id, 'usdRate', $event, 1000)" />
                                                    <small class="text-muted">{{ 'admin.settings.ai.usd_rate_hint' | transloco: { currency: currency(c) } }}</small>
                                                </div>
                                            }
                                            @if (preset(c.preset)?.readsBalance) {
                                                <div class="col-sm-6">
                                                    <label class="form-label small mb-1" [for]="'aiLow-' + c.id">{{ 'admin.settings.ai.low_balance' | transloco }}</label>
                                                    <input type="number" min="0" step="any" class="form-control form-control-sm low-balance" [id]="'aiLow-' + c.id"
                                                        [ngModel]="c.lowBalance" (ngModelChange)="setAmount(c.id, 'lowBalance', $event, 1e12)" />
                                                    <small class="text-muted">{{ 'admin.settings.ai.low_balance_hint' | transloco }}</small>
                                                </div>
                                            }
                                            @if (c.preset === 'other') {
                                                <small class="text-muted col-12">{{ 'admin.settings.ai.address_header_change_note' | transloco }}</small>
                                            } @else if (preset(c.preset)?.needsWorkspace || preset(c.preset)?.needsAddress) {
                                                <small class="text-muted col-12">{{ 'admin.settings.ai.address_change_note' | transloco }}</small>
                                            }
                                        </div>
                                    }

                                    @if (replacing() === c.id) {
                                        <div class="mt-3">
                                            <arc-ai-connect [presets]="setup()!.presets" [existing]="c" [defaultLocation]="setup()!.defaultVertexLocation"
                                                (saved)="onSaved($event)" (connected)="onConnected($event)" (cancel)="replacing.set(null)" />
                                        </div>
                                    }
                                </div>
                            </div>
                        }

                        @if (connecting()) {
                            <arc-ai-connect [presets]="setup()!.presets" [takenIds]="connectionIds()" [defaultLocation]="setup()!.defaultVertexLocation"
                                (saved)="onSaved($event)" (connected)="onConnected($event)" (cancel)="connecting.set(false)" />
                        } @else {
                            <button type="button" class="btn btn-outline-primary mb-4 add-provider" (click)="startConnect()">
                                <i class="fa-solid fa-plus me-1"></i>{{ 'admin.settings.ai.connect_a_provider' | transloco }}
                            </button>
                        }

                        <h4>{{ 'admin.settings.ai.models' | transloco }}</h4>
                        <p class="text-muted small">{{ 'admin.settings.ai.models_hint' | transloco }}</p>
                        @for (r of recommendations(); track r.connection.id) {
                            <div class="recommend border rounded p-2 mb-3 small">
                                <div class="fw-semibold mb-1">{{ 'admin.settings.ai.recommended_for' | transloco: { name: r.connection.label || r.preset.label } }}</div>
                                @for (t of tiers; track t) {
                                    @if (r.tiers[t].length) { <div>{{ 'admin.settings.ai.tier_' + t | transloco }}: <code>{{ modelNames(r.tiers[t]) }}</code></div> }
                                }
                                <button type="button" class="btn btn-sm btn-success mt-2 use-recommended" (click)="useRecommended(r.connection.id)">{{ 'admin.settings.ai.use_recommended' | transloco }}</button>
                            </div>
                        }
                        @for (t of tiers; track t) {
                            <div class="mb-3 tier" [attr.data-tier]="t">
                                <div class="fw-semibold">{{ 'admin.settings.ai.tier_' + t | transloco }}</div>
                                <small class="text-muted d-block mb-1">{{ 'admin.settings.ai.tier_' + t + '_hint' | transloco }}</small>
                                <ng-container *ngTemplateOutlet="modelList; context: { $implicit: form().tiers[t], set: tierSetter(t), kind: 'text' }" />
                            </div>
                        }
                        @if (shownLists().length) {
                            <h4>{{ 'admin.settings.ai.lists_title' | transloco }}</h4>
                            <p class="text-muted small">{{ 'admin.settings.ai.lists_hint' | transloco }}</p>
                            @for (k of shownLists(); track k) {
                                <div class="mb-3 kind-list" [attr.data-kind]="k">
                                    <div class="fw-semibold mb-1">{{ 'admin.settings.ai.list_' + k | transloco }}</div>
                                    <ng-container *ngTemplateOutlet="modelList; context: { $implicit: form().lists[k], set: listSetter(k), kind: k }" />
                                </div>
                            }
                        }

                        @if (usedModels().length) {
                            <button type="button" class="btn btn-link btn-sm px-0 mb-2 advanced-toggle" (click)="showAdvanced.set(!showAdvanced())">
                                <i class="fa-solid me-1" [class.fa-chevron-right]="!showAdvanced()" [class.fa-chevron-down]="showAdvanced()"></i>{{ 'admin.settings.ai.model_details' | transloco }}
                                @if (unpricedModels().length) { <span class="badge text-bg-warning ms-1">{{ 'admin.settings.ai.unpriced_badge' | transloco: { n: unpricedModels().length } }}</span> }
                            </button>
                            @if (showAdvanced()) {
                                <p class="text-muted small">{{ 'admin.settings.ai.model_details_hint' | transloco }}</p>
                                <div class="table-responsive mb-4">
                                    <table class="table table-sm align-middle model-details">
                                        <thead><tr>
                                            <th>{{ 'admin.settings.ai.model' | transloco }}</th>
                                            <th>{{ 'admin.settings.ai.makes' | transloco }}</th>
                                            <th>{{ 'admin.settings.ai.bills_by' | transloco }}</th>
                                            <th>{{ 'admin.settings.ai.reads' | transloco }}</th>
                                            <th>{{ 'admin.settings.ai.shape' | transloco }}</th>
                                            <th>{{ 'admin.settings.ai.prices' | transloco }}</th>
                                        </tr></thead>
                                        <tbody>
                                            @for (m of usedModels(); track m.key) {
                                                <tr [attr.data-key]="m.key">
                                                    <td><code>{{ m.model }}</code>
                                                        <div class="small text-muted">{{ connectionLabel(m.connection) }}</div>
                                                        @if (untested(m.connection)) { <span class="badge text-bg-light border untested-live">{{ 'admin.settings.ai.not_tested_live' | transloco }}</span> }
                                                        @if (pricesCheckedOn(m.connection)) { <div class="small text-muted">{{ 'admin.settings.ai.prices_checked' | transloco: { date: pricesCheckedOn(m.connection) } }}</div> }
                                                        @if (connectionCurrency(m.connection) !== 'USD') { <div class="small text-muted">{{ 'admin.settings.ai.prices_in_currency' | transloco: { currency: connectionCurrency(m.connection) } }}</div> }
                                                    </td>
                                                    <td>
                                                        <select class="form-select form-select-sm makes-select" [attr.aria-label]="'admin.settings.ai.makes' | transloco" [ngModel]="makesOf(m)" (ngModelChange)="setMakes(m, $event)">
                                                            @for (k of modelKinds; track k) { <option [value]="k">{{ 'admin.settings.ai.kind_' + k | transloco }}</option> }
                                                        </select>
                                                    </td>
                                                    <td>
                                                        <select class="form-select form-select-sm unit-select" [attr.aria-label]="'admin.settings.ai.bills_by' | transloco" [ngModel]="unitOf(m)" (ngModelChange)="patchModel(m.key, { unit: $event })">
                                                            @for (u of units; track u) { <option [value]="u">{{ 'admin.settings.ai.unit_' + u | transloco }}</option> }
                                                        </select>
                                                    </td>
                                                    @if (makesOf(m) === 'text') {
                                                    <td class="text-nowrap">
                                                        <label class="form-check form-check-inline small mb-0">
                                                            <input type="checkbox" class="form-check-input" [ngModel]="reads(m.key, m.connection, m.model, 'pictures')" (ngModelChange)="setReads(m.key, m.connection, m.model, 'pictures', $event)" />{{ 'admin.settings.ai.pictures' | transloco }}
                                                        </label>
                                                        <label class="form-check form-check-inline small mb-0">
                                                            <input type="checkbox" class="form-check-input" [ngModel]="reads(m.key, m.connection, m.model, 'pdfs')" (ngModelChange)="setReads(m.key, m.connection, m.model, 'pdfs', $event)" />PDF
                                                        </label>
                                                    </td>
                                                    <td>
                                                        <select class="form-select form-select-sm shape-select" [attr.aria-label]="'admin.settings.ai.shape' | transloco" [ngModel]="shape(m.key, m.connection, m.model)" (ngModelChange)="patchModel(m.key, { schema: $event })">
                                                            <option value="json">{{ 'admin.settings.ai.shape_json' | transloco }}</option>
                                                            <option value="strict">{{ 'admin.settings.ai.shape_strict' | transloco }}</option>
                                                        </select>
                                                    </td>
                                                    } @else { <td></td><td></td> }
                                                    <td>
                                                        <div class="d-flex flex-wrap gap-1 prices">
                                                            @for (f of priceFields(m); track f) {
                                                                <label class="small mb-0">
                                                                    <span class="d-block text-muted text-nowrap">{{ 'admin.settings.ai.' + priceLabel(m, f) | transloco }}</span>
                                                                    <input type="number" min="0" step="0.001" class="form-control form-control-sm price" [attr.data-field]="f"
                                                                        [placeholder]="knownPrice(m.connection, m.model, f)" [ngModel]="adminPrice(m.key, f)" (ngModelChange)="setPrice(m.key, f, $event)" />
                                                                </label>
                                                            }
                                                        </div>
                                                    </td>
                                                </tr>
                                            }
                                        </tbody>
                                    </table>
                                </div>
                            }
                        }

                        <h4 id="aiBudget">{{ 'admin.settings.ai.budget' | transloco }}</h4>
                        <div class="input-group mb-1 budget">
                            <span class="input-group-text">USD</span>
                            <input type="number" min="0" step="1" class="form-control" [attr.aria-label]="'admin.settings.ai.budget' | transloco" [ngModel]="form().monthlyUsd" (ngModelChange)="setBudget($event)" />
                        </div>
                        <small class="text-muted d-block mb-4">{{ 'admin.settings.ai.budget_hint' | transloco }}</small>
                    }

                    @case ('purposes') {
                        @if (!setup()?.purposes?.length) {
                            <p class="text-muted no-purposes">{{ 'admin.settings.ai.no_purposes' | transloco }}</p>
                        }
                        @for (p of setup()?.purposes ?? []; track p.id) {
                            <div class="card mb-3 purpose" [attr.data-id]="p.id">
                                <div class="card-body">
                                    <div class="d-flex justify-content-between align-items-start gap-2">
                                        <div>
                                            <strong>{{ p.label }}</strong>
                                            <span class="badge text-bg-light border ms-1 kind-badge">{{ kindLabel(kindOf(p)) }}</span>
                                            @if (p.description) { <div class="small text-muted">{{ p.description }}</div> }
                                        </div>
                                        <div class="form-check form-switch">
                                            <input type="checkbox" class="form-check-input" role="switch" [id]="'aiOn-' + p.id" [ngModel]="purpose(p.id).enabled" (ngModelChange)="patchPurpose(p.id, { enabled: $event })" />
                                            <label class="form-check-label" [for]="'aiOn-' + p.id">{{ 'admin.settings.ai.on' | transloco }}</label>
                                        </div>
                                    </div>
                                    <div class="small mt-2">{{ takes(p) }}</div>
                                    @if (isFile(p)) {
                                        <div class="small mb-2 files-go">
                                            @if (p.saveTo) { {{ 'admin.settings.ai.files_to_app' | transloco: { path: p.saveTo } }} }
                                            @else { {{ 'admin.settings.ai.files_to_arc' | transloco }} }
                                        </div>
                                    } @else {
                                        <div class="small mb-2">{{ (p.output === 'data' ? 'admin.settings.ai.gives_data' : 'admin.settings.ai.gives_text') | transloco }}</div>
                                    }

                                    <label class="form-label small mb-1" [for]="'aiUse-' + p.id">{{ 'admin.settings.ai.which_models' | transloco }}</label>
                                    <select class="form-select form-select-sm w-auto mb-2" [id]="'aiUse-' + p.id" [ngModel]="purpose(p.id).models.length ? 'own' : 'tier'" (ngModelChange)="useOwnModels(p, $event === 'own')">
                                        @if (isFile(p)) {
                                            <option value="tier">{{ 'admin.settings.ai.list_' + kindOf(p) | transloco }}</option>
                                        } @else {
                                            <option value="tier">{{ 'admin.settings.ai.use_tier' | transloco: { tier: ('admin.settings.ai.tier_' + p.tier | transloco) } }}</option>
                                        }
                                        <option value="own">{{ 'admin.settings.ai.use_own' | transloco }}</option>
                                    </select>
                                    @if (purpose(p.id).models.length) {
                                        <ng-container *ngTemplateOutlet="modelList; context: { $implicit: purpose(p.id).models, set: purposeSetter(p.id), kind: modelKindOf(p) }" />
                                    }

                                    <!-- Only a purpose whose calls carry a key can have an allowance per key. -->
                                    @if (p.perKeyPerDay !== null) {
                                        <div class="row g-2 mt-1">
                                            <div class="col-sm-6">
                                                <label class="form-label small mb-1" [for]="'aiAllow-' + p.id">{{ 'admin.settings.ai.allowance' | transloco: { who: who(p) } }} ({{ 'admin.settings.ai.unit_' + (p.allowanceIn ?? 'calls') | transloco }})</label>
                                                <input type="number" min="1" step="1" class="form-control form-control-sm" [id]="'aiAllow-' + p.id"
                                                    [placeholder]="p.perKeyPerDay" [ngModel]="purpose(p.id).perKeyPerDay" (ngModelChange)="setAllowance(p.id, $event)" />
                                                <small class="text-muted">{{ 'admin.settings.ai.allowance_hint' | transloco: { n: p.perKeyPerDay, who: who(p) } }}</small>
                                            </div>
                                        </div>
                                    }
                                    @if (isFile(p)) {
                                        @if (!p.saveTo) {
                                            <div class="row g-2 mt-1">
                                                <div class="col-sm-6">
                                                    <label class="form-label small mb-1" [for]="'aiDelete-' + p.id">{{ 'admin.settings.ai.delete_after' | transloco }}</label>
                                                    <input type="number" min="1" max="3650" step="1" class="form-control form-control-sm delete-after" [id]="'aiDelete-' + p.id"
                                                        [placeholder]="p.deleteAfterDays ?? ''" [ngModel]="purpose(p.id).deleteAfterDays" (ngModelChange)="setDeleteAfter(p.id, $event)" />
                                                    <small class="text-muted">{{ (p.deleteAfterDays ? 'admin.settings.ai.delete_after_hint_app' : 'admin.settings.ai.delete_after_hint_none') | transloco: { n: p.deleteAfterDays } }}</small>
                                                </div>
                                            </div>
                                        }
                                        @if ((p.cacheDays ?? 0) > 0) {
                                            <div class="form-check form-switch mt-3">
                                                <input type="checkbox" class="form-check-input cache-switch" role="switch" [id]="'aiCache-' + p.id" [ngModel]="purpose(p.id).cache !== false" (ngModelChange)="patchPurpose(p.id, { cache: $event ? null : false })" />
                                                <label class="form-check-label" [for]="'aiCache-' + p.id">{{ 'admin.settings.ai.cache' | transloco }}</label>
                                                <small class="d-block text-muted">{{ 'admin.settings.ai.cache_hint' | transloco: { days: p.cacheDays } }}</small>
                                            </div>
                                        }
                                    }
                                    <div class="form-check form-switch mt-3">
                                        <input type="checkbox" class="form-check-input" role="switch" [id]="'aiKeep-' + p.id" [ngModel]="purpose(p.id).keepContent" (ngModelChange)="patchPurpose(p.id, { keepContent: $event })" />
                                        <label class="form-check-label" [for]="'aiKeep-' + p.id">{{ 'admin.settings.ai.keep_content' | transloco }}</label>
                                        <small class="d-block" [class.text-danger]="purpose(p.id).keepContent" [class.text-muted]="!purpose(p.id).keepContent">{{ 'admin.settings.ai.keep_content_hint' | transloco }}</small>
                                    </div>
                                </div>
                            </div>
                        }
                    }

                    @case ('usage') {
                        <div class="d-flex flex-wrap gap-2 align-items-center mb-3">
                            <label class="form-label mb-0" for="aiMonth">{{ 'admin.settings.ai.month' | transloco }}</label>
                            <select id="aiMonth" class="form-select form-select-sm w-auto" [ngModel]="month()" (ngModelChange)="loadUsage($event)">
                                @for (m of months; track m) { <option [value]="m">{{ m }}</option> }
                            </select>
                            <button type="button" class="btn btn-sm btn-outline-secondary ms-auto csv" (click)="downloadCsv()" [disabled]="busy()">
                                <i class="fa-solid fa-download me-1"></i>{{ 'admin.settings.ai.download' | transloco }}
                            </button>
                        </div>
                        @if (usageState() === 'loading' && !usage()) { <p class="text-muted"><i class="fas fa-spinner fa-spin me-1"></i>{{ 'admin.settings.ai.loading' | transloco }}</p> }
                        @if (usageState() === 'failed') { <p class="text-danger" role="alert">{{ 'admin.settings.ai.usage_failed' | transloco }}</p> }
                        @if (csvMessage()) { <p class="small" role="status">{{ csvMessage() }}</p> }
                        @if (usage(); as u) {
                            <div class="row g-2 mb-3 totals">
                                <div class="col-6 col-md-3"><div class="stat"><div class="small text-muted">{{ 'admin.settings.ai.cost' | transloco }}</div><div class="fs-5">{{ money(u.costUsd) }}</div>
                                    <div class="small text-muted">{{ 'admin.settings.ai.of_budget' | transloco: { budget: money(form().monthlyUsd) } }}</div>
                                    <div class="progress mt-1" role="progressbar" [attr.aria-valuenow]="budgetShare()" aria-valuemin="0" aria-valuemax="100"><div class="progress-bar" [class.bg-danger]="budgetShare() >= 80" [style.width.%]="budgetShare()"></div></div></div></div>
                                <div class="col-6 col-md-3"><div class="stat"><div class="small text-muted">{{ 'admin.settings.ai.calls' | transloco }}</div><div class="fs-5">{{ u.calls | number }}</div><div class="small text-muted">{{ 'admin.settings.ai.failed_count' | transloco: { n: u.failed } }}</div>
                                    @if (u.cacheHits) { <div class="small text-muted cache-hits">{{ 'admin.settings.ai.cache_hits' | transloco: { n: (u.cacheHits | number) } }}</div> }</div></div>
                                <div class="col-6 col-md-3"><div class="stat"><div class="small text-muted">{{ 'admin.settings.ai.tokens' | transloco }}</div><div class="fs-5">{{ u.tokensIn | number }} / {{ u.tokensOut | number }}</div><div class="small text-muted">{{ 'admin.settings.ai.in_out' | transloco }}</div>
                                    @if (u.tokensCached) { <div class="small text-muted tokens-cached">{{ 'admin.settings.ai.tokens_cached_count' | transloco: { n: (u.tokensCached | number) } }}</div> }
                                    @if (amounts(u)) { <div class="small text-muted amounts">{{ amounts(u) }}</div> }</div></div>
                                <div class="col-6 col-md-3"><div class="stat"><div class="small text-muted">{{ 'admin.settings.ai.test_calls' | transloco }}</div><div class="fs-5">{{ u.testCalls | number }}</div></div></div>
                            </div>
                            @if (!u.calls && !u.testCalls) { <p class="text-muted">{{ 'admin.settings.ai.no_usage' | transloco }}</p> }
                            @else if (!u.calls) { <p class="text-muted small">{{ 'admin.settings.ai.only_test_usage' | transloco }}</p> }
                            @for (table of usageTables(u); track table.title) {
                                @if (table.rows.length) {
                                    <h4>{{ table.title | transloco }}</h4>
                                    <div class="table-responsive mb-3">
                                        <table class="table table-sm usage-table" [attr.data-table]="table.title">
                                            <thead><tr><th>{{ table.first | transloco }}</th><th class="text-end">{{ 'admin.settings.ai.calls' | transloco }}</th>
                                                @if (table.cols.cache) { <th class="text-end">{{ 'admin.settings.ai.from_cache' | transloco }}</th> }
                                                <th class="text-end">{{ 'admin.settings.ai.failed' | transloco }}</th><th class="text-end">{{ 'admin.settings.ai.tokens_in' | transloco }}</th>
                                                @if (table.cols.cached) { <th class="text-end">{{ 'admin.settings.ai.tokens_cached' | transloco }}</th> }
                                                <th class="text-end">{{ 'admin.settings.ai.tokens_out' | transloco }}</th>
                                                @if (table.cols.amounts) { <th class="text-end">{{ 'admin.settings.ai.amount' | transloco }}</th> }
                                                <th class="text-end">{{ 'admin.settings.ai.cost' | transloco }}</th></tr></thead>
                                            <tbody>
                                                @for (r of table.rows; track r.name) {
                                                    <tr><td>{{ r.name }}</td><td class="text-end">{{ r.calls | number }}</td>
                                                        @if (table.cols.cache) { <td class="text-end">{{ r.cacheHits | number }}</td> }
                                                        <td class="text-end">{{ r.failed | number }}</td><td class="text-end">{{ r.tokensIn | number }}</td>
                                                        @if (table.cols.cached) { <td class="text-end">{{ r.tokensCached | number }}</td> }
                                                        <td class="text-end">{{ r.tokensOut | number }}</td>
                                                        @if (table.cols.amounts) { <td class="text-end">{{ amounts(r) }}</td> }
                                                        <td class="text-end">{{ money(r.costUsd) }}</td></tr>
                                                }
                                            </tbody>
                                        </table>
                                    </div>
                                }
                            }
                        }
                    }

                    @case ('calls') {
                        <div class="d-flex flex-wrap gap-2 mb-2">
                            <select class="form-select form-select-sm w-auto" [attr.aria-label]="'admin.settings.ai.filter_purpose' | transloco" [ngModel]="callPurpose()" (ngModelChange)="callPurpose.set($event)">
                                <option value="">{{ 'admin.settings.ai.all_purposes' | transloco }}</option>
                                @for (id of callPurposes(); track id) { <option [value]="id">{{ purposeLabel(id) }}</option> }
                            </select>
                            <select class="form-select form-select-sm w-auto" [attr.aria-label]="'admin.settings.ai.filter_outcome' | transloco" [ngModel]="callOutcome()" (ngModelChange)="callOutcome.set($event)">
                                <option value="">{{ 'admin.settings.ai.all_outcomes' | transloco }}</option>
                                <option value="ok">{{ 'admin.settings.ai.answered' | transloco }}</option>
                                <option value="failed">{{ 'admin.settings.ai.failed' | transloco }}</option>
                            </select>
                            <button type="button" class="btn btn-sm btn-outline-secondary" (click)="loadCalls()"><i class="fa-solid fa-rotate me-1"></i>{{ 'admin.settings.ai.refresh' | transloco }}</button>
                        </div>
                        <p class="text-muted small">{{ 'admin.settings.ai.calls_hint' | transloco }}</p>
                        @if (callsState() === 'loading') { <p class="text-muted"><i class="fas fa-spinner fa-spin me-1"></i>{{ 'admin.settings.ai.loading' | transloco }}</p> }
                        @else if (callsState() === 'failed') { <p class="text-danger" role="alert">{{ 'admin.settings.ai.calls_failed' | transloco }}</p> }
                        @else if (!shownCalls().length) { <p class="text-muted no-calls">{{ 'admin.settings.ai.no_calls' | transloco }}</p> }
                        <div class="list-group calls">
                            @for (c of shownCalls(); track c.id) {
                                <button type="button" class="list-group-item list-group-item-action call" [class.active-call]="openCall() === c.id" (click)="toggleCall(c.id)">
                                    <div class="d-flex flex-wrap gap-2 align-items-center small">
                                        <span class="text-muted">{{ c.createdAt | arcTime: 'dateTime' }}</span>
                                        <strong>{{ purposeLabel(c.purpose) }}</strong>
                                        <span class="badge text-bg-light border kind-badge">{{ kindLabel(c.kind) }}</span>
                                        @if (c.cached) { <span class="badge text-bg-secondary from-cache">{{ 'admin.settings.ai.from_cache' | transloco }}</span> }
                                        <span class="badge" [class.text-bg-success]="c.outcome === 'ok'" [class.text-bg-danger]="c.outcome !== 'ok'">{{ c.outcome === 'ok' ? ('admin.settings.ai.answered' | transloco) : c.outcome }}</span>
                                        @if (c.test) { <span class="badge text-bg-info">{{ 'admin.settings.ai.test_badge' | transloco }}</span> }
                                        <span class="text-muted">{{ c.model ?? '' }}</span>
                                        <span class="ms-auto">{{ c.unit !== 'tokens' && c.amount ? amountText(c.amount, c.unit) : (c.tokensIn | number) + ' / ' + (c.tokensOut | number) }} · {{ money(c.costUsd) }} · {{ c.ms / 1000 | number: '1.1-1' }} s</span>
                                    </div>
                                </button>
                                @if (openCall() === c.id) {
                                    <div class="call-details border rounded p-2 mb-2 small">
                                        @if (c.detail) { <div class="text-danger mb-1">{{ c.detail }}</div> }
                                        <div>{{ 'admin.settings.ai.input_size' | transloco: { chars: (c.input.chars | number), files: c.input.files, kb: (c.input.bytes / 1024 | number: '1.0-0') } }}</div>
                                        @if (c.limitKey) { <div>{{ 'admin.settings.ai.key_units' | transloco: { key: keyName(c.purpose, c.limitKey), units: c.units } }}</div> }
                                        @if (c.ref) { <div><code>{{ c.ref }}</code></div> }
                                        @if (c.cachedFrom) { <div class="cached-from">{{ 'admin.settings.ai.cached_from' | transloco: { id: c.cachedFrom } }}</div> }
                                        @if (c.tokensCached || c.tokensCacheWrite) { <div>{{ 'admin.settings.ai.call_cached_tokens' | transloco: { read: (c.tokensCached | number), write: (c.tokensCacheWrite | number) } }}</div> }
                                        @for (a of c.attempts; track $index) {
                                            <div>{{ $index + 1 }}. {{ connectionLabel(a.connection) }}, {{ a.model }}: {{ a.outcome }} ({{ a.ms / 1000 | number: '1.1-1' }} s){{ a.detail ? ', ' + a.detail : '' }}</div>
                                        }
                                        @if (c.hasContent && !openContent()) { <div class="text-muted mt-2"><i class="fas fa-spinner fa-spin me-1"></i>{{ 'admin.settings.ai.loading_content' | transloco }}</div> }
                                        @if (openContent(); as k) {
                                            <div class="fw-semibold mt-2">{{ 'admin.settings.ai.instruction' | transloco }}</div><pre class="kept">{{ k.instruction }}</pre>
                                            @for (part of k.parts; track $index) {
                                                @if (part.kind === 'text') { <pre class="kept">{{ part.text }}</pre> }
                                                @else {
                                                    <div>{{ part.mimeType }}, {{ (part.size ?? 0) / 1024 | number: '1.0-0' }} KB
                                                        @if (part.path) { <a href="#" class="ms-1" (click)="openFile($event, part.path)">{{ 'admin.settings.ai.open' | transloco }}</a> }
                                                    </div>
                                                }
                                            }
                                            <div class="fw-semibold mt-2">{{ 'admin.settings.ai.answer' | transloco }}</div><pre class="kept">{{ k.answer ?? '' }}</pre>
                                        }
                                        @if (c.files.length) {
                                            <div class="fw-semibold mt-2">{{ 'admin.settings.ai.files_made' | transloco }}</div>
                                            @for (f of c.files; track f.path; let i = $index) {
                                                <div class="made-file mb-2" [attr.data-path]="f.path">
                                                    <div class="text-muted">{{ fileLine(f) }}</div>
                                                    @if (i < maxFilesShown) {
                                                        @switch (fileViews()[f.path]?.state) {
                                                            @case ('ready') {
                                                                @if (fileViews()[f.path].type?.startsWith('image/')) { <img class="made-picture" [src]="fileViews()[f.path].url" [alt]="f.path" /> }
                                                                @else if (fileViews()[f.path].type?.startsWith('audio/')) { <audio class="made-audio" controls [src]="fileViews()[f.path].url"></audio> }
                                                                @else if (fileViews()[f.path].type?.startsWith('video/')) { <video class="made-video" controls [src]="fileViews()[f.path].url"></video> }
                                                                @else { <a [href]="fileViews()[f.path].url" target="_blank" rel="noopener">{{ 'admin.settings.ai.open' | transloco }}</a> }
                                                            }
                                                            @case ('gone') { <div class="text-danger file-gone">{{ 'admin.settings.ai.file_moved' | transloco }}</div> }
                                                            @case ('failed') { <div class="text-danger file-failed">{{ fileViews()[f.path].message }}</div> }
                                                            @default { <div class="text-muted"><i class="fas fa-spinner fa-spin me-1"></i>{{ 'admin.settings.ai.loading' | transloco }}</div> }
                                                        }
                                                    }
                                                </div>
                                            }
                                        }
                                        @if (fileMessage()) { <div class="text-danger">{{ fileMessage() }}</div> }
                                    </div>
                                }
                            }
                        </div>
                    }
                }

                @if (tab() === 'setup' || tab() === 'purposes') {
                    <div class="save-bar d-flex flex-wrap align-items-center gap-3 mt-2">
                        <button class="btn btn-primary save" (click)="save()" [disabled]="saving() || !unsaved() || !!formProblem()">
                            @if (saving()) { <i class="fas fa-spinner fa-spin me-1"></i> {{ 'common.actions.saving' | transloco }} }
                            @else { <i class="fas fa-save me-1"></i> {{ 'admin.settings.ai.save' | transloco }} }
                        </button>
                        @if (formProblem()) { <span class="text-danger small form-problem">{{ formProblem() | transloco }}</span> }
                        @else if (saveMessage()) { <span role="status" [class.text-success]="!saveFailed()" [class.text-danger]="saveFailed()">{{ saveMessage() }}</span> }
                        @else if (unsaved()) { <span class="text-warning-emphasis small unsaved"><i class="fa-solid fa-circle-exclamation me-1"></i>{{ 'admin.settings.ai.unsaved' | transloco }}</span> }
                    </div>
                }
            }
        </div>

        <ng-template #modelList let-list let-set="set" let-kind="kind">
            @for (r of list; track $index; let i = $index) {
                <div class="d-flex flex-wrap gap-1 mb-1 model-row">
                    <select class="form-select form-select-sm conn" [attr.aria-label]="'admin.settings.ai.provider' | transloco" [ngModel]="r.connection" (ngModelChange)="set(replaced(list, i, { connection: $event, model: r.model }))">
                        @for (c of form().connections; track c.id) { <option [value]="c.id">{{ c.label || c.id }}</option> }
                    </select>
                    <input class="form-control form-control-sm model" [attr.list]="'aiModels-' + r.connection + '-' + kind" [attr.aria-label]="'admin.settings.ai.model' | transloco" [ngModel]="r.model" (ngModelChange)="set(replaced(list, i, { connection: r.connection, model: $event.trim() }))" />
                    @if (untested(r.connection)) { <span class="badge text-bg-light border align-self-center untested-live">{{ 'admin.settings.ai.not_tested_live' | transloco }}</span> }
                    <button type="button" class="btn btn-sm btn-outline-secondary" [disabled]="i === 0" (click)="set(moved(list, i, -1))" [attr.aria-label]="'admin.settings.ai.move_up' | transloco"><i class="fa-solid fa-arrow-up"></i></button>
                    <button type="button" class="btn btn-sm btn-outline-secondary" (click)="set(without(list, i))" [attr.aria-label]="'admin.settings.ai.remove' | transloco"><i class="fa-solid fa-xmark"></i></button>
                </div>
            }
            @if (!form().connections.length) {
                <small class="text-muted d-block">{{ 'admin.settings.ai.connect_first' | transloco }}</small>
            } @else if (list.length < maxModels) {
                <button type="button" class="btn btn-sm btn-link px-0 add-model" (click)="set(added(list, kind))"><i class="fa-solid fa-plus me-1"></i>{{ 'admin.settings.ai.add_model' | transloco }}</button>
            }
        </ng-template>
        @for (c of form().connections; track c.id) {
            @for (k of modelKinds; track k) {
                <datalist [id]="'aiModels-' + c.id + '-' + k">
                    @for (m of modelChoices(c.id, k); track m) { <option [value]="m" [attr.label]="untested(c.id) ? ('admin.settings.ai.not_tested_live' | transloco) : null"></option> }
                </datalist>
            }
        }
    `,
    styles: [`
        .settings-section { max-width: 860px; }
        h3 { font-size: 1.25rem; font-weight: 600; color: #212529; }
        h4 { font-size: 1rem; font-weight: 600; margin: 1.25rem 0 0.5rem; }
        .budget { max-width: 220px; }
        .price { width: 6.5rem; }
        /* Long option texts must not push a select past a phone's width. */
        .form-select.w-auto { max-width: 100%; }
        .model-row .conn { flex: 0 1 14rem; min-width: 9rem; }
        .model-row .model { flex: 1 1 12rem; min-width: 0; }
        .shape-select { min-width: 10rem; }
        .makes-select, .unit-select { min-width: 7.5rem; }
        .made-picture, .made-video { max-width: 100%; max-height: 24rem; border-radius: 0.25rem; display: block; }
        .made-audio { width: 100%; max-width: 28rem; }
        .nav-tabs { flex-wrap: nowrap; overflow-x: auto; overflow-y: hidden; }
        .nav-tabs .nav-link { white-space: nowrap; }
        .stat { border: 1px solid var(--bs-border-color); border-radius: 0.5rem; padding: 0.5rem 0.75rem; height: 100%; }
        .progress { height: 0.4rem; }
        pre.kept { white-space: pre-wrap; max-height: 16rem; overflow: auto; background: var(--bs-light); padding: 0.5rem; border-radius: 0.25rem; }
        .active-call { background: var(--bs-light); }
        .check { display: flex; align-items: flex-start; gap: 0.6rem; padding: 0.4rem 0; }
        .check > i { margin-top: 0.2rem; color: var(--bs-secondary-color); }
        .check.done > i { color: var(--bs-success); }
        .status-working { background: var(--bs-success); }
        .status-error { background: var(--bs-danger); }
        .status-untested { background: var(--bs-info); color: #000; }
        .status-nokey { background: var(--bs-warning); color: #000; }
        details summary { cursor: pointer; }
    `],
})
export class AiSettingsPage implements OnInit, OnDestroy {
    private readonly service = inject(AiSettingsService);
    private readonly t = injectT();
    private readonly transloco = inject(TranslocoService);
    private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

    readonly tabs: Tab[] = ['setup', 'purposes', 'usage', 'calls'];
    readonly tiers = AI_TIERS;
    readonly modelKinds = AI_MODEL_KINDS;
    readonly units = AI_UNITS;
    readonly keyHeaders = KEY_HEADERS;
    readonly maxModels = MAX_MODELS;
    readonly maxFilesShown = MAX_FILES_SHOWN;
    readonly months = recentMonths();

    readonly tab = signal<Tab>('setup');
    readonly setup = signal<AiSetupInfo | null>(null);
    readonly form = signal<AiSettingsForm>(emptyAiForm());
    readonly loaded = signal<AiSettingsForm | null>(null);
    readonly loadError = signal('');
    readonly saving = signal(false);
    readonly saveMessage = signal('');
    readonly saveFailed = signal(false);
    readonly busy = signal(false);
    readonly connecting = signal(false);
    readonly replacing = signal<string | null>(null);
    readonly removing = signal<string | null>(null);
    readonly detailsOpen = signal<string | null>(null);
    readonly showAdvanced = signal(false);
    readonly notice = signal<{ ok: boolean; text: string; recommendFor?: string } | null>(null);
    readonly testing = signal<string | null>(null);
    readonly testResults = signal<Record<string, { ok: boolean; text: string }>>({});
    readonly fileMessage = signal('');
    /** The connection whose balance is being read. */
    readonly refreshing = signal<string | null>(null);
    /** Other connections whose admin chose a custom key header, so its field shows while empty. */
    readonly customHeaders = signal<Record<string, boolean>>({});
    /** The files of the open call, by path: object URLs revoked when it closes. */
    readonly fileViews = signal<Record<string, FileView>>({});
    /** Counts each opening, so files read for a call since closed are let go. */
    private fileLoad = 0;

    readonly month = signal(this.months[0]);
    readonly usage = signal<AiMonthUsage | null>(null);
    readonly calls = signal<AiCallRow[]>([]);
    readonly callPurpose = signal('');
    readonly callOutcome = signal('');
    readonly openCall = signal<string | null>(null);
    readonly openContent = signal<AiCallContent | null>(null);
    readonly usageState = signal<'idle' | 'loading' | 'failed'>('idle');
    readonly callsState = signal<'idle' | 'loading' | 'failed'>('idle');
    readonly csvMessage = signal('');

    /** Whether the form differs from what is saved. */
    readonly unsaved = computed(() => {
        const loaded = this.loaded();
        return !loaded || JSON.stringify(this.form()) !== JSON.stringify(loaded);
    });
    readonly connectionIds = computed(() => this.form().connections.map((c) => c.id));
    /** The checklist: a provider that answered a test. */
    readonly providerReady = computed(() => this.form().connections.some((c) => this.status(c) === 'working'));
    /** The checklist: every tier a purpose uses has a model (Fast when the app has no purposes). */
    readonly modelsReady = computed(() => {
        const f = this.form();
        const purposes = this.setup()?.purposes ?? [];
        const own = (p: AiPurposeInfo) => !!f.purposes[p.id]?.models.length;
        const needed = new Set<AiTier>(purposes.filter((p) => !own(p) && !this.isFile(p)).map((p) => p.tier));
        const lists = new Set<AiFileKind>(purposes.filter((p) => !own(p) && this.isFile(p)).map((p) => this.kindOf(p) as AiFileKind));
        if (!purposes.length) needed.add('fast');
        return [...needed].every((t) => f.tiers[t].length > 0) && [...lists].every((k) => f.lists[k].length > 0);
    });
    readonly savedLive = computed(() => this.loaded()?.mode === 'live');
    /**
     * AI is on in every install, but only an app's own purposes use it. With none and no
     * provider, a first-time admin is told there is nothing to set up, not handed a checklist.
     */
    readonly nothingUsesAi = computed(() => {
        const setup = this.setup();
        return !!setup && !setup.purposes.length && !this.form().connections.length;
    });
    /** The providers Arc knows models of, with the tiers it recommends them for. */
    readonly recommendations = computed(() => this.form().connections.flatMap((c) => {
        const preset = this.preset(c.preset);
        if (!preset || !this.isSaved(c.id)) return [];
        const tiers = recommendedTiers(c.id, preset);
        if (!AI_TIERS.some((t) => tiers[t].length)) return [];
        const f = this.form();
        const already = AI_TIERS.every((t) => !tiers[t].length || JSON.stringify(f.tiers[t]) === JSON.stringify(tiers[t]));
        return already ? [] : [{ connection: c, preset, tiers }];
    }));
    readonly callPurposes = computed(() => [...new Set(this.calls().map((c) => c.purpose))].sort());
    readonly shownCalls = computed(() => this.calls().filter((c) =>
        (!this.callPurpose() || c.purpose === this.callPurpose())
        && (!this.callOutcome() || (this.callOutcome() === 'ok' ? c.outcome === 'ok' : c.outcome !== 'ok'))));
    readonly budgetShare = computed(() => {
        const u = this.usage();
        const b = this.form().monthlyUsd;
        if (!u || b <= 0) return u?.costUsd ? 100 : 0;
        return Math.min(100, Math.round((u.costUsd / b) * 100));
    });
    /**
     * The models in use whose cost the budget cannot count: no price known, and a provider that
     * does not report each call's cost. A call to one counts as 0 USD.
     */
    readonly unpricedModels = computed(() => this.usedModels().filter((m) => {
        const c = this.form().connections.find((x) => x.id === m.connection);
        if (!c || this.preset(c.preset)?.reportsCost) return false;
        // Prices in another currency count 0 until the admin gives its USD value (AM-D5).
        if (this.needsRate(c)) return true;
        const priced = (f: AiPriceField) => this.price(m, f) !== undefined;
        return this.unitOf(m) === 'tokens' ? !priced('priceIn') || !priced('priceOut') : !priced('price');
    }));
    readonly unpricedNames = computed(() => this.unpricedModels().map((m) => m.model).join(', '));
    /** Every model a tier, file list or purpose names, once, for its details. */
    readonly usedModels = computed(() => {
        const f = this.form();
        const all = [...AI_TIERS.flatMap((t) => f.tiers[t]), ...AI_FILE_KINDS.flatMap((k) => f.lists[k]), ...Object.values(f.purposes).flatMap((p) => p.models)].filter((r) => r.connection && r.model);
        const seen = new Map<string, UsedModel>();
        for (const r of all) seen.set(`${r.connection}/${r.model}`, { ...r, key: `${r.connection}/${r.model}` });
        return [...seen.values()];
    });

    /**
     * The file lists worth showing: those with models, those a purpose of the app uses, and
     * those some connection has a model for (known to Arc, or described by the admin).
     */
    readonly shownLists = computed(() => {
        const f = this.form();
        const kinds = new Set((this.setup()?.purposes ?? []).map((p) => this.kindOf(p)));
        return AI_FILE_KINDS.filter((k) => f.lists[k].length || kinds.has(k) || f.connections.some((c) => this.modelChoices(c.id, k).length));
    });
    /** What stops Save, as a translation key; '' when nothing does. */
    readonly formProblem = computed(() => (this.form().connections.some((c) => c.preset === 'other' && !this.headerOk(c)) ? 'admin.settings.ai.header_invalid' : ''));

    ngOnInit(): void {
        Promise.all([this.service.setup(), this.service.load()]).then(([setup, form]) => {
            this.setup.set(setup);
            this.form.set(form);
            this.loaded.set(structuredClone(form));
        }).catch((err) => {
            console.error('AI settings: load failed', err);
            this.loadError.set(err?.message ?? '');
        });
    }

    ngOnDestroy(): void {
        this.closeFiles();
    }

    openTab(t: Tab): void {
        this.tab.set(t);
        if (t === 'usage' && !this.usage()) void this.loadUsage(this.month());
        if (t === 'calls' && !this.calls().length) void this.loadCalls();
    }

    // ------------------------------------------------------------ providers

    patch(change: Partial<AiSettingsForm>): void {
        this.form.update((f) => ({ ...f, ...change }));
        this.saveMessage.set('');
    }

    preset(id: string): AiPresetInfo | undefined {
        return this.setup()?.presets.find((p) => p.id === id);
    }

    processesIn(c: AiConnectionForm): string {
        const p = this.preset(c.preset);
        if (!p) return '';
        if (p.kind === 'vertex') return `Google Cloud, ${c.location || this.setup()?.defaultVertexLocation || ''}`;
        if (p.needsAddress) return c.processesIn || p.processesIn;
        return p.processesIn;
    }

    /** Whether a connection's provider needs a key (every one but Vertex). */
    needsKey(c: AiConnectionForm): boolean {
        const p = this.preset(c.preset);
        return !!p && presetNeedsKey(p);
    }

    /** Whether a connection's provider was built from its docs and never called for real (AM-D34). */
    untested(connectionId: string): boolean {
        const c = this.form().connections.find((x) => x.id === connectionId);
        return !!c && this.preset(c.preset)?.testedLive === false;
    }

    currency(c: AiConnectionForm): string {
        return this.preset(c.preset)?.currency ?? 'USD';
    }

    connectionCurrency(connectionId: string): string {
        const c = this.form().connections.find((x) => x.id === connectionId);
        return c ? this.currency(c) : 'USD';
    }

    pricesCheckedOn(connectionId: string): string {
        const c = this.form().connections.find((x) => x.id === connectionId);
        return (c && this.preset(c.preset)?.pricesCheckedOn) || '';
    }

    /** Prices in another currency than USD, with no USD value set: they count 0. */
    needsRate(c: AiConnectionForm): boolean {
        return this.currency(c) !== 'USD' && c.usdRate === null;
    }

    lowOnBalance(c: AiConnectionForm): boolean {
        return c.balance !== null && c.lowBalance !== null && c.balance < c.lowBalance;
    }

    /** The preset's limit as the empty field's placeholder, else "No limit". */
    limitPlaceholder(c: AiConnectionForm, which: 'perMinute' | 'atOnce'): string {
        const n = this.preset(c.preset)?.[which];
        return typeof n === 'number' ? String(n) : this.t('admin.settings.ai.no_limit');
    }

    /** A limit: a whole number, 0 for none at all, or empty for the preset's. */
    setLimit(id: string, which: 'perMinute' | 'atOnce', value: unknown): void {
        const n = Number(value);
        const max = which === 'perMinute' ? 100_000 : 1000;
        this.patchConnection(id, { [which]: value === null || value === '' || !Number.isInteger(n) || n < 0 || n > max ? null : n });
    }

    /** A USD rate or a low mark: a number from 0, or empty for none. */
    setAmount(id: string, which: 'usdRate' | 'lowBalance', value: unknown, max: number): void {
        const n = Number(value);
        this.patchConnection(id, { [which]: value === null || value === '' || !Number.isFinite(n) || n < 0 || n > max ? null : n });
    }

    /** Other's key header as its select shows it: one of the list, or custom. */
    headerChoice(c: AiConnectionForm): string {
        return this.customHeaders()[c.id] || !(KEY_HEADERS as readonly string[]).includes(c.header) ? 'custom' : c.header;
    }

    setHeaderChoice(c: AiConnectionForm, choice: string): void {
        const custom = choice === 'custom';
        this.customHeaders.update((x) => ({ ...x, [c.id]: custom }));
        this.patchConnection(c.id, { header: custom ? '' : choice });
    }

    /** Whether Other's header can be saved: Bearer, or a name the server takes. */
    headerOk(c: AiConnectionForm): boolean {
        if (this.customHeaders()[c.id] && !c.header) return false;
        return !c.header || safeHeaderName(c.header);
    }

    /** Reads a connection's balance now, with its own key, and shows it as saved. */
    async refreshBalance(c: AiConnectionForm): Promise<void> {
        this.refreshing.set(c.id);
        try {
            const r = await this.service.refreshBalance(c.id);
            if (r.ok) {
                this.onSaved({ ...c, balance: r.balance, balanceUnit: r.unit, balanceAt: new Date().toISOString() });
                this.testResults.update((x) => { const { [c.id]: _, ...rest } = x; return rest; });
            } else {
                this.testResults.update((x) => ({ ...x, [c.id]: { ok: false, text: this.t('admin.settings.ai.balance_failed', { detail: r.detail }) } }));
            }
        } catch (err: any) {
            console.error('AI settings: balance not read', err);
            this.testResults.update((x) => ({ ...x, [c.id]: { ok: false, text: this.t('admin.settings.ai.balance_failed', { detail: err?.message ?? '' }) } }));
        } finally {
            this.refreshing.set(null);
        }
    }

    status(c: AiConnectionForm): ConnectionStatus {
        if (this.needsKey(c) && !c.keyPreview) return 'nokey';
        if (c.lastError) return 'error';
        return c.lastOkAt ? 'working' : 'untested';
    }

    /** What to do about a provider's last error, as a translation key. */
    advice(detail: string): string {
        return failureAdvice(undefined, detail);
    }

    connectionLabel(id: string): string {
        const c = this.form().connections.find((x) => x.id === id);
        return c ? c.label || this.preset(c.preset)?.label || id : id;
    }

    isSaved(id: string): boolean {
        return !!this.loaded()?.connections.some((c) => c.id === id);
    }

    startConnect(): void {
        this.notice.set(null);
        this.replacing.set(null);
        this.connecting.set(true);
    }

    startReplace(c: AiConnectionForm): void {
        this.notice.set(null);
        this.connecting.set(false);
        this.replacing.set(this.replacing() === c.id ? null : c.id);
    }

    toggleDetails(id: string): void {
        this.detailsOpen.update((open) => (open === id ? null : id));
    }

    /** The server has more of a connection (saved, a key's preview, a test's error): show it, as saved. */
    onSaved(c: AiConnectionForm): void {
        const upsert = (list: AiConnectionForm[]) => (list.some((x) => x.id === c.id) ? list.map((x) => (x.id === c.id ? { ...x, ...c } : x)) : [...list, c]);
        this.form.update((f) => ({ ...f, connections: upsert(f.connections) }));
        this.loaded.update((l) => l && { ...l, connections: upsert(l.connections) });
    }

    onConnected(e: AiConnected): void {
        this.onSaved(e.connection);
        this.connecting.set(false);
        this.replacing.set(null);
        const preset = this.preset(e.connection.preset);
        const rec = preset ? recommendedTiers(e.connection.id, preset) : null;
        const hasRecommendations = !!rec && AI_TIERS.some((t) => rec[t].length > 0);
        this.notice.set({
            ok: true,
            text: this.t('admin.settings.ai.connected_notice', { name: e.connection.label || preset?.label || e.connection.id, model: e.model }),
            recommendFor: hasRecommendations && !this.modelsReady() ? e.connection.id : undefined,
        });
    }

    patchConnection(id: string, change: Partial<AiConnectionForm>): void {
        this.patch({ connections: this.form().connections.map((c) => (c.id === id ? { ...c, ...change } : c)) });
    }

    askRemove(id: string): void {
        this.removing.set(this.removing() === id ? null : id);
    }

    /**
     * Takes a provider away with its key, from every list that named it, and saves just that,
     * so other changes on the page stay unsaved until Save.
     */
    async removeConnection(c: AiConnectionForm): Promise<void> {
        this.removing.set(null);
        const loaded = this.loaded();
        if (!loaded) return;
        const without = (f: AiSettingsForm): AiSettingsForm => {
            const drop = (list: AiModelRef[]) => list.filter((r) => r.connection !== c.id);
            return {
                ...f,
                connections: f.connections.filter((x) => x.id !== c.id),
                tiers: Object.fromEntries(AI_TIERS.map((t) => [t, drop(f.tiers[t])])) as Record<AiTier, AiModelRef[]>,
                lists: Object.fromEntries(AI_FILE_KINDS.map((k) => [k, drop(f.lists[k])])) as Record<AiFileKind, AiModelRef[]>,
                purposes: Object.fromEntries(Object.entries(f.purposes).map(([id, p]) => [id, { ...p, models: drop(p.models) }])),
                models: Object.fromEntries(Object.entries(f.models).filter(([key]) => !key.startsWith(`${c.id}/`))),
            };
        };
        const savedAfter = without(loaded);
        try {
            if (c.keyPreview) await this.service.removeKey(c.id);
            await this.service.savePart(removalData(c.id, savedAfter, loaded));
        } catch (err: any) {
            console.error('AI settings: provider not removed', err);
            this.notice.set({ ok: false, text: this.t('admin.settings.ai.save_failed', { error: err?.message ?? '' }) });
            return;
        }
        this.form.update(without);
        this.loaded.set(savedAfter);
        this.notice.set({ ok: true, text: this.t('admin.settings.ai.removed_notice', { name: c.label || c.id }) });
    }

    /** The model a provider's Test uses (a text model: the test asks a question): one its tiers name, else the one Arc recommends first. */
    testModel(c: AiConnectionForm): string {
        const f = this.form();
        const named = [...AI_TIERS.flatMap((t) => f.tiers[t]), ...Object.values(f.purposes).flatMap((p) => p.models)]
            .find((r) => r.connection === c.id && r.model && this.makesOf({ ...r, key: `${r.connection}/${r.model}` }) === 'text');
        const text = (this.preset(c.preset)?.models ?? []).filter((m) => (m.makes ?? 'text') === 'text');
        return named?.model ?? text.find((m) => m.recommend?.length)?.model ?? text[0]?.model ?? '';
    }

    async test(c: AiConnectionForm): Promise<void> {
        const model = this.testModel(c);
        if (!model) {
            this.testResults.update((x) => ({ ...x, [c.id]: { ok: false, text: this.t('admin.settings.ai.test_needs_model') } }));
            return;
        }
        this.testing.set(c.id);
        try {
            const r = await this.service.test(c.id, model);
            const name = c.label || this.preset(c.preset)?.label || c.id;
            const text = r.ok
                ? r.costFrom === 'none'
                    ? this.t('admin.settings.ai.test_ok_unpriced', { s: (r.ms / 1000).toFixed(1), reply: r.reply ?? '' })
                    : this.t('admin.settings.ai.test_ok', { s: (r.ms / 1000).toFixed(1), reply: r.reply ?? '', cost: usd(r.costUsd ?? 0) })
                : this.transloco.translate(`admin.settings.ai.${failureAdvice(r.failure, r.detail)}`, { name });
            this.testResults.update((x) => ({ ...x, [c.id]: { ok: r.ok, text } }));
            this.onSaved(r.ok ? { ...c, lastError: null, lastOkAt: new Date().toISOString() } : { ...c, lastError: r.detail ?? r.failure ?? null });
        } catch (err: any) {
            this.testResults.update((x) => ({ ...x, [c.id]: { ok: false, text: this.t('admin.settings.ai.advice_other', { name: c.label || this.preset(c.preset)?.label || c.id }) } }));
            console.error('AI settings: test failed', err);
        } finally {
            this.testing.set(null);
        }
    }

    // ------------------------------------------------------------ models

    modelNames(list: AiModelRef[]): string {
        return list.map((r) => r.model).join(', ');
    }

    /** Puts the provider's recommended models in the tiers it has them for, and saves. */
    async useRecommended(connectionId: string): Promise<void> {
        const c = this.form().connections.find((x) => x.id === connectionId);
        const preset = c && this.preset(c.preset);
        if (!c || !preset) return;
        const loaded = this.loaded();
        if (!loaded) return;
        const rec = recommendedTiers(c.id, preset);
        // Built on the saved tiers, and only the tiers are saved: other changes stay unsaved until Save.
        const savedTiers = Object.fromEntries(AI_TIERS.map((t) => [t, rec[t].length ? rec[t] : loaded.tiers[t]])) as Record<AiTier, AiModelRef[]>;
        try {
            await this.service.savePart({ tiers: savedTiers });
        } catch (err: any) {
            this.notice.set({ ok: false, text: this.t('admin.settings.ai.save_failed', { error: err?.message ?? '' }) });
            return;
        }
        this.form.update((f) => ({ ...f, tiers: Object.fromEntries(AI_TIERS.map((t) => [t, rec[t].length ? rec[t] : f.tiers[t]])) as Record<AiTier, AiModelRef[]> }));
        this.loaded.set({ ...loaded, tiers: savedTiers });
        this.notice.set({ ok: true, text: this.t('admin.settings.ai.models_set_notice', { name: c.label || preset.label }) });
    }

    tierSetter(t: AiTier): (list: AiModelRef[]) => void {
        return (list) => this.patch({ tiers: { ...this.form().tiers, [t]: list } });
    }

    listSetter(k: AiFileKind): (list: AiModelRef[]) => void {
        return (list) => this.patch({ lists: { ...this.form().lists, [k]: list } });
    }

    /**
     * The models a connection offers for a kind: those Arc knows that make it, and those the
     * admin described as making it, so a file list or purpose offers only fitting models.
     */
    modelChoices(connectionId: string, kind: AiModelKind): string[] {
        const c = this.form().connections.find((x) => x.id === connectionId);
        if (!c) return [];
        const known = (this.preset(c.preset)?.models ?? []).filter((m) => (this.form().models[`${c.id}/${m.model}`]?.makes ?? m.makes ?? 'text') === kind).map((m) => m.model);
        const described = Object.entries(this.form().models)
            .filter(([key, m]) => key.startsWith(`${c.id}/`) && m.makes === kind)
            .map(([key]) => key.slice(c.id.length + 1));
        return [...new Set([...known, ...described])];
    }

    purposeSetter(id: string): (list: AiModelRef[]) => void {
        return (list) => this.patchPurpose(id, { models: list });
    }

    replaced(list: AiModelRef[], i: number, r: AiModelRef): AiModelRef[] {
        return list.map((x, j) => (j === i ? r : x));
    }

    moved(list: AiModelRef[], i: number, by: number): AiModelRef[] {
        const next = [...list];
        const [item] = next.splice(i, 1);
        next.splice(Math.max(0, i + by), 0, item);
        return next;
    }

    without(list: AiModelRef[], i: number): AiModelRef[] {
        return list.filter((_, j) => j !== i);
    }

    /** A new row: the first connection with a model of the kind, and that model. */
    added(list: AiModelRef[], kind: AiModelKind = 'text'): AiModelRef[] {
        const all = this.form().connections;
        const c = all.find((x) => this.modelChoices(x.id, kind).length) ?? all[0];
        return [...list, { connection: c.id, model: this.modelChoices(c.id, kind)[0] ?? '' }];
    }

    // ------------------------------------------------------------ purposes

    purpose(id: string): AiPurposeForm {
        return this.form().purposes[id] ?? blankPurpose();
    }

    kindOf(p: AiPurposeInfo): AiKind {
        return purposeKind(p);
    }

    modelKindOf(p: AiPurposeInfo): AiModelKind {
        return modelKindFor(purposeKind(p));
    }

    isFile(p: AiPurposeInfo): boolean {
        return isFileKind(purposeKind(p));
    }

    /** A kind in words: Text, Data, Pictures, Speech, Audio or Video. */
    kindLabel(kind: string): string {
        return (AI_KINDS as readonly string[]).includes(kind) ? this.transloco.translate(`admin.settings.ai.kind_${kind}`) : kind;
    }

    purposeLabel(id: string): string {
        if (id === CONNECTION_TEST) return this.t('admin.settings.ai.connection_test');
        return this.setup()?.purposes.find((p) => p.id === id)?.label ?? id;
    }

    /** What a purpose's limitKey is, in a word: the app's, else "user or business". */
    who(p: AiPurposeInfo): string {
        return p.limitKeyLabel ?? this.t('admin.settings.ai.allowance_who');
    }

    /** A limitKey as admins read it, such as "merchant b1" when the purpose names its keys. */
    keyName(purposeId: string, limitKey: string): string {
        const label = this.setup()?.purposes.find((p) => p.id === purposeId)?.limitKeyLabel;
        return label ? `${label} ${limitKey}` : limitKey;
    }

    patchPurpose(id: string, change: Partial<AiPurposeForm>): void {
        this.patch({ purposes: { ...this.form().purposes, [id]: { ...this.purpose(id), ...change } } });
    }

    /** Its own list starts as a copy of the tier's, or for a file kind the kind's list. */
    useOwnModels(p: AiPurposeInfo, own: boolean): void {
        const kind = this.kindOf(p);
        const from = isFileKind(kind) ? this.form().lists[kind] : this.form().tiers[p.tier];
        this.patchPurpose(p.id, { models: own ? (from.length ? [...from] : this.form().connections.length ? this.added([], modelKindFor(kind)) : []) : [] });
    }

    setDeleteAfter(id: string, value: unknown): void {
        const n = Number(value);
        this.patchPurpose(id, { deleteAfterDays: value === null || value === '' || !Number.isInteger(n) || n < 1 || n > 3650 ? null : n });
    }

    setAllowance(id: string, value: unknown): void {
        const n = Number(value);
        this.patchPurpose(id, { perKeyPerDay: value === null || value === '' || !Number.isInteger(n) || n < 1 ? null : n });
    }

    private n(value: number): string {
        return value.toLocaleString(this.lang() || 'en');
    }

    takes(p: AiPurposeInfo): string {
        const parts = [this.t('admin.settings.ai.takes_text', { n: this.n(p.maxChars) })];
        if (p.pictures) parts.push(this.t('admin.settings.ai.takes_pictures', { n: p.pictures.max, mb: p.pictures.maxMb }));
        if (p.pdfs) parts.push(this.t('admin.settings.ai.takes_pdfs', { n: p.pdfs.max, mb: p.pdfs.maxMb }));
        return `${this.t('admin.settings.ai.takes')} ${parts.join(', ')}`;
    }

    // ------------------------------------------------------------ model details

    private known(connection: string, model: string): AiPresetModel | undefined {
        const c = this.form().connections.find((x) => x.id === connection);
        return c ? this.preset(c.preset)?.models.find((m) => m.model === model) : undefined;
    }

    /** The file kind a list or file purpose implies for a model neither Arc nor the admin described. */
    private impliedKind(m: UsedModel): AiFileKind | undefined {
        const f = this.form();
        const named = (list: AiModelRef[]) => list.some((r) => r.connection === m.connection && r.model === m.model);
        const fromList = AI_FILE_KINDS.find((k) => named(f.lists[k]));
        if (fromList) return fromList;
        const p = (this.setup()?.purposes ?? []).find((x) => this.isFile(x) && named(f.purposes[x.id]?.models ?? []));
        return p ? (this.kindOf(p) as AiFileKind) : undefined;
    }

    /** What a model makes: the admin's word, else Arc's, else what its list implies, else text. */
    makesOf(m: UsedModel): AiModelKind {
        return this.form().models[m.key]?.makes ?? this.known(m.connection, m.model)?.makes ?? this.impliedKind(m) ?? 'text';
    }

    /** What a model bills by: the admin's word, else Arc's, else what its kind usually bills by. */
    unitOf(m: UsedModel): AiUnit {
        return this.form().models[m.key]?.unit ?? this.known(m.connection, m.model)?.unit ?? naturalUnit(this.makesOf(m));
    }

    /** A model's kind; for one Arc does not know, its unit follows. */
    setMakes(m: UsedModel, makes: AiModelKind): void {
        this.patchModel(m.key, this.known(m.connection, m.model) ? { makes } : { makes, unit: naturalUnit(makes) });
    }

    /** The price fields a model's unit needs: four per million tokens, else one per unit. */
    priceFields(m: UsedModel): AiPriceField[] {
        return this.unitOf(m) === 'tokens' ? TOKEN_PRICES : ['price'];
    }

    priceLabel(m: UsedModel, f: AiPriceField): string {
        if (f === 'price') return `price_per_${this.unitOf(m)}`;
        return { priceIn: 'price_in', priceOut: 'price_out', priceCachedIn: 'price_cached_in', priceCacheWrite: 'price_cache_write' }[f];
    }

    adminPrice(key: string, f: AiPriceField): number | null {
        return this.form().models[key]?.[f] ?? null;
    }

    /** A price as askAi counts it: the admin's, else Arc's. */
    private price(m: UsedModel, f: AiPriceField): number | undefined {
        return this.form().models[m.key]?.[f] ?? this.known(m.connection, m.model)?.[f];
    }

    /**
     * The form with the kind and unit filled in for each model Arc does not know that a file
     * list or file purpose names, so the server bills it as what it makes.
     */
    private withImpliedKinds(f: AiSettingsForm): AiSettingsForm {
        const models = { ...f.models };
        for (const m of this.usedModels()) {
            if (this.known(m.connection, m.model)) continue;
            const admin = models[m.key] ?? {};
            const makes = admin.makes ?? this.impliedKind(m);
            if (!makes || makes === 'text') continue;
            if (admin.makes === makes && admin.unit) continue;
            models[m.key] = { ...admin, makes, unit: admin.unit ?? naturalUnit(makes) };
        }
        return { ...f, models };
    }

    reads(key: string, connection: string, model: string, kind: AiReads): boolean {
        return (this.form().models[key]?.reads ?? this.known(connection, model)?.reads ?? []).includes(kind);
    }

    setReads(key: string, connection: string, model: string, kind: AiReads, on: boolean): void {
        const now = new Set(this.form().models[key]?.reads ?? this.known(connection, model)?.reads ?? []);
        if (on) now.add(kind); else now.delete(kind);
        this.patchModel(key, { reads: [...now] });
    }

    shape(key: string, connection: string, model: string): 'strict' | 'json' {
        return this.form().models[key]?.schema ?? this.known(connection, model)?.schema ?? 'json';
    }

    knownPrice(connection: string, model: string, which: AiPriceField): string {
        const c = this.form().connections.find((x) => x.id === connection);
        if (c && this.preset(c.preset)?.reportsCost) return this.t('admin.settings.ai.price_reported');
        const price = this.known(connection, model)?.[which];
        return price === undefined ? this.t('admin.settings.ai.no_price') : String(price);
    }

    setPrice(key: string, which: AiPriceField, value: unknown): void {
        const n = Number(value);
        const m = { ...(this.form().models[key] ?? {}) };
        if (value === null || value === '' || !Number.isFinite(n) || n < 0) delete m[which];
        else m[which] = n;
        this.patch({ models: { ...this.form().models, [key]: m } });
    }

    patchModel(key: string, change: Partial<AiSettingsForm['models'][string]>): void {
        this.patch({ models: { ...this.form().models, [key]: { ...(this.form().models[key] ?? {}), ...change } } });
    }

    /** An emptied field keeps the budget: 0 would stop every live call. */
    setBudget(value: unknown): void {
        if (value === null || value === '') return;
        const n = Number(value);
        if (Number.isFinite(n) && n >= 0) this.patch({ monthlyUsd: n });
    }

    /** Saves the form; false when it could not, with the reason shown beside the button. */
    async save(): Promise<boolean> {
        const loaded = this.loaded();
        if (!loaded) return false;
        if (this.formProblem()) return false;
        this.saving.set(true);
        this.saveFailed.set(false);
        try {
            this.form.set(this.withImpliedKinds(this.form()));
            await this.service.save(this.form(), loaded);
            // A new address, workspace or key header: the key set for the old one is not sent (save cleared its preview).
            const cleared = this.form().connections.map((c) => {
                const before = loaded.connections.find((l) => l.id === c.id);
                return before && addressChanged(before, c) ? { ...c, keyPreview: null, keySetAt: null, keySetBy: null, lastOkAt: null } : c;
            });
            this.form.update((f) => ({ ...f, connections: cleared }));
            this.loaded.set(structuredClone(this.form()));
            this.saveMessage.set(this.t('admin.settings.ai.saved'));
            return true;
        } catch (err: any) {
            console.error('AI settings: save failed', err);
            this.saveMessage.set(this.t('admin.settings.ai.save_failed', { error: err?.message ?? '' }));
            this.saveFailed.set(true);
            return false;
        } finally {
            this.saving.set(false);
        }
    }

    // ------------------------------------------------------------ usage and calls

    money(n: number): string {
        return usd(n);
    }

    async loadUsage(month: string): Promise<void> {
        this.month.set(month);
        this.usageState.set('loading');
        try {
            this.usage.set(await this.service.usage(month));
            this.usageState.set('idle');
        } catch (err) {
            console.error('AI settings: usage not loaded', err);
            this.usageState.set('failed');
        }
    }

    /**
     * The usage tables. A column for cache hits, cached input or amounts in other units shows
     * only in a table with some; cache hits are never added to the calls.
     */
    usageTables(u: AiMonthUsage): Array<{ title: string; first: string; cols: { cache: boolean; cached: boolean; amounts: boolean }; rows: Array<AiTotals & { name: string }> }> {
        const table = (title: string, first: string, rows: Array<AiTotals & { name: string }>) => ({
            title, first, rows,
            cols: { cache: rows.some((r) => r.cacheHits), cached: rows.some((r) => r.tokensCached), amounts: rows.some((r) => r.pictures || r.characters || r.seconds) },
        });
        return [
            table('admin.settings.ai.by_purpose', 'admin.settings.ai.purpose', u.byPurpose.map((r) => ({ ...r, name: this.purposeLabel(r.id) }))),
            table('admin.settings.ai.by_kind', 'admin.settings.ai.kind', u.byKind.map((r) => ({ ...r, name: this.kindLabel(r.kind) }))),
            table('admin.settings.ai.by_model', 'admin.settings.ai.model', u.byModel.map((r) => ({ ...r, name: `${this.connectionLabel(r.connection)}: ${r.model}` }))),
            table('admin.settings.ai.by_key', 'admin.settings.ai.key_column', u.keys.map((r) => ({ ...r, name: `${this.keyName(r.purpose, r.limitKey)} (${this.purposeLabel(r.purpose)})` }))),
            table('admin.settings.ai.by_day', 'admin.settings.ai.day', u.byDay.map((r) => ({ ...r, name: `${u.month}-${r.day}` }))),
        ];
    }

    /** An amount in its unit, such as "3 pictures" or "1,200 characters". */
    amountText(n: number, unit: string): string {
        if (unit !== 'pictures' && unit !== 'characters' && unit !== 'seconds') return `${this.n(n)} ${unit}`;
        return this.transloco.translate(`admin.settings.ai.amount_${unit}`, { n: this.n(n) });
    }

    /** What file kinds billed, in each unit: '' when none. */
    amounts(t: Pick<AiTotals, 'pictures' | 'characters' | 'seconds'>): string {
        return (['pictures', 'characters', 'seconds'] as const).filter((u) => t[u]).map((u) => this.amountText(t[u], u)).join(', ');
    }

    async loadCalls(): Promise<void> {
        this.closeFiles();
        this.openCall.set(null);
        this.callsState.set('loading');
        try {
            this.calls.set(await this.service.recentCalls());
            this.callsState.set('idle');
        } catch (err) {
            console.error('AI settings: calls not loaded', err);
            this.callsState.set('failed');
        }
    }

    async toggleCall(id: string): Promise<void> {
        this.fileMessage.set('');
        this.openContent.set(null);
        this.closeFiles();
        const opening = this.openCall() !== id;
        this.openCall.set(opening ? id : null);
        const call = this.calls().find((c) => c.id === id);
        if (opening && call?.files.length) void this.loadFiles(call);
        if (!opening || !call?.hasContent) return;
        try {
            const content = await this.service.callContent(id);
            if (this.openCall() === id) this.openContent.set(content);
        } catch (err) {
            console.error('AI settings: content not loaded', err);
            this.fileMessage.set(this.t('admin.settings.ai.content_failed'));
        }
    }

    /** A made file's line: its type, size, and its picture size or length. */
    fileLine(f: AiCallFile): string {
        const parts = [f.mimeType, `${this.n(Math.max(1, Math.round(f.bytes / 1024)))} KB`];
        if (f.width && f.height) parts.push(`${f.width} × ${f.height}`);
        if (f.seconds) parts.push(this.amountText(f.seconds, 'seconds'));
        return parts.join(', ');
    }

    /** Reads an open call's files through readAiFile, to show pictures and play audio and video in the page. */
    private async loadFiles(call: AiCallRow): Promise<void> {
        const load = this.fileLoad;
        const files = call.files.slice(0, MAX_FILES_SHOWN);
        this.fileViews.set(Object.fromEntries(files.map((f) => [f.path, { state: 'loading' } as FileView])));
        await Promise.all(files.map(async (f) => {
            let view: FileView;
            try {
                const { url, contentType } = await this.service.aiFileUrl(f.path);
                view = { state: 'ready', url, type: contentType || f.mimeType };
            } catch (err: any) {
                view = /not-found/.test(String(err?.code ?? ''))
                    ? { state: 'gone' }
                    : { state: 'failed', message: this.t('admin.settings.ai.file_failed', { detail: err?.message ?? '' }) };
            }
            // Closed, or another call opened, while it loaded: let the file go.
            if (this.fileLoad !== load || this.openCall() !== call.id) {
                if (view.url) URL.revokeObjectURL(view.url);
                return;
            }
            this.fileViews.update((v) => ({ ...v, [f.path]: view }));
        }));
    }

    /** Lets the open call's files go. */
    private closeFiles(): void {
        this.fileLoad++;
        for (const v of Object.values(this.fileViews())) if (v.url) URL.revokeObjectURL(v.url);
        this.fileViews.set({});
    }

    async openFile(event: Event, path: string | null | undefined): Promise<void> {
        event.preventDefault();
        if (!path) return;
        try {
            const url = await this.service.fileUrl(path);
            window.open(url, '_blank', 'noopener');
            setTimeout(() => URL.revokeObjectURL(url), 60_000);
        } catch {
            this.fileMessage.set(this.t('admin.settings.ai.file_gone'));
        }
    }

    async downloadCsv(): Promise<void> {
        this.busy.set(true);
        this.csvMessage.set('');
        try {
            const { rows, truncated } = await this.service.allCalls();
            if (truncated) this.csvMessage.set(this.t('admin.settings.ai.csv_truncated', { n: this.n(rows.length) }));
            const blob = new Blob([callsCsv(rows)], { type: 'text/csv;charset=utf-8' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `ai-calls-${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            URL.revokeObjectURL(a.href);
        } catch (err) {
            console.error('AI settings: CSV not made', err);
            this.csvMessage.set(this.t('admin.settings.ai.csv_failed'));
        } finally {
            this.busy.set(false);
        }
    }
}
