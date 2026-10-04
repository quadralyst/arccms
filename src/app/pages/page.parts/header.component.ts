import { ChangeDetectionStrategy, Component } from '@angular/core';
import { header } from 'virtual:arc-site';
import { LanguageSwitcherComponent } from './language-switcher.component';
import { PublicSearchComponent } from './public-search.component';
import { renderSiteFragment } from './site-fragment';
import { useSiteStyles } from '../../core/site/site-styles';

/**
 * The site header: the site's own /_site/header.html (src/custom/site/header.html,
 * else Arc CMS's), the same file publishing puts on every static page. Its
 * <arc-search> and <arc-language-switcher> become the real components; the
 * switcher renders nothing on a single-language site.
 *
 * ngSkipHydration: the HTML is placed by code, not by a compiled template, so a
 * prerendered copy is rendered afresh in the browser rather than hydrated.
 */
@Component({
    selector: 'arc-header',
    standalone: true,
    template: '',
    host: { ngSkipHydration: 'true' },
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeaderComponent {
    constructor() {
        // The website's stylesheets, on while the header or footer is shown (site-styles.ts).
        useSiteStyles(['main', 'site']);
        renderSiteFragment(header, {
            'arc-search': PublicSearchComponent,
            'arc-language-switcher': LanguageSwitcherComponent,
        });
    }
}
