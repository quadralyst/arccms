import { ChangeDetectionStrategy, Component, ViewEncapsulation } from '@angular/core';
import { ContentPartialsComponent } from './content-partials.component';

@Component({
    selector: 'arc-footer',
    standalone: true,
    imports: [ContentPartialsComponent],
    templateUrl: '../../../../public/_partials/_footer.html',
    styleUrl: '../../../../public/assets/css/main.css',
    encapsulation: ViewEncapsulation.None,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FooterComponent { }