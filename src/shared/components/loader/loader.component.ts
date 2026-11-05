/**
 * The one loader of the admin, for an app's own pages too (docs/app/loader.html): a shimmer
 * in the place of what is coming, with a name a screen reader says. Still for someone who
 * asks their device for less motion.
 *
 *     @if (loading()) { <arc-loader kind="rows" [count]="5" /> }
 *
 * `kind`: `lines` for text, `rows` for a list or table, `block` for a card or a picture.
 * `label` names what is coming, such as "Loading orders"; "Loading..." in the person's
 * language without one. Colours come from --arc-loader-base and --arc-loader-shine, its
 * height from --arc-loader-height.
 */
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

export type LoaderKind = 'lines' | 'rows' | 'block';

@Component({
    selector: 'arc-loader',
    standalone: true,
    imports: [TranslocoPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="arc-loader" [class]="'arc-loader-' + kind()" role="status">
            <span class="arc-loader-name">{{ label() || ('common.state.loading' | transloco) }}</span>
            @for (bar of bars(); track bar) {
            <span class="arc-loader-bar" aria-hidden="true"></span>
            }
        </div>
    `,
    styles: [`
        :host { display: block; }
        .arc-loader { display: flex; flex-direction: column; gap: 0.75rem; padding: 0.5rem 0; }
        /* Hidden on screen, said by a screen reader. */
        .arc-loader-name {
            position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden;
            clip-path: inset(50%); white-space: nowrap; border: 0;
        }
        .arc-loader-bar {
            display: block; border-radius: 6px; height: var(--arc-loader-height, 1rem);
            background: linear-gradient(90deg, var(--arc-loader-base, #e9ecef) 25%, var(--arc-loader-shine, #f6f7f9) 50%, var(--arc-loader-base, #e9ecef) 75%);
            background-size: 200% 100%;
            animation: arc-loader-shimmer 1.5s linear infinite;
        }
        .arc-loader-lines .arc-loader-bar:last-child { width: 60%; }
        .arc-loader-rows .arc-loader-bar { height: var(--arc-loader-height, 2.75rem); }
        .arc-loader-block .arc-loader-bar { height: var(--arc-loader-height, 10rem); border-radius: 12px; }
        @keyframes arc-loader-shimmer {
            from { background-position: 200% 0; }
            to { background-position: -200% 0; }
        }
        @media (prefers-reduced-motion: reduce) {
            .arc-loader-bar { animation: none; }
        }
    `],
})
export class LoaderComponent {
    readonly kind = input<LoaderKind>('lines');
    /** How many bars. */
    readonly count = input(3);
    /** What a screen reader says; "Loading..." in the person's language without one. */
    readonly label = input('');

    readonly bars = computed(() => Array.from({ length: Math.max(1, this.count()) }, (_, i) => i));
}
