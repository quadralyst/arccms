/**
 * Discoverability Settings Page
 *
 * AI-crawler policy (rendered into robots.txt), the llms.txt switch and
 * IndexNow, with links to the engines' own verification tools.
 * Spec: docs/discoverability-spec.md, D3 (D-D6, D-D7, D-D9, D-D14).
 */
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslocoPipe } from '@jsverse/transloco';
import { injectT } from '../../../../core/i18n/inject-t';
import { AboutSettingsService } from '../about/about-settings.service';
import { DiscoverabilitySettingsService } from './discoverability-settings.service';
import {
    DEFAULT_DISCOVERABILITY_SETTINGS,
    IDiscoverabilitySettings,
} from '../../../../../shared/models/discoverability.model';
import { CRAWLERS, CrawlerAgent, CrawlerGroup } from '../../../../../shared/constants/crawlers';

@Component({
    selector: 'arc-discoverability-settings',
    standalone: true,
    imports: [CommonModule, TranslocoPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
    <div class="settings-section">
      <h3 class="mb-3">{{ 'admin.settings.discoverability.title' | transloco }}</h3>
      <p class="text-muted mb-4">{{ 'admin.settings.discoverability.intro' | transloco }}</p>

      @if (isLoading()) {
        <p class="text-muted"><i class="fas fa-spinner fa-spin me-1"></i> {{ 'common.state.loading' | transloco }}</p>
      } @else {

        <!-- Crawlers -->
        <h4 class="section-heading">{{ 'admin.settings.discoverability.crawlers_heading' | transloco }}</h4>
        <p class="text-muted small mb-3">{{ 'admin.settings.discoverability.crawlers_intro' | transloco }}</p>

        @for (group of groups; track group.id) {
          <div class="crawler-group mb-4">
            <div class="crawler-group-title">{{ group.labelKey | transloco }}</div>
            <p class="text-muted small mb-2">{{ group.hintKey | transloco }}</p>
            <ul class="crawler-list list-unstyled mb-0">
              @for (agent of group.agents; track agent.id) {
                <li class="crawler-row">
                  <div class="crawler-info">
                    <span class="crawler-name">{{ agent.userAgent }}</span>
                    <span class="crawler-vendor text-muted">{{ agent.vendor }}</span>
                    <div class="crawler-desc text-muted small">{{ agent.description }}</div>
                  </div>
                  <label class="form-check form-switch mb-0" [attr.data-testid]="'crawler-' + agent.id">
                    <input class="form-check-input" type="checkbox" role="switch"
                      [checked]="settings().crawlers[agent.id] !== false"
                      (change)="setCrawler(agent.id, $any($event.target).checked)">
                    <span class="form-check-label small">
                      {{ (settings().crawlers[agent.id] !== false ? 'admin.settings.discoverability.allowed' : 'admin.settings.discoverability.blocked') | transloco }}
                    </span>
                  </label>
                </li>
              }
            </ul>
          </div>
        }

        <!-- Files -->
        <h4 class="section-heading">{{ 'admin.settings.discoverability.files_heading' | transloco }}</h4>
        <div class="form-check form-switch mb-2">
          <input class="form-check-input" type="checkbox" role="switch" id="llmsTxt" data-testid="llms-txt"
            [checked]="settings().llmsTxt" (change)="setField('llmsTxt', $any($event.target).checked)">
          <label class="form-check-label" for="llmsTxt">{{ 'admin.settings.discoverability.llms_txt' | transloco }}</label>
        </div>
        <p class="text-muted small mb-4">{{ 'admin.settings.discoverability.llms_txt_hint' | transloco }}</p>

        <!-- IndexNow -->
        <h4 class="section-heading">{{ 'admin.settings.discoverability.indexnow_heading' | transloco }}</h4>
        <div class="form-check form-switch mb-2">
          <input class="form-check-input" type="checkbox" role="switch" id="indexNow" data-testid="indexnow"
            [checked]="settings().indexNow.enabled" (change)="setIndexNow($any($event.target).checked)">
          <label class="form-check-label" for="indexNow">{{ 'admin.settings.discoverability.indexnow' | transloco }}</label>
        </div>
        <p class="text-muted small mb-2">{{ 'admin.settings.discoverability.indexnow_hint' | transloco }}</p>
        <div class="small mb-4">
          <span class="text-muted">{{ 'admin.settings.discoverability.indexnow_key' | transloco }}:</span>
          @if (settings().indexNow.key) {
            <code class="ms-1">{{ settings().indexNow.key }}</code>
            <div class="text-muted">{{ 'admin.settings.discoverability.indexnow_key_hint' | transloco: { key: settings().indexNow.key } }}</div>
          } @else {
            <span class="text-muted ms-1">{{ 'admin.settings.discoverability.indexnow_key_pending' | transloco }}</span>
          }
        </div>

        <!-- Verify -->
        <h4 class="section-heading">{{ 'admin.settings.discoverability.verify_heading' | transloco }}</h4>
        <p class="text-muted small mb-2">{{ 'admin.settings.discoverability.verify_intro' | transloco }}</p>
        <ul class="small mb-4">
          <li><a href="https://search.google.com/search-console" target="_blank" rel="noopener">{{ 'admin.settings.discoverability.verify_gsc' | transloco }}</a></li>
          <li><a href="https://www.bing.com/webmasters" target="_blank" rel="noopener">{{ 'admin.settings.discoverability.verify_bing' | transloco }}</a></li>
          @if (baseUrl()) {
            <li><a [href]="baseUrl() + '/robots.txt'" target="_blank" rel="noopener">{{ 'admin.settings.discoverability.verify_robots' | transloco }}</a></li>
            @if (settings().llmsTxt) {
              <li><a [href]="baseUrl() + '/llms.txt'" target="_blank" rel="noopener">{{ 'admin.settings.discoverability.verify_llms' | transloco }}</a></li>
            }
          }
        </ul>

        <div class="d-flex align-items-center gap-2 flex-wrap">
          <button class="btn btn-outline-primary" (click)="save(false)" [disabled]="busy()" data-testid="save">
            <i class="fas fa-save me-1"></i> {{ 'admin.settings.discoverability.save' | transloco }}
          </button>
          <button class="btn btn-primary" (click)="save(true)" [disabled]="busy()" data-testid="save-apply">
            @if (busy()) { <i class="fas fa-spinner fa-spin me-1"></i> } @else { <i class="fas fa-rocket me-1"></i> }
            {{ 'admin.settings.discoverability.save_apply' | transloco }}
          </button>
          @if (message()) {
            <span [class.text-success]="!error()" [class.text-danger]="error()">{{ message() }}</span>
          }
        </div>
      }
    </div>
    `,
    styles: [`
        .settings-section { max-width: 720px; }
        h3 { font-size: 1.25rem; font-weight: 600; color: #212529; }
        .section-heading { font-size: 1rem; font-weight: 600; color: #212529; margin-bottom: .5rem; }
        .crawler-group { padding: .75rem 1rem; border: 1px solid #e5e7eb; border-radius: 8px; background: #fafafa; }
        .crawler-group-title { font-weight: 600; font-size: .9375rem; }
        .crawler-row { display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: .5rem 0; border-top: 1px solid #eee; }
        .crawler-row:first-child { border-top: 0; }
        .crawler-name { font-weight: 500; }
        .crawler-vendor { font-size: .8125rem; margin-left: .5rem; }
        .form-switch { min-width: 110px; }
        code { background: #eef2f7; padding: 1px 5px; border-radius: 3px; font-size: 12px; }
    `],
})
export class DiscoverabilitySettingsPage implements OnInit {
    private service = inject(DiscoverabilitySettingsService);
    private about = inject(AboutSettingsService);
    private t = injectT();

    settings = signal<IDiscoverabilitySettings>(DEFAULT_DISCOVERABILITY_SETTINGS);
    baseUrl = signal('');
    isLoading = signal(true);
    busy = signal(false);
    message = signal('');
    error = signal(false);

    readonly groups: Array<{ id: CrawlerGroup; labelKey: string; hintKey: string; agents: CrawlerAgent[] }> = [
        {
            id: 'search',
            labelKey: 'admin.settings.discoverability.group_search',
            hintKey: 'admin.settings.discoverability.group_search_hint',
            agents: CRAWLERS.filter(c => c.group === 'search'),
        },
        {
            id: 'training',
            labelKey: 'admin.settings.discoverability.group_training',
            hintKey: 'admin.settings.discoverability.group_training_hint',
            agents: CRAWLERS.filter(c => c.group === 'training'),
        },
    ];

    blockedCount = computed(() => Object.values(this.settings().crawlers).filter(v => v === false).length);

    async ngOnInit(): Promise<void> {
        try {
            const [settings, about] = await Promise.all([this.service.load(), this.about.load().catch(() => null)]);
            this.settings.set(settings);
            this.baseUrl.set((about?.finalUrl || '').replace(/\/+$/, ''));
        } catch (e) {
            console.error('Error loading discoverability settings:', e);
        } finally {
            this.isLoading.set(false);
        }
    }

    setCrawler(id: string, allowed: boolean): void {
        this.settings.update(s => ({ ...s, crawlers: { ...s.crawlers, [id]: allowed } }));
        this.clearMessage();
    }

    setField(field: 'llmsTxt', value: boolean): void {
        this.settings.update(s => ({ ...s, [field]: value }));
        this.clearMessage();
    }

    setIndexNow(enabled: boolean): void {
        this.settings.update(s => ({ ...s, indexNow: { ...s.indexNow, enabled } }));
        this.clearMessage();
    }

    async save(apply: boolean): Promise<void> {
        this.busy.set(true);
        this.clearMessage();
        try {
            await this.service.save(this.settings());
        } catch (e) {
            console.error('Error saving discoverability settings:', e);
            this.message.set(this.t('admin.settings.discoverability.save_failed'));
            this.error.set(true);
            this.busy.set(false);
            return;
        }
        if (!apply) {
            this.message.set(this.t('admin.settings.discoverability.saved'));
            this.busy.set(false);
            return;
        }
        try {
            const result = await this.service.apply();
            if (result.indexNowKey) {
                this.settings.update(s => ({ ...s, indexNow: { ...s.indexNow, key: result.indexNowKey } }));
            }
            this.message.set(this.t('admin.settings.discoverability.applied', { files: result.files.length }));
        } catch (e) {
            console.error('Error applying discoverability settings:', e);
            this.message.set(this.t('admin.settings.discoverability.apply_failed'));
            this.error.set(true);
        } finally {
            this.busy.set(false);
        }
    }

    private clearMessage(): void {
        this.message.set('');
        this.error.set(false);
    }
}
