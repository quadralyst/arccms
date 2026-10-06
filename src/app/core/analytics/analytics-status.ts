import type { AnalyticsConsentMode } from '../config/arc-config';

/**
 * Whether Google Analytics is recording visitors, in words an admin can act on
 * (docs/features/analytics.html). Shown on Settings, Analytics and on the dashboard.
 */
export type AnalyticsTrackingState =
    /** The `analytics` feature is off: nothing is tracked and nothing is shown. */
    | 'feature-off'
    /** The web config has no measurementId, so there is nowhere to send visits. */
    | 'no-measurement-id'
    /** `always`: every visitor is tracked. */
    | 'all-visitors'
    /** `required`, banner on: only visitors who accepted. */
    | 'consenting-visitors'
    /** `required`, banner off: nobody can accept, so nobody is tracked. */
    | 'nobody-banner-off';

export interface AnalyticsTrackingInputs {
    featureOn: boolean;
    measurementId: string | undefined;
    mode: AnalyticsConsentMode;
    bannerEnabled: boolean;
}

export function analyticsTrackingState(inputs: AnalyticsTrackingInputs): AnalyticsTrackingState {
    if (!inputs.featureOn) return 'feature-off';
    if (!inputs.measurementId) return 'no-measurement-id';
    if (inputs.mode === 'always') return 'all-visitors';
    return inputs.bannerEnabled ? 'consenting-visitors' : 'nobody-banner-off';
}
