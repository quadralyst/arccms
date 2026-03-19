import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { GlobalMessageService } from '../admin/(settings)/message/global-message.service';
import { getGradientById, IGlobalMessageSettings } from '../admin/(settings)/message/global-message.model';

/**
 * Global Message Banner Component
 * Displays at the top of all pages when enabled by admin
 */
@Component({
    selector: 'arc-global-message-banner',
    standalone: true,
    imports: [CommonModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (settings().isEnabled) {
        <div class="arc-global-banner" [style.background]="getGradient()">
            <div class="arc-global-banner__content" [style.color]="getTextColor()">
                <div class="arc-global-banner__text">
                    <strong class="arc-global-banner__heading">{{ settings().heading }}</strong>
                    <span class="arc-global-banner__message">{{ settings().message }}</span>
                </div>
                @if (settings().buttonLabel && settings().buttonLink) {
                <a [href]="settings().buttonLink"
                   class="arc-global-banner__btn"
                   [style.borderColor]="getTextColor()"
                   [style.color]="getTextColor()"
                   target="_blank"
                   rel="noopener noreferrer">
                    {{ settings().buttonLabel }}
                </a>
                }
            </div>
        </div>
        }
    `,
    styles: [`
        .arc-global-banner {
            width: 100%;
            padding: 10px 20px;
            z-index: 9999;
        }

        .arc-global-banner__content {
            max-width: 1400px;
            margin: 0 auto;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 20px;
            flex-wrap: wrap;
        }

        .arc-global-banner__text {
            display: flex;
            align-items: center;
            gap: 12px;
            flex-wrap: wrap;
            justify-content: center;
            text-align: center;
        }

        .arc-global-banner__heading {
            font-size: 0.95rem;
            font-weight: 600;
        }

        .arc-global-banner__message {
            font-size: 0.875rem;
            opacity: 0.95;
        }

        .arc-global-banner__btn {
            padding: 6px 18px;
            border: 2px solid;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 600;
            text-decoration: none;
            background: transparent;
            transition: all 0.2s ease;
            white-space: nowrap;
        }

        .arc-global-banner__btn:hover {
            opacity: 0.85;
            transform: translateY(-1px);
        }

        @media (max-width: 768px) {
            .arc-global-banner {
                padding: 8px 12px;
            }

            .arc-global-banner__content {
                flex-direction: column;
                gap: 10px;
            }

            .arc-global-banner__text {
                flex-direction: column;
                gap: 4px;
            }

            .arc-global-banner__heading {
                font-size: 0.875rem;
            }

            .arc-global-banner__message {
                font-size: 0.8rem;
            }
        }
    `],
})
export class GlobalMessageBannerComponent {
    private globalMessageService = inject(GlobalMessageService);

    // toSignal wires the BehaviorSubject into the signal graph before the first
    // CD pass, so Angular never sees a mid-check mutation (fixes NG0100).
    // requireSync is safe here because settings$ is a BehaviorSubject — it always
    // emits synchronously on subscription, so there is no undefined initial state.
    settings = toSignal(this.globalMessageService.settings$, { requireSync: true });

    getGradient(): string {
        const gradientId = this.settings().gradientId || 'info-blue';
        return getGradientById(gradientId).gradient;
    }

    getTextColor(): string {
        const gradientId = this.settings().gradientId || 'info-blue';
        return getGradientById(gradientId).textColor;
    }
}
