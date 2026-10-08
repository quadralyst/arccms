/**
 * The site's name and logo, wherever Arc CMS shows them: the admin's side panel, the
 * sign-in page, the member area, the browser tab and `og:site_name`
 * (docs/app/admin-look.html, specs/admin-brand-spec.md AB-D7).
 *
 * Field by field: Settings, About; then the app's default (src/custom/brand.ts for the
 * name, src/custom/logo.* for the logo); then Arc CMS's, only when no layer has a name
 * or a logo. A name with no logo shows no logo, never Arc CMS's beside another name.
 */
import { Injectable, computed, inject } from '@angular/core';
import { CUSTOM_BRAND } from '../../../custom/brand';
import { SiteIdentityService } from '../services/site-identity.service';
import { APP_LOGO } from './app-brand-files';

/** What an app declares in src/custom/brand.ts. */
export interface CustomBrand {
    /** The site's name until an admin sets one in Settings, About. */
    name?: string;
    /**
     * A core page's own title, by route path ('/admin/users', '/user/profile'), in place
     * of the page's generic name. The site's name is still added after it.
     */
    titles?: Record<string, string>;
}

export interface SiteBrand {
    name: string;
    /** A URL, or '' for none. */
    logo: string;
    /** Whether this is Arc CMS's own name and logo: the site has set neither. */
    arc: boolean;
}

export const ARC_CMS_NAME = 'Arc CMS';
/** Arc CMS's own logo, for a site that has not named itself yet. */
export const ARC_CMS_LOGO = '/assets/images/logo.png';

/** The app's own default name and logo. */
export const APP_BRAND = { name: CUSTOM_BRAND.name ?? '', logo: APP_LOGO };

export function siteBrand(
    identity: { name?: string; logoUrl?: string },
    app: { name?: string; logo?: string } = APP_BRAND,
): SiteBrand {
    const name = identity.name?.trim() || app.name?.trim() || '';
    const logo = identity.logoUrl?.trim() || app.logo?.trim() || '';
    if (!name && !logo) return { name: ARC_CMS_NAME, logo: ARC_CMS_LOGO, arc: true };
    return { name, logo, arc: false };
}

/** The site's brand once Settings, About has loaded; null until then, so Arc CMS's never flashes. */
@Injectable({ providedIn: 'root' })
export class SiteBrandService {
    private identity = inject(SiteIdentityService);

    readonly brand = computed<SiteBrand | null>(() =>
        this.identity.loaded() ? siteBrand(this.identity.identity()) : null,
    );

    /** The name, or '' until it is known. */
    readonly name = computed(() => this.brand()?.name ?? '');

    load(): Promise<unknown> {
        return this.identity.load();
    }
}
