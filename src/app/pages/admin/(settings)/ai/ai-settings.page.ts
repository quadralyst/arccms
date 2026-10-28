/**
 * Settings, AI (docs/app/ai.html): test or live, the providers with their keys, the models
 * of each tier, each purpose's choices, the monthly budget, the month's usage and the calls.
 * An app's purposes come from its code (functions/src/custom/ai.ts); this page decides how
 * they run. Keys go to the server and come back only as a preview.
 */
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { ArcTimePipe } from '../../../../core/time/arc-time.pipe';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { injectT } from '../../../../core/i18n/inject-t';
import {
    AI_TIERS, AiCallRow, AiConnectionForm, AiModelRef, AiMonthUsage, AiPresetInfo, AiPurposeForm, AiPurposeInfo, AiReads,
    AiSettingsForm, AiSettingsService, AiSetupInfo, AiTier, callsCsv, connectionId, emptyAiForm,
} from './ai-settings.service';

type Tab = 'setup' | 'purposes' | 'usage' | 'calls';
const MAX_MODELS = 5;

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
    if (n < 0.01) return `$${n.toFixed(4)}`;
    return `$${n.toFixed(2)}`;
}

@Component({
    selector: 'arc-ai-settings',
    standalone: true,
    imports: [FormsModule, TranslocoPipe, DecimalPipe, ArcTimePipe, NgTemplateOutlet],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="settings-section">
            <h3 class="mb-2">{{ 'admin.settings.ai.title' | transloco }}</h3>
            <p class="text-muted mb-3">{{ 'admin.settings.ai.intro' | transloco }}</p>

            <div class="mode mb-3 d-flex flex-wrap gap-3 align-items-center">
                <label class="form-label mb-0" for="aiMode">{{ 'admin.settings.ai.mode' | transloco }}</label>
                <select id="aiMode" class="form-select w-auto" [ngModel]="form().mode" (ngModelChange)="patch({ mode: $event })">
                    <option value="test">{{ 'admin.settings.ai.mode_test' | transloco }}</option>
                    <option value="live">{{ 'admin.settings.ai.mode_live' | transloco }}</option>
                </select>
            </div>
            @if (form().mode === 'test') {
                <div class="alert alert-info d-flex gap-2 align-items-start test-note">
                    <i class="fa-solid fa-flask mt-1"></i><span>{{ 'admin.settings.ai.test_note' | transloco }}</span>
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

            @if (loadError()) {
                <div class="alert alert-danger">{{ 'admin.settings.ai.load_failed' | transloco }} {{ loadError() }}</div>
            }

            @switch (tab()) {
                @case ('setup') {
                    <h4>{{ 'admin.settings.ai.providers' | transloco }}</h4>
                    <p class="text-muted small">{{ 'admin.settings.ai.providers_hint' | transloco }}</p>
                    @for (c of form().connections; track c.id) {
                        <div class="card mb-3 connection" [attr.data-id]="c.id">
                            <div class="card-body">
                                <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
                                    <div>
                                        <strong>{{ c.label || preset(c.preset)?.label }}</strong>
                                        <div class="small text-muted">{{ preset(c.preset)?.label }}</div>
                                        <div class="small"><i class="fa-solid fa-location-dot me-1"></i>{{ 'admin.settings.ai.processes_in' | transloco: { place: processesIn(c) } }}</div>
                                    </div>
                                    <button type="button" class="btn btn-sm btn-outline-danger" (click)="removeConnection(c)" [attr.aria-label]="'admin.settings.ai.remove_provider' | transloco">
                                        <i class="fa-solid fa-trash"></i>
                                    </button>
                                </div>
                                <div class="row g-2 mb-2">
                                    <div class="col-sm-6">
                                        <label class="form-label small" [for]="'aiName-' + c.id">{{ 'admin.settings.ai.name' | transloco }}</label>
                                        <input class="form-control form-control-sm" [id]="'aiName-' + c.id" [ngModel]="c.label" (ngModelChange)="patchConnection(c.id, { label: $event })" />
                                    </div>
                                    @if (preset(c.preset)?.needsWorkspace) {
                                        <div class="col-sm-6">
                                            <label class="form-label small" [for]="'aiWs-' + c.id">{{ 'admin.settings.ai.workspace' | transloco }}</label>
                                            <input class="form-control form-control-sm" [id]="'aiWs-' + c.id" [ngModel]="c.workspace" (ngModelChange)="patchConnection(c.id, { workspace: $event })" />
                                        </div>
                                    }
                                    @if (preset(c.preset)?.needsAddress) {
                                        <div class="col-sm-6">
                                            <label class="form-label small" [for]="'aiUrl-' + c.id">{{ 'admin.settings.ai.address' | transloco }}</label>
                                            <input class="form-control form-control-sm" [id]="'aiUrl-' + c.id" placeholder="https://api.example.com/v1" [ngModel]="c.baseUrl" (ngModelChange)="patchConnection(c.id, { baseUrl: $event })" />
                                        </div>
                                        <div class="col-sm-6">
                                            <label class="form-label small" [for]="'aiWhere-' + c.id">{{ 'admin.settings.ai.where' | transloco }}</label>
                                            <input class="form-control form-control-sm" [id]="'aiWhere-' + c.id" [ngModel]="c.processesIn" (ngModelChange)="patchConnection(c.id, { processesIn: $event })" />
                                        </div>
                                    }
                                    @if (preset(c.preset)?.kind === 'vertex') {
                                        <div class="col-sm-6">
                                            <label class="form-label small" [for]="'aiLoc-' + c.id">{{ 'admin.settings.ai.location' | transloco }}</label>
                                            <input class="form-control form-control-sm" [id]="'aiLoc-' + c.id" [placeholder]="setup()?.defaultVertexLocation ?? ''" [ngModel]="c.location" (ngModelChange)="patchConnection(c.id, { location: $event })" />
                                            <small class="text-muted">{{ 'admin.settings.ai.location_hint' | transloco }}</small>
                                        </div>
                                    }
                                </div>

                                @if (preset(c.preset)?.kind === 'openai') {
                                    <div class="key-row mb-2">
                                        <div class="small mb-1">
                                            @if (c.keyPreview) {
                                                <i class="fa-solid fa-key me-1"></i>{{ 'admin.settings.ai.key_set' | transloco: { preview: c.keyPreview, by: c.keySetBy ?? '', on: (c.keySetAt | arcTime: 'date') } }}
                                                <button type="button" class="btn btn-link btn-sm p-0 ms-2 remove-key" (click)="removeKey(c)">{{ 'admin.settings.ai.remove_key' | transloco }}</button>
                                            } @else {
                                                <i class="fa-solid fa-key me-1 text-muted"></i><span class="text-muted">{{ 'admin.settings.ai.no_key' | transloco }}</span>
                                            }
                                        </div>
                                        @if (isSaved(c.id)) {
                                            <div class="d-flex gap-2">
                                                <input type="password" class="form-control form-control-sm" autocomplete="off" [attr.aria-label]="'admin.settings.ai.key' | transloco"
                                                    [placeholder]="(c.keyPreview ? 'admin.settings.ai.key_replace' : 'admin.settings.ai.key_paste') | transloco"
                                                    [ngModel]="keyDrafts()[c.id] ?? ''" (ngModelChange)="setKeyDraft(c.id, $event)" />
                                                <button type="button" class="btn btn-sm btn-outline-primary text-nowrap save-key" (click)="saveKey(c)" [disabled]="busy() || !(keyDrafts()[c.id] ?? '').trim()">
                                                    {{ 'admin.settings.ai.save_key' | transloco }}
                                                </button>
                                            </div>
                                        } @else {
                                            <small class="text-muted">{{ 'admin.settings.ai.save_first' | transloco }}</small>
                                        }
                                    </div>
                                }

                                @if (c.lastError) {
                                    <div class="small text-danger mb-2"><i class="fa-solid fa-circle-exclamation me-1"></i>{{ c.lastError }}</div>
                                } @else if (c.lastOkAt) {
                                    <div class="small text-success mb-2"><i class="fa-solid fa-circle-check me-1"></i>{{ 'admin.settings.ai.last_ok' | transloco: { on: (c.lastOkAt | arcTime: 'dateTime') } }}</div>
                                }

                                @if (isSaved(c.id)) {
                                    <div class="d-flex gap-2 test-row">
                                        <input class="form-control form-control-sm" [attr.list]="'aiModels-' + c.id" [attr.aria-label]="'admin.settings.ai.test_model' | transloco"
                                            [placeholder]="'admin.settings.ai.test_model' | transloco" [ngModel]="testModels()[c.id] ?? firstModel(c)" (ngModelChange)="setTestModel(c.id, $event)" />
                                        <button type="button" class="btn btn-sm btn-outline-secondary text-nowrap" (click)="test(c)" [disabled]="testing() === c.id">
                                            @if (testing() === c.id) { <i class="fas fa-spinner fa-spin me-1"></i> }
                                            {{ 'admin.settings.ai.test' | transloco }}
                                        </button>
                                    </div>
                                    @if (testResults()[c.id]; as r) {
                                        <small class="d-block mt-1" [class.text-success]="r.ok" [class.text-danger]="!r.ok">{{ r.text }}</small>
                                    }
                                }
                                <datalist [id]="'aiModels-' + c.id">
                                    @for (m of preset(c.preset)?.models ?? []; track m.model) { <option [value]="m.model"></option> }
                                </datalist>
                            </div>
                        </div>
                    }
                    <div class="d-flex gap-2 mb-4 add-provider">
                        <select class="form-select form-select-sm w-auto" [attr.aria-label]="'admin.settings.ai.add_provider' | transloco" [ngModel]="newPreset()" (ngModelChange)="newPreset.set($event)">
                            @for (p of setup()?.presets ?? []; track p.id) { <option [value]="p.id">{{ p.label }}</option> }
                        </select>
                        <button type="button" class="btn btn-sm btn-outline-primary" (click)="addConnection()" [disabled]="!setup()">
                            <i class="fa-solid fa-plus me-1"></i>{{ 'admin.settings.ai.add_provider' | transloco }}
                        </button>
                    </div>

                    <h4>{{ 'admin.settings.ai.models' | transloco }}</h4>
                    <p class="text-muted small">{{ 'admin.settings.ai.models_hint' | transloco }}</p>
                    @for (t of tiers; track t) {
                        <div class="mb-3 tier" [attr.data-tier]="t">
                            <div class="fw-semibold">{{ 'admin.settings.ai.tier_' + t | transloco }}</div>
                            <small class="text-muted d-block mb-1">{{ 'admin.settings.ai.tier_' + t + '_hint' | transloco }}</small>
                            <ng-container *ngTemplateOutlet="modelList; context: { $implicit: form().tiers[t], set: tierSetter(t) }" />
                        </div>
                    }

                    @if (usedModels().length) {
                        <h4>{{ 'admin.settings.ai.model_details' | transloco }}</h4>
                        <p class="text-muted small">{{ 'admin.settings.ai.model_details_hint' | transloco: { date: setup()?.pricesCheckedOn ?? '' } }}</p>
                        <div class="table-responsive mb-4">
                            <table class="table table-sm align-middle model-details">
                                <thead><tr>
                                    <th>{{ 'admin.settings.ai.model' | transloco }}</th>
                                    <th>{{ 'admin.settings.ai.reads' | transloco }}</th>
                                    <th>{{ 'admin.settings.ai.shape' | transloco }}</th>
                                    <th>{{ 'admin.settings.ai.price_in' | transloco }}</th>
                                    <th>{{ 'admin.settings.ai.price_out' | transloco }}</th>
                                </tr></thead>
                                <tbody>
                                    @for (m of usedModels(); track m.key) {
                                        <tr>
                                            <td><code>{{ m.model }}</code><div class="small text-muted">{{ connectionLabel(m.connection) }}</div></td>
                                            <td class="text-nowrap">
                                                <label class="form-check form-check-inline small mb-0">
                                                    <input type="checkbox" class="form-check-input" [ngModel]="reads(m.key, m.connection, m.model, 'pictures')" (ngModelChange)="setReads(m.key, m.connection, m.model, 'pictures', $event)" />{{ 'admin.settings.ai.pictures' | transloco }}
                                                </label>
                                                <label class="form-check form-check-inline small mb-0">
                                                    <input type="checkbox" class="form-check-input" [ngModel]="reads(m.key, m.connection, m.model, 'pdfs')" (ngModelChange)="setReads(m.key, m.connection, m.model, 'pdfs', $event)" />PDF
                                                </label>
                                            </td>
                                            <td>
                                                <select class="form-select form-select-sm" [attr.aria-label]="'admin.settings.ai.shape' | transloco" [ngModel]="shape(m.key, m.connection, m.model)" (ngModelChange)="patchModel(m.key, { schema: $event })">
                                                    <option value="json">{{ 'admin.settings.ai.shape_json' | transloco }}</option>
                                                    <option value="strict">{{ 'admin.settings.ai.shape_strict' | transloco }}</option>
                                                </select>
                                            </td>
                                            <td><input type="number" min="0" step="0.001" class="form-control form-control-sm price" [attr.aria-label]="'admin.settings.ai.price_in' | transloco"
                                                [placeholder]="knownPrice(m.connection, m.model, 'priceIn')" [ngModel]="form().models[m.key]?.priceIn ?? null" (ngModelChange)="setPrice(m.key, 'priceIn', $event)" /></td>
                                            <td><input type="number" min="0" step="0.001" class="form-control form-control-sm price" [attr.aria-label]="'admin.settings.ai.price_out' | transloco"
                                                [placeholder]="knownPrice(m.connection, m.model, 'priceOut')" [ngModel]="form().models[m.key]?.priceOut ?? null" (ngModelChange)="setPrice(m.key, 'priceOut', $event)" /></td>
                                        </tr>
                                    }
                                </tbody>
                            </table>
                        </div>
                    }

                    <h4>{{ 'admin.settings.ai.budget' | transloco }}</h4>
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
                                        <strong>{{ p.label }}</strong> <code class="small ms-1">{{ p.id }}</code>
                                        @if (p.description) { <div class="small text-muted">{{ p.description }}</div> }
                                    </div>
                                    <div class="form-check form-switch">
                                        <input type="checkbox" class="form-check-input" role="switch" [id]="'aiOn-' + p.id" [ngModel]="purpose(p.id).enabled" (ngModelChange)="patchPurpose(p.id, { enabled: $event })" />
                                        <label class="form-check-label" [for]="'aiOn-' + p.id">{{ 'admin.settings.ai.on' | transloco }}</label>
                                    </div>
                                </div>
                                <div class="small mt-2">{{ takes(p) }}</div>
                                <div class="small mb-2">{{ (p.output === 'data' ? 'admin.settings.ai.gives_data' : 'admin.settings.ai.gives_text') | transloco }}</div>

                                <label class="form-label small mb-1" [for]="'aiUse-' + p.id">{{ 'admin.settings.ai.which_models' | transloco }}</label>
                                <select class="form-select form-select-sm w-auto mb-2" [id]="'aiUse-' + p.id" [ngModel]="purpose(p.id).models.length ? 'own' : 'tier'" (ngModelChange)="useOwnModels(p, $event === 'own')">
                                    <option value="tier">{{ 'admin.settings.ai.use_tier' | transloco: { tier: ('admin.settings.ai.tier_' + p.tier | transloco) } }}</option>
                                    <option value="own">{{ 'admin.settings.ai.use_own' | transloco }}</option>
                                </select>
                                @if (purpose(p.id).models.length) {
                                    <ng-container *ngTemplateOutlet="modelList; context: { $implicit: purpose(p.id).models, set: purposeSetter(p.id) }" />
                                }

                                <div class="row g-2 mt-1">
                                    <div class="col-sm-6">
                                        <label class="form-label small" [for]="'aiAllow-' + p.id">{{ 'admin.settings.ai.allowance' | transloco }}</label>
                                        <input type="number" min="1" step="1" class="form-control form-control-sm" [id]="'aiAllow-' + p.id"
                                            [placeholder]="p.perKeyPerDay ?? ('admin.settings.ai.no_limit' | transloco)" [ngModel]="purpose(p.id).perKeyPerDay" (ngModelChange)="setAllowance(p.id, $event)" />
                                    </div>
                                </div>
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
                    @if (usage(); as u) {
                        <div class="row g-2 mb-3 totals">
                            <div class="col-6 col-md-3"><div class="stat"><div class="small text-muted">{{ 'admin.settings.ai.cost' | transloco }}</div><div class="fs-5">{{ money(u.costUsd) }}</div>
                                <div class="small text-muted">{{ 'admin.settings.ai.of_budget' | transloco: { budget: money(form().monthlyUsd) } }}</div>
                                <div class="progress mt-1" role="progressbar" [attr.aria-valuenow]="budgetShare()" aria-valuemin="0" aria-valuemax="100"><div class="progress-bar" [class.bg-danger]="budgetShare() >= 80" [style.width.%]="budgetShare()"></div></div></div></div>
                            <div class="col-6 col-md-3"><div class="stat"><div class="small text-muted">{{ 'admin.settings.ai.calls' | transloco }}</div><div class="fs-5">{{ u.calls | number }}</div><div class="small text-muted">{{ 'admin.settings.ai.failed_count' | transloco: { n: u.failed } }}</div></div></div>
                            <div class="col-6 col-md-3"><div class="stat"><div class="small text-muted">{{ 'admin.settings.ai.tokens' | transloco }}</div><div class="fs-5">{{ u.tokensIn | number }} / {{ u.tokensOut | number }}</div><div class="small text-muted">{{ 'admin.settings.ai.in_out' | transloco }}</div></div></div>
                            <div class="col-6 col-md-3"><div class="stat"><div class="small text-muted">{{ 'admin.settings.ai.test_calls' | transloco }}</div><div class="fs-5">{{ u.testCalls | number }}</div></div></div>
                        </div>
                        @if (!u.calls && !u.testCalls) { <p class="text-muted">{{ 'admin.settings.ai.no_usage' | transloco }}</p> }
                        @for (table of usageTables(u); track table.title) {
                            @if (table.rows.length) {
                                <h4>{{ table.title | transloco }}</h4>
                                <div class="table-responsive mb-3">
                                    <table class="table table-sm usage-table">
                                        <thead><tr><th>{{ table.first | transloco }}</th><th class="text-end">{{ 'admin.settings.ai.calls' | transloco }}</th><th class="text-end">{{ 'admin.settings.ai.failed' | transloco }}</th><th class="text-end">{{ 'admin.settings.ai.tokens_in' | transloco }}</th><th class="text-end">{{ 'admin.settings.ai.tokens_out' | transloco }}</th><th class="text-end">{{ 'admin.settings.ai.cost' | transloco }}</th></tr></thead>
                                        <tbody>
                                            @for (r of table.rows; track r.name) {
                                                <tr><td>{{ r.name }}</td><td class="text-end">{{ r.calls | number }}</td><td class="text-end">{{ r.failed | number }}</td><td class="text-end">{{ r.tokensIn | number }}</td><td class="text-end">{{ r.tokensOut | number }}</td><td class="text-end">{{ money(r.costUsd) }}</td></tr>
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
                            @for (id of callPurposes(); track id) { <option [value]="id">{{ id }}</option> }
                        </select>
                        <select class="form-select form-select-sm w-auto" [attr.aria-label]="'admin.settings.ai.filter_outcome' | transloco" [ngModel]="callOutcome()" (ngModelChange)="callOutcome.set($event)">
                            <option value="">{{ 'admin.settings.ai.all_outcomes' | transloco }}</option>
                            <option value="ok">ok</option>
                            <option value="failed">{{ 'admin.settings.ai.failed' | transloco }}</option>
                        </select>
                        <button type="button" class="btn btn-sm btn-outline-secondary" (click)="loadCalls()"><i class="fa-solid fa-rotate me-1"></i>{{ 'admin.settings.ai.refresh' | transloco }}</button>
                    </div>
                    <p class="text-muted small">{{ 'admin.settings.ai.calls_hint' | transloco }}</p>
                    @if (!shownCalls().length) { <p class="text-muted no-calls">{{ 'admin.settings.ai.no_calls' | transloco }}</p> }
                    <div class="list-group calls">
                        @for (c of shownCalls(); track c.id) {
                            <button type="button" class="list-group-item list-group-item-action call" [class.active-call]="openCall() === c.id" (click)="toggleCall(c.id)">
                                <div class="d-flex flex-wrap gap-2 align-items-center small">
                                    <span class="text-muted">{{ c.createdAt | arcTime: 'dateTime' }}</span>
                                    <strong>{{ c.purpose }}</strong>
                                    <span class="badge" [class.text-bg-success]="c.outcome === 'ok'" [class.text-bg-danger]="c.outcome !== 'ok'">{{ c.outcome }}</span>
                                    @if (c.test) { <span class="badge text-bg-info">{{ 'admin.settings.ai.test_badge' | transloco }}</span> }
                                    <span class="text-muted">{{ c.model ?? '' }}</span>
                                    <span class="ms-auto">{{ c.tokensIn | number }} / {{ c.tokensOut | number }} · {{ money(c.costUsd) }} · {{ c.ms / 1000 | number: '1.1-1' }} s</span>
                                </div>
                            </button>
                            @if (openCall() === c.id) {
                                <div class="call-details border rounded p-2 mb-2 small">
                                    @if (c.detail) { <div class="text-danger mb-1">{{ c.detail }}</div> }
                                    <div>{{ 'admin.settings.ai.input_size' | transloco: { chars: c.input.chars, files: c.input.files, kb: (c.input.bytes / 1024 | number: '1.0-0') } }}</div>
                                    @if (c.limitKey) { <div>{{ 'admin.settings.ai.key_units' | transloco: { key: c.limitKey, units: c.units } }}</div> }
                                    @if (c.ref) { <div><code>{{ c.ref }}</code></div> }
                                    @for (a of c.attempts; track $index) {
                                        <div>{{ $index + 1 }}. {{ a.connection }} / {{ a.model }}: {{ a.outcome }} ({{ a.ms / 1000 | number: '1.1-1' }} s){{ a.detail ? ', ' + a.detail : '' }}</div>
                                    }
                                    @if (c.content; as k) {
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
                                </div>
                            }
                        }
                    </div>
                }
            }

            @if (tab() === 'setup' || tab() === 'purposes') {
                <button class="btn btn-primary mt-2 save" (click)="save()" [disabled]="saving() || !loaded()">
                    @if (saving()) { <i class="fas fa-spinner fa-spin me-1"></i> {{ 'common.actions.saving' | transloco }} }
                    @else { <i class="fas fa-save me-1"></i> {{ 'admin.settings.ai.save' | transloco }} }
                </button>
                @if (saveMessage()) { <span class="ms-3" [class.text-success]="!saveFailed()" [class.text-danger]="saveFailed()">{{ saveMessage() }}</span> }
            }
        </div>

        <ng-template #modelList let-list let-set="set">
            @for (r of list; track $index; let i = $index) {
                <div class="d-flex gap-1 mb-1 model-row">
                    <select class="form-select form-select-sm conn" [attr.aria-label]="'admin.settings.ai.provider' | transloco" [ngModel]="r.connection" (ngModelChange)="set(replaced(list, i, { connection: $event, model: r.model }))">
                        @for (c of form().connections; track c.id) { <option [value]="c.id">{{ c.label || c.id }}</option> }
                    </select>
                    <input class="form-control form-control-sm" [attr.list]="'aiModels-' + r.connection" [attr.aria-label]="'admin.settings.ai.model' | transloco" [ngModel]="r.model" (ngModelChange)="set(replaced(list, i, { connection: r.connection, model: $event.trim() }))" />
                    <button type="button" class="btn btn-sm btn-outline-secondary" [disabled]="i === 0" (click)="set(moved(list, i, -1))" [attr.aria-label]="'admin.settings.ai.move_up' | transloco"><i class="fa-solid fa-arrow-up"></i></button>
                    <button type="button" class="btn btn-sm btn-outline-secondary" (click)="set(without(list, i))" [attr.aria-label]="'admin.settings.ai.remove' | transloco"><i class="fa-solid fa-xmark"></i></button>
                </div>
            }
            @if (!form().connections.length) {
                <small class="text-muted d-block">{{ 'admin.settings.ai.add_provider_first' | transloco }}</small>
            } @else if (list.length < maxModels) {
                <button type="button" class="btn btn-sm btn-link px-0 add-model" (click)="set(added(list))"><i class="fa-solid fa-plus me-1"></i>{{ 'admin.settings.ai.add_model' | transloco }}</button>
            }
        </ng-template>
    `,
    styles: [`
        .settings-section { max-width: 860px; }
        h3 { font-size: 1.25rem; font-weight: 600; color: #212529; }
        h4 { font-size: 1rem; font-weight: 600; margin: 1.25rem 0 0.5rem; }
        .budget { max-width: 220px; }
        .price { width: 6.5rem; }
        .model-row .conn { max-width: 12rem; }
        .stat { border: 1px solid var(--bs-border-color); border-radius: 0.5rem; padding: 0.5rem 0.75rem; height: 100%; }
        .progress { height: 0.4rem; }
        pre.kept { white-space: pre-wrap; max-height: 16rem; overflow: auto; background: var(--bs-light); padding: 0.5rem; border-radius: 0.25rem; }
        .active-call { background: var(--bs-light); }
        .test-row { max-width: 460px; }
    `],
})
export class AiSettingsPage implements OnInit {
    private readonly service = inject(AiSettingsService);
    private readonly t = injectT();

    readonly tabs: Tab[] = ['setup', 'purposes', 'usage', 'calls'];
    readonly tiers = AI_TIERS;
    readonly maxModels = MAX_MODELS;
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
    readonly newPreset = signal('alibaba-eu');
    readonly keyDrafts = signal<Record<string, string>>({});
    readonly testModels = signal<Record<string, string>>({});
    readonly testing = signal<string | null>(null);
    readonly testResults = signal<Record<string, { ok: boolean; text: string }>>({});

    readonly month = signal(this.months[0]);
    readonly usage = signal<AiMonthUsage | null>(null);
    readonly calls = signal<AiCallRow[]>([]);
    readonly callPurpose = signal('');
    readonly callOutcome = signal('');
    readonly openCall = signal<string | null>(null);

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
    /** Every model a tier or purpose names, once, for its details. */
    readonly usedModels = computed(() => {
        const f = this.form();
        const all = [...AI_TIERS.flatMap((t) => f.tiers[t]), ...Object.values(f.purposes).flatMap((p) => p.models)].filter((r) => r.connection && r.model);
        const seen = new Map<string, AiModelRef & { key: string }>();
        for (const r of all) seen.set(`${r.connection}/${r.model}`, { ...r, key: `${r.connection}/${r.model}` });
        return [...seen.values()];
    });

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

    openTab(t: Tab): void {
        this.tab.set(t);
        if (t === 'usage' && !this.usage()) void this.loadUsage(this.month());
        if (t === 'calls' && !this.calls().length) void this.loadCalls();
    }

    // ------------------------------------------------------------ form

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

    connectionLabel(id: string): string {
        const c = this.form().connections.find((x) => x.id === id);
        return c ? c.label || this.preset(c.preset)?.label || id : id;
    }

    isSaved(id: string): boolean {
        return !!this.loaded()?.connections.some((c) => c.id === id);
    }

    addConnection(): void {
        const p = this.preset(this.newPreset());
        if (!p) return;
        const id = connectionId(p.label, this.form().connections.map((c) => c.id));
        const connection: AiConnectionForm = {
            id, preset: p.id, label: p.label, workspace: '', baseUrl: '', location: '', processesIn: '',
            keyPreview: null, keySetAt: null, keySetBy: null, lastOkAt: null, lastError: null,
        };
        this.patch({ connections: [...this.form().connections, connection] });
    }

    patchConnection(id: string, change: Partial<AiConnectionForm>): void {
        this.patch({ connections: this.form().connections.map((c) => (c.id === id ? { ...c, ...change } : c)) });
    }

    /** Takes a provider away, with its key, and from every list that named it. */
    async removeConnection(c: AiConnectionForm): Promise<void> {
        if (!confirm(this.t('admin.settings.ai.remove_provider_confirm', { name: c.label || c.id }))) return;
        const drop = (list: AiModelRef[]) => list.filter((r) => r.connection !== c.id);
        const f = this.form();
        const tiers = Object.fromEntries(AI_TIERS.map((t) => [t, drop(f.tiers[t])])) as Record<AiTier, AiModelRef[]>;
        const purposes = Object.fromEntries(Object.entries(f.purposes).map(([id, p]) => [id, { ...p, models: drop(p.models) }]));
        const models = Object.fromEntries(Object.entries(f.models).filter(([key]) => !key.startsWith(`${c.id}/`)));
        this.patch({ connections: f.connections.filter((x) => x.id !== c.id), tiers, purposes, models });
        if (c.keyPreview) {
            try {
                await this.service.removeKey(c.id);
            } catch (err) {
                console.error('AI settings: key not removed', err);
            }
        }
    }

    setKeyDraft(id: string, value: string): void {
        this.keyDrafts.update((d) => ({ ...d, [id]: value }));
    }

    async saveKey(c: AiConnectionForm): Promise<void> {
        const key = (this.keyDrafts()[c.id] ?? '').trim();
        if (!key) return;
        this.busy.set(true);
        try {
            // The key is tied to the address the server has, so the address is saved first.
            if (!(await this.save())) return;
            const result = await this.service.setKey(c.id, key);
            this.patchConnection(c.id, { ...result, lastError: null });
            this.loaded.update((l) => l && ({ ...l, connections: l.connections.map((x) => (x.id === c.id ? { ...x, ...result } : x)) }));
            this.setKeyDraft(c.id, '');
            this.saveMessage.set(this.t('admin.settings.ai.key_saved'));
            this.saveFailed.set(false);
        } catch (err: any) {
            this.saveMessage.set(this.t('admin.settings.ai.key_failed', { error: err?.message ?? '' }));
            this.saveFailed.set(true);
        } finally {
            this.busy.set(false);
        }
    }

    async removeKey(c: AiConnectionForm): Promise<void> {
        if (!confirm(this.t('admin.settings.ai.remove_key_confirm'))) return;
        try {
            await this.service.removeKey(c.id);
            this.patchConnection(c.id, { keyPreview: null, keySetAt: null, keySetBy: null });
        } catch (err: any) {
            this.saveMessage.set(this.t('admin.settings.ai.key_failed', { error: err?.message ?? '' }));
            this.saveFailed.set(true);
        }
    }

    firstModel(c: AiConnectionForm): string {
        const f = this.form();
        const named = [...AI_TIERS.flatMap((t) => f.tiers[t]), ...Object.values(f.purposes).flatMap((p) => p.models)].find((r) => r.connection === c.id);
        return named?.model ?? this.preset(c.preset)?.models[0]?.model ?? '';
    }

    setTestModel(id: string, model: string): void {
        this.testModels.update((m) => ({ ...m, [id]: model }));
    }

    async test(c: AiConnectionForm): Promise<void> {
        const model = (this.testModels()[c.id] ?? this.firstModel(c)).trim();
        if (!model) return;
        this.testing.set(c.id);
        try {
            const r = await this.service.test(c.id, model);
            const text = r.ok
                ? this.t('admin.settings.ai.test_ok', { s: (r.ms / 1000).toFixed(1), reply: r.reply ?? '', cost: usd(r.costUsd ?? 0) })
                : this.t('admin.settings.ai.test_failed', { error: r.detail ?? r.failure ?? '' });
            this.testResults.update((x) => ({ ...x, [c.id]: { ok: r.ok, text } }));
            this.patchConnection(c.id, r.ok ? { lastError: null, lastOkAt: new Date().toISOString() } : { lastError: r.detail ?? null });
        } catch (err: any) {
            this.testResults.update((x) => ({ ...x, [c.id]: { ok: false, text: this.t('admin.settings.ai.test_failed', { error: err?.message ?? '' }) } }));
        } finally {
            this.testing.set(null);
        }
    }

    // Model lists: a tier's or a purpose's, edited through the same template.

    tierSetter(t: AiTier): (list: AiModelRef[]) => void {
        return (list) => this.patch({ tiers: { ...this.form().tiers, [t]: list } });
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

    added(list: AiModelRef[]): AiModelRef[] {
        const c = this.form().connections[0];
        return [...list, { connection: c.id, model: this.preset(c.preset)?.models[0]?.model ?? '' }];
    }

    purpose(id: string): AiPurposeForm {
        return this.form().purposes[id] ?? { enabled: true, models: [], perKeyPerDay: null, keepContent: false };
    }

    patchPurpose(id: string, change: Partial<AiPurposeForm>): void {
        this.patch({ purposes: { ...this.form().purposes, [id]: { ...this.purpose(id), ...change } } });
    }

    useOwnModels(p: AiPurposeInfo, own: boolean): void {
        this.patchPurpose(p.id, { models: own ? (this.form().tiers[p.tier].length ? [...this.form().tiers[p.tier]] : this.form().connections.length ? this.added([]) : []) : [] });
    }

    setAllowance(id: string, value: unknown): void {
        const n = Number(value);
        this.patchPurpose(id, { perKeyPerDay: value === null || value === '' || !Number.isInteger(n) || n < 1 ? null : n });
    }

    takes(p: AiPurposeInfo): string {
        const parts = [this.t('admin.settings.ai.takes_text', { n: p.maxChars })];
        if (p.pictures) parts.push(this.t('admin.settings.ai.takes_pictures', { n: p.pictures.max, mb: p.pictures.maxMb }));
        if (p.pdfs) parts.push(this.t('admin.settings.ai.takes_pdfs', { n: p.pdfs.max, mb: p.pdfs.maxMb }));
        return `${this.t('admin.settings.ai.takes')} ${parts.join(', ')}`;
    }

    private known(connection: string, model: string) {
        const c = this.form().connections.find((x) => x.id === connection);
        return c ? this.preset(c.preset)?.models.find((m) => m.model === model) : undefined;
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

    knownPrice(connection: string, model: string, which: 'priceIn' | 'priceOut'): string {
        const price = this.known(connection, model)?.[which];
        return price === undefined ? this.t('admin.settings.ai.no_price') : String(price);
    }

    setPrice(key: string, which: 'priceIn' | 'priceOut', value: unknown): void {
        const n = Number(value);
        const m = { ...(this.form().models[key] ?? {}) };
        if (value === null || value === '' || !Number.isFinite(n) || n < 0) delete m[which];
        else m[which] = n;
        this.patch({ models: { ...this.form().models, [key]: m } });
    }

    patchModel(key: string, change: Partial<AiSettingsForm['models'][string]>): void {
        this.patch({ models: { ...this.form().models, [key]: { ...(this.form().models[key] ?? {}), ...change } } });
    }

    setBudget(value: unknown): void {
        const n = Number(value);
        if (Number.isFinite(n) && n >= 0) this.patch({ monthlyUsd: n });
    }

    /** Saves the form; false when it could not, with the reason shown beside the button. */
    async save(): Promise<boolean> {
        const loaded = this.loaded();
        if (!loaded) return false;
        this.saving.set(true);
        this.saveFailed.set(false);
        try {
            await this.service.save(this.form(), loaded);
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
        try {
            this.usage.set(await this.service.usage(month));
        } catch (err) {
            console.error('AI settings: usage not loaded', err);
        }
    }

    usageTables(u: AiMonthUsage): Array<{ title: string; first: string; rows: Array<{ name: string; calls: number; failed: number; tokensIn: number; tokensOut: number; costUsd: number }> }> {
        const label = (id: string) => this.setup()?.purposes.find((p) => p.id === id)?.label ?? id;
        return [
            { title: 'admin.settings.ai.by_purpose', first: 'admin.settings.ai.purpose', rows: u.byPurpose.map((r) => ({ ...r, name: label(r.id) })) },
            { title: 'admin.settings.ai.by_model', first: 'admin.settings.ai.model', rows: u.byModel.map((r) => ({ ...r, name: `${this.connectionLabel(r.connection)}: ${r.model}` })) },
            { title: 'admin.settings.ai.by_key', first: 'admin.settings.ai.key_column', rows: u.keys.map((r) => ({ ...r, name: `${r.limitKey} (${label(r.purpose)})` })) },
            { title: 'admin.settings.ai.by_day', first: 'admin.settings.ai.day', rows: u.byDay.map((r) => ({ ...r, name: `${u.month}-${r.day}` })) },
        ];
    }

    async loadCalls(): Promise<void> {
        try {
            this.calls.set(await this.service.recentCalls());
        } catch (err) {
            console.error('AI settings: calls not loaded', err);
        }
    }

    toggleCall(id: string): void {
        this.openCall.update((open) => (open === id ? null : id));
    }

    async openFile(event: Event, path: string | null | undefined): Promise<void> {
        event.preventDefault();
        if (!path) return;
        try {
            window.open(await this.service.fileUrl(path), '_blank', 'noopener');
        } catch {
            alert(this.t('admin.settings.ai.file_gone'));
        }
    }

    async downloadCsv(): Promise<void> {
        this.busy.set(true);
        try {
            const rows = await this.service.allCalls();
            const blob = new Blob([callsCsv(rows)], { type: 'text/csv;charset=utf-8' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `ai-calls-${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            URL.revokeObjectURL(a.href);
        } catch (err) {
            console.error('AI settings: CSV not made', err);
        } finally {
            this.busy.set(false);
        }
    }
}
