/**
 * The dashboard's "Finish setting up" panel (docs/features/setup-panel.html): each
 * outside service still to connect, with why and a link to its settings page. Shows
 * nothing until the checks have answered, and nothing once every item is done.
 */
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { SetupStatusService } from './setup-status.service';

@Component({
    selector: 'arc-setup-panel',
    standalone: true,
    imports: [RouterLink, TranslocoPipe],
    template: `
        @if (setup.loaded() && setup.rows().length) {
        <section class="setup-panel" data-testid="setup-panel" aria-labelledby="setup-panel-heading">
            <h2 id="setup-panel-heading">{{ 'admin.dashboard.setup.heading' | transloco }}</h2>
            <p class="setup-intro">{{ 'admin.dashboard.setup.intro' | transloco }}</p>
            <ul>
                @for (row of setup.rows(); track row.item.id) {
                <li class="setup-row" [class.warning]="row.need.warning" [attr.data-setup-id]="row.item.id">
                    <span class="setup-icon" aria-hidden="true"><i [class]="row.item.icon"></i></span>
                    <div class="setup-body">
                        <div class="setup-title">
                            <span>{{ text(row.need.titleKey, row.need.title) }}</span>
                            @if (row.need.required) {
                            <span class="setup-tag needed">{{ 'admin.dashboard.setup.needed' | transloco }}</span>
                            } @else {
                            <span class="setup-tag">{{ 'admin.dashboard.setup.optional' | transloco }}</span>
                            }
                        </div>
                        <p>{{ text(row.need.whyKey, row.need.why) }}</p>
                        <a class="btn btn-sm" [class.btn-primary]="!row.need.warning" [class.btn-warning]="row.need.warning" [routerLink]="row.item.route">
                            {{ (row.need.warning ? 'admin.dashboard.setup.check' : 'admin.dashboard.setup.set_up') | transloco }}
                            <span class="visually-hidden">: {{ text(row.need.titleKey, row.need.title) }}</span>
                        </a>
                    </div>
                </li>
                }
            </ul>
        </section>
        }
    `,
    styles: [`
        .setup-panel {
            background: white;
            border: 1px solid #e9ecef;
            border-radius: 12px;
            padding: 1.25rem;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
        }
        h2 { font-size: 1.1rem; font-weight: 600; margin: 0 0 0.25rem; }
        .setup-intro { color: #495057; font-size: 0.875rem; margin: 0 0 1rem; }
        ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.75rem; }
        .setup-row {
            display: flex;
            gap: 0.75rem;
            align-items: flex-start;
            padding: 0.75rem;
            border: 1px solid #e9ecef;
            border-radius: 10px;
        }
        .setup-row.warning { border-color: #f0c36d; background: #fff9e8; }
        .setup-icon {
            flex: 0 0 auto;
            width: 32px;
            height: 32px;
            border-radius: 8px;
            display: grid;
            place-items: center;
            background: color-mix(in srgb, var(--arc-admin-accent) 15%, #fff);
            color: var(--arc-admin-accent-dark);
        }
        .warning .setup-icon { background: #fdecc8; color: #8a5a00; }
        .setup-body { min-width: 0; flex: 1; }
        .setup-title { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; font-weight: 600; }
        .setup-tag {
            font-size: 0.7rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.03em;
            padding: 0.1rem 0.45rem;
            border-radius: 999px;
            background: #e9ecef;
            color: #495057;
        }
        .setup-tag.needed { background: #f8d7da; color: #842029; }
        .setup-body p { color: #495057; font-size: 0.875rem; margin: 0.25rem 0 0.5rem; }
    `],
})
export class SetupPanelComponent {
    readonly setup = inject(SetupStatusService);
    private transloco = inject(TranslocoService);

    /** The key's translation, or the text as written when there is no key or no translation for it. */
    text(key: string | undefined, fallback: string): string {
        if (!key) return fallback;
        const translated = this.transloco.translate(key);
        return translated && translated !== key ? translated : fallback;
    }
}
