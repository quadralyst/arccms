import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
    selector: 'arc-header',
    standalone: true,
    imports: [],
    templateUrl: '../../../../public/_partials/_header.html',
    styleUrl: '../../../../public/assets/css/main.css',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeaderComponent { }
