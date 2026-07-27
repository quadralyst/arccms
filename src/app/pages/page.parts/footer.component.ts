import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LangHrefDirective } from '../../core/directives/lang-href.directive';

@Component({
    selector: 'arc-footer',
    standalone: true,
    imports: [LangHrefDirective],
    templateUrl: '../../../../public/_partials/_footer.html',
    styleUrl: '../../../../public/assets/css/main.css',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FooterComponent { }
