import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LanguageSwitcherComponent } from './language-switcher.component';
import { PublicSearchComponent } from './public-search.component';
import { ArcTranslateDirective } from '../../core/directives/arc-translate.directive';
import { LangHrefDirective } from '../../core/directives/lang-href.directive';

@Component({
    selector: 'arc-header',
    standalone: true,
    // The header partial carries <arc-language-switcher> and <arc-search>.
    // In statically published pages the publish pipeline substitutes them;
    // here they are real components. The switcher renders nothing on a
    // single-language site.
    imports: [LanguageSwitcherComponent, PublicSearchComponent, ArcTranslateDirective, LangHrefDirective],
    templateUrl: '../../../../public/_partials/_header.html',
    styleUrl: '../../../../public/assets/css/main.css',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeaderComponent { }
