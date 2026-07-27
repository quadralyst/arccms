import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LanguageSwitcherComponent } from './language-switcher.component';

@Component({
    selector: 'arc-header',
    standalone: true,
    // The header partial carries <arc-language-switcher>. In statically
    // published pages the publish pipeline substitutes it; here it is a real
    // component. Both render nothing on a single-language site.
    imports: [LanguageSwitcherComponent],
    templateUrl: '../../../../public/_partials/_header.html',
    styleUrl: '../../../../public/assets/css/main.css',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeaderComponent { }
