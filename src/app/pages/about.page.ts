import { RouteMeta } from '@analogjs/router';
import { AfterViewInit, Component, ElementRef, inject, OnDestroy, PLATFORM_ID, ViewEncapsulation } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HeaderComponent } from './page.parts/header.component';
import { FooterComponent } from './page.parts/footer.component';

export const routeMeta: RouteMeta = {
  title: 'About GoWow - Infrastructure for Goodness | India\'s Verified Network for Social Impact',
  meta: [
    {
      name: 'description',
      content: 'We build the infrastructure that lets goodness find its way — connecting volunteers, corporates, donors and NGOs on one verified platform.',
    },
  ],
};

@Component({
  selector: 'arc-about',
  standalone: true,
  templateUrl: '../../../public/pages/about.html',
  styleUrl: '../../../public/assets/css/about.css',
  encapsulation: ViewEncapsulation.None,
  imports: [CommonModule, HeaderComponent, FooterComponent],
})
export default class AboutPageComponent {
}
