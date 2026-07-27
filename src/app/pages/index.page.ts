import { RouteMeta } from '@analogjs/router';
import { Component, ViewEncapsulation } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { HeaderComponent } from './page.parts/header.component';
import { FooterComponent } from './page.parts/footer.component';
import { ContentPartialsComponent } from './page.parts/content-partials.component';
import { HomeBaseComponent } from './page.parts/home-base.component';

export const routeMeta: RouteMeta = {
  title: 'Home | Arc CMS',
};

/**
 * The default-language home page.
 *
 * Its behaviour lives in HomeBaseComponent so a translated home page is a
 * template swap rather than a copy of the waitlist and onboarding logic —
 * see src/app/pages/home-i18n/.
 */
@Component({
  selector: 'arc-home',
  standalone: true,
  templateUrl: '../../../public/index.html',
  styleUrl: '../../../public/assets/css/main.css',
  encapsulation: ViewEncapsulation.None,
  imports: [HeaderComponent, FooterComponent, ContentPartialsComponent, NgOptimizedImage],
})
export default class HomeComponent extends HomeBaseComponent {
  protected readonly pageLang = '';
}
