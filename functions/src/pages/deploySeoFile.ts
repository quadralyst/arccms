import { HostingBatch, deployBatchToHosting } from './deployToHosting.js';
import { arcHostingSite } from '../arc-config.js';

/**
 * Deploys one SEO file (robots.txt, sitemap.xml, an RSS feed, llms.txt) to
 * Firebase Hosting. These belong to no content document, so nothing records
 * their deploy status.
 *
 * With a batch (a publish, the seed, a whole-site republish), the file rides
 * along in the caller's release instead of racing the content pages: see
 * HostingBatch. Without one, it is a release of its own, through the same
 * deployBatchToHosting as every other release, so it holds the site's release
 * lock and builds on the version released last (hosting-release-lock.ts).
 * Prefer a batch when writing several files: each call without one is a
 * release, and releases to a site run one at a time.
 *
 * Throws when a release of its own does not go out, so a caller can report it.
 */
export async function deploySeoFileToHosting(
    filePath: string,
    fileContent: string,
    batch?: HostingBatch,
): Promise<void> {
    if (batch) {
        batch.add(filePath, fileContent);
        return;
    }

    const siteId = arcHostingSite();
    if (!siteId) return; // Hosting is off for this install (CO5).

    let reason = '';
    const released = await deployBatchToHosting(siteId, new HostingBatch().add(filePath, fileContent), '', '', {
        onFailure: (failure) => { reason = `${failure.code}: ${failure.message}`; },
    });
    if (!released) throw new Error(`Could not release ${filePath} to Hosting${reason ? ` (${reason})` : ''}`);
}
