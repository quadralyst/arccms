/** App user merge fields (CO6.5a). */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../init', () => ({ firestoreFor: vi.fn() }));

import { appMergeFields } from '../app-audience/mergeFields.js';

describe('appMergeFields', () => {
    it('flattens the host document and leaves credential-like fields out entirely', () => {
        expect(appMergeFields({ name: 'Asha', isPro: true, plan: { tier: 'pro' }, password: 'hunter2', auth: { apiKey: 'k' } }))
            .toEqual({ name: 'Asha', isPro: 'true', 'plan.tier': 'pro' });
    });
});
