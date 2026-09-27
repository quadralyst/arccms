import { getSiteConfig } from '../shared/site-settings.js';
import { getDiscoverabilitySettings, type DiscoverabilitySettings } from '../shared/discoverability-settings.js';
import { CRAWLERS } from '../shared/crawlers.js';
import { deploySeoFileToHosting } from './deploySeoFile.js';
import type { HostingBatch } from './deployToHosting.js';

/**
 * The robots.txt text for a site (docs/discoverability-spec.md, D-D6).
 *
 * Everything is allowed by default; only crawlers the owner switched off get
 * a `Disallow: /` group of their own. An allowed AI crawler needs no
 * mention: the `User-agent: *` group already covers it, and listing it with
 * `Allow: /` would only invite copy-paste drift. Pure, for the tests.
 */
export function renderRobotsTxt(baseUrl: string, settings: DiscoverabilitySettings): string {
    const base = baseUrl.replace(/\/+$/, '');
    const lines: string[] = ['User-agent: *', 'Allow: /', ''];

    const denied = CRAWLERS.filter(agent => settings.crawlers[agent.id] === false);
    if (denied.length) {
        lines.push('# AI crawlers switched off in Settings > Discoverability');
        for (const agent of denied) {
            lines.push(`User-agent: ${agent.userAgent}`, 'Disallow: /', '');
        }
    }

    lines.push(`Sitemap: ${base}/sitemap.xml`);
    if (settings.llmsTxt) {
        // Not a robots directive; a pointer for people and tools reading the file.
        lines.push(`# LLM-friendly index: ${base}/llms.txt`);
    }
    lines.push('');
    return lines.join('\n');
}

/**
 * Generates and deploys robots.txt. With a batch, the file rides along in
 * the caller's release; without one it is released on its own.
 */
export async function generateAndDeployRobotsTxt(batch?: HostingBatch): Promise<void> {
    const [siteConfig, settings] = await Promise.all([getSiteConfig(), getDiscoverabilitySettings()]);
    await deploySeoFileToHosting('/robots.txt', renderRobotsTxt(siteConfig.baseUrl, settings), batch);
}
