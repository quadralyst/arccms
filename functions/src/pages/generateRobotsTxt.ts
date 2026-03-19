import { getSiteConfig } from '../shared/site-settings.js';
import { deploySeoFileToHosting } from './deploySeoFile.js';

/**
 * Generates and deploys a robots.txt file to Firebase Hosting.
 *
 * Output format:
 *   User-agent: *
 *   Allow: /
 *   Sitemap: {baseUrl}/sitemap.xml
 */
export async function generateAndDeployRobotsTxt(): Promise<void> {
    const siteConfig = await getSiteConfig();
    const baseUrl = siteConfig.baseUrl.replace(/\/+$/, '');

    const robotsTxt = [
        'User-agent: *',
        'Allow: /',
        '',
        `Sitemap: ${baseUrl}/sitemap.xml`,
        '',
    ].join('\n');

    await deploySeoFileToHosting('/robots.txt', robotsTxt);
}
