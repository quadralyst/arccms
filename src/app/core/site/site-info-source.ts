/**
 * What data-arc-site prints in the app (specs/site-sections-spec.md, SS3 and SS6):
 * Settings, About, this year, and the published standard pages, as publishing
 * builds it (functions/src/shared/site-info-source.ts).
 */
import type { IAboutSettings } from '../../pages/admin/(settings)/about/about-settings.model';
import type { SiteInfoSource, SitePageLink } from '../../../shared/utils/site-info';

export function siteInfoOf(identity: IAboutSettings | null | undefined, pages: readonly SitePageLink[] = []): SiteInfoSource {
    return { ...(identity ?? {}), year: new Date().getFullYear(), pages: [...pages] };
}
