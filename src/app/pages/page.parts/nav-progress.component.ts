import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * The thin bar along the top of the viewport that shows while the router is
 * between pages.
 *
 * It replaces the block-level spinner the app shell used to insert above the
 * outlet: that spinner was a 60vh flex item, so during the first client-side
 * navigation after hydration (and every admin navigation, where each
 * `admin/*` route mounts its own shell) it pushed the already-rendered page
 * down until NavigationEnd. This bar is fixed, so it takes no layout space,
 * covers nothing, and needs no knowledge of the admin sidebar.
 */
@Component({
    selector: 'arc-nav-progress',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="arc-nav-progress" role="progressbar" aria-label="Loading page" aria-busy="true">
            <div class="arc-nav-progress-bar"></div>
        </div>
    `,
    styles: [`
        .arc-nav-progress {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            height: 3px;
            z-index: 2000;
            background: rgba(0, 102, 204, 0.15);
            pointer-events: none;
            overflow: hidden;
        }

        .arc-nav-progress-bar {
            position: absolute;
            top: 0;
            bottom: 0;
            width: 40%;
            background: #0066cc;
            border-radius: 0 2px 2px 0;
            animation: arc-nav-progress-slide 1.1s ease-in-out infinite;
        }

        @keyframes arc-nav-progress-slide {
            0%   { left: -40%; }
            100% { left: 100%; }
        }

        @media (prefers-reduced-motion: reduce) {
            .arc-nav-progress-bar {
                animation: none;
                width: 100%;
                left: 0;
                opacity: 0.6;
            }
        }
    `],
})
export class NavProgressComponent {}
