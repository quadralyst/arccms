/**
 * The dashboard's "Finish setting up" panel (docs/features/setup-panel.html): each
 * outside service still to connect, with why and a link to its settings page. Shows
 * nothing until the checks have answered, and nothing once every item is done.
 */
import { Component, ElementRef, Injector, afterNextRender, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { SetupStatusService } from './setup-status.service';

@Component({
    selector: 'arc-setup-panel',
    standalone: true,
    imports: [RouterLink, TranslocoPipe],
    template: `
        @if (setup.loaded() && setup.rows().length) {
        @if (setup.collapsed()) {
        <button type="button" class="setup-todo" data-testid="setup-todo" [class.needed]="hasNeeded()"
            aria-expanded="false" aria-controls="setup-panel" (click)="toggle(false)"
            [attr.aria-label]="'admin.dashboard.setup.show' | transloco: { count: setup.rows().length }">
            <i class="fa-solid fa-list-check" aria-hidden="true"></i>
            <span>{{ 'admin.dashboard.setup.heading' | transloco }}</span>
            <span class="setup-count" aria-hidden="true">{{ setup.rows().length }}</span>
        </button>
        } @else {
        <section id="setup-panel" class="setup-panel" data-testid="setup-panel" aria-labelledby="setup-panel-heading">
            <div class="setup-head">
                <h2 id="setup-panel-heading">{{ 'admin.dashboard.setup.heading' | transloco }}</h2>
                <span class="setup-count" [class.needed]="hasNeeded()" aria-hidden="true">{{ setup.rows().length }}</span>
                <button type="button" class="btn btn-sm btn-link setup-collapse" data-testid="setup-collapse"
                    aria-expanded="true" aria-controls="setup-panel" (click)="toggle(true)"
                    [attr.aria-label]="'admin.dashboard.setup.collapse' | transloco" [attr.title]="'admin.dashboard.setup.collapse' | transloco">
                    <i class="fa-solid fa-minus" aria-hidden="true"></i>
                </button>
            </div>
            <ul>
                @for (row of setup.rows(); track row.item.id) {
                <li class="setup-row" [class.warning]="row.need.warning" [attr.data-setup-id]="row.item.id">
                    <span class="setup-icon" aria-hidden="true"><i [class]="row.item.icon"></i></span>
                    <div class="setup-body">
                        <div class="setup-title">
                            <span class="setup-name">{{ text(row.need.titleKey, row.need.title) }}</span>
                            @if (row.need.required) {
                            <span class="setup-tag needed">{{ 'admin.dashboard.setup.needed' | transloco }}</span>
                            } @else {
                            <span class="setup-tag">{{ 'admin.dashboard.setup.optional' | transloco }}</span>
                            }
                            <a class="btn btn-sm setup-go" [class.btn-primary]="!row.need.warning" [class.btn-warning]="row.need.warning" [routerLink]="row.item.route">
                                {{ (row.need.warning ? 'admin.dashboard.setup.check' : 'admin.dashboard.setup.set_up') | transloco }}
                                <span class="visually-hidden">: {{ text(row.need.titleKey, row.need.title) }}</span>
                            </a>
                        </div>
                        <p>{{ text(row.need.whyKey, row.need.why) }}</p>
                    </div>
                </li>
                }
            </ul>
        </section>
        }
        }
    `,
    styles: [`
        .setup-panel {
            background: white;
            border: 1px solid #e9ecef;
            border-radius: 12px;
            padding: 0.875rem;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
        }
        .setup-head { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.625rem; }
        h2 { font-size: 1rem; font-weight: 600; margin: 0; }
        .setup-collapse { margin-left: auto; color: #495057; padding: 0.15rem 0.4rem; line-height: 1; }
        .setup-collapse:hover, .setup-collapse:focus-visible { color: #212529; background: #f1f3f5; }
        ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.5rem; }
        .setup-row {
            display: flex;
            gap: 0.5rem;
            align-items: flex-start;
            padding: 0.5rem 0.625rem;
            border: 1px solid #e9ecef;
            border-radius: 8px;
        }
        .setup-row.warning { border-color: #f0c36d; background: #fff9e8; }
        .setup-icon {
            flex: 0 0 auto;
            width: 26px;
            height: 26px;
            border-radius: 6px;
            display: grid;
            place-items: center;
            font-size: 0.8rem;
            background: color-mix(in srgb, var(--arc-admin-accent) 15%, #fff);
            color: var(--arc-admin-accent-dark);
        }
        .warning .setup-icon { background: #fdecc8; color: #8a5a00; }
        .setup-body { min-width: 0; flex: 1; }
        .setup-title { display: flex; flex-wrap: wrap; align-items: center; gap: 0.375rem; min-height: 26px; }
        .setup-name { font-weight: 600; font-size: 0.9rem; }
        .setup-tag {
            font-size: 0.625rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.03em;
            padding: 0.05rem 0.4rem;
            border-radius: 999px;
            background: #e9ecef;
            color: #495057;
        }
        .setup-tag.needed { background: #f8d7da; color: #842029; }
        .setup-go { margin-left: auto; padding: 0.1rem 0.5rem; font-size: 0.75rem; }
        .setup-body p { color: #495057; font-size: 0.8125rem; line-height: 1.35; margin: 0.125rem 0 0; }
        .setup-count {
            min-width: 1.5rem;
            padding: 0.05rem 0.45rem;
            border-radius: 999px;
            background: #8a5a00;
            color: #fff;
            font-size: 0.75rem;
            font-weight: 600;
            text-align: center;
        }
        .setup-count.needed, .setup-todo.needed .setup-count { background: #dc3545; }
        .setup-todo {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            border: 1px solid #f0c36d;
            background: #fff9e8;
            color: #8a5a00;
            border-radius: 999px;
            padding: 0.35rem 0.5rem 0.35rem 0.85rem;
            font-weight: 600;
            font-size: 0.875rem;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
        }
        .setup-todo:hover { filter: brightness(0.97); }
        .setup-todo:focus-visible { outline: 2px solid var(--arc-admin-accent); outline-offset: 2px; }
        .setup-todo.needed { border-color: #f1aeb5; background: #fdecee; color: #842029; }
    `],
})
export class SetupPanelComponent {
    readonly setup = inject(SetupStatusService);
    private transloco = inject(TranslocoService);

    private host = inject<ElementRef<HTMLElement>>(ElementRef);
    private injector = inject(Injector);

    /** Folds or opens the panel, and keeps keyboard focus on the button that takes its place. */
    toggle(collapsed: boolean): void {
        this.setup.setCollapsed(collapsed);
        const next = collapsed ? '[data-testid="setup-todo"]' : '[data-testid="setup-collapse"]';
        afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(next)?.focus(), { injector: this.injector });
    }

    /** Any needed row left: the folded button and the count are red rather than amber. */
    hasNeeded(): boolean {
        return this.setup.rows().some((r) => r.need.required);
    }

    /** The key's translation, or the text as written when there is no key or no translation for it. */
    text(key: string | undefined, fallback: string): string {
        if (!key) return fallback;
        const translated = this.transloco.translate(key);
        return translated && translated !== key ? translated : fallback;
    }
}
