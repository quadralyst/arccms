import { ChangeDetectionStrategy, Component } from '@angular/core';
import { footer } from 'virtual:arc-site';
import { renderSiteFragment } from './site-fragment';
import { useSiteStyles } from '../../core/site/site-styles';

/**
 * The site footer: the site's own /_site/footer.html (src/custom/site/footer.html,
 * else Arc CMS's), the same file publishing puts on every static page.
 * ngSkipHydration for the same reason as the header.
 */
@Component({
    selector: 'arc-footer',
    standalone: true,
    template: '',
    host: { ngSkipHydration: 'true' },
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FooterComponent {
    constructor() {
        // The website's stylesheets, on while the header or footer is shown (site-styles.ts).
        useSiteStyles(['main', 'site']);
        renderSiteFragment(footer, {});
    }
}
