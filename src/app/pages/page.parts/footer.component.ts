import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
    selector: 'arc-footer',
    standalone: true,
    imports: [],
    templateUrl: '../../../../public/_partials/_footer.html',
    styleUrl: '../../../../public/assets/css/main.css',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FooterComponent { }
