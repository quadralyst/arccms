import { Component, ViewEncapsulation } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { HeaderComponent } from '../page.parts/header.component';
import { FooterComponent } from '../page.parts/footer.component';
import { ContentPartialsComponent } from '../page.parts/content-partials.component';
import { HomeBaseComponent } from '../page.parts/home-base.component';

/**
 * Hindi home page.
 *
 * Only the template differs — every behaviour comes from HomeBaseComponent.
 * Adding a language means: a folder under public/i18n/{lang}/ with an
 * index.html, a component like this one, a route in app.routes.ts, and an
 * entry in vite.config.ts's prerender list.
 */
@Component({
    selector: 'arc-home-hi',
    standalone: true,
    templateUrl: '../../../../public/i18n/hi/index.html',
    styleUrl: '../../../../public/assets/css/main.css',
    encapsulation: ViewEncapsulation.None,
    imports: [HeaderComponent, FooterComponent, ContentPartialsComponent, NgOptimizedImage],
})
export default class HomeHiComponent extends HomeBaseComponent {
    protected readonly pageLang = 'hi';
}
