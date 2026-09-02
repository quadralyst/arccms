import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
    selector: 'arc-header',
    standalone: true,
    imports: [CommonModule],
    templateUrl: '../../../../public/_partials/_header.html',
    styleUrl: '../../../../public/assets/css/main.css',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeaderComponent {

    isMenuOpen = signal(false);

    toggleMenu() {
        this.isMenuOpen.set(!this.isMenuOpen());
    }
}
