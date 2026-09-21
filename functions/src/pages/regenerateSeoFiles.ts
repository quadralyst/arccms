import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { requireAdmin } from '../search/auth.js';
import { clearDiscoverabilityCache, getDiscoverabilitySettings } from '../shared/discoverability-settings.js';
import { HostingBatch, deployBatchToHosting } from './deployToHosting.js';
import { generateAndDeployRobotsTxt } from './generateRobotsTxt.js';
import { generateAndDeployLlmsTxt } from './generateLlmsTxt.js';
import { ensureIndexNowKey } from './indexNow.js';

/**
 * Applies Settings > Discoverability to Hosting right away
 * (docs/discoverability-spec.md, D3): robots.txt, llms.txt and the IndexNow
 * key file in one release. The same files also ride in every publish, so
 * this exists for the admin who wants to see the change now.
 */
export const regenerateSeoFiles = onCall({ timeoutSeconds: 300, memory: '512MiB' }, async (request) => {
    await requireAdmin(request);
    // The admin just saved the settings; do not serve the five-minute-old copy.
    clearDiscoverabilityCache();

    const batch = new HostingBatch();
    try {
        await generateAndDeployRobotsTxt(batch);
        await generateAndDeployLlmsTxt(batch);
        const settings = await getDiscoverabilitySettings();
        const indexNowKey = settings.indexNow.enabled ? await ensureIndexNowKey(batch) : '';
        await deployBatchToHosting(process.env.GCLOUD_PROJECT || '', batch, '', '');
        return {
            files: batch.files.map(f => f.path),
            removed: batch.removedPaths,
            indexNowKey,
        };
    } catch (error: any) {
        console.error('regenerateSeoFiles failed:', error);
        throw new HttpsError('internal', error?.message || 'Could not regenerate the SEO files.');
    }
});
