import { TranslocoPipe } from '@jsverse/transloco';
import { Component, Input } from '@angular/core';

@Component({
    selector: 'arc-loading',
    standalone: true,
    imports: [TranslocoPipe],
    templateUrl: './loading.component.html',
    styleUrl: './loading.component.scss',
})
export class LoadingComponent {
    @Input() isLoading = false;
}
