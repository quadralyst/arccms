import {
  provideHttpClient,
  withFetch,
  withInterceptors,
} from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideClientHydration, withEventReplay, withIncrementalHydration } from '@angular/platform-browser';
import { provideAnimations } from '@angular/platform-browser/animations';
import { withComponentInputBinding } from '@angular/router';
import { provideFileRouter, requestContextInterceptor, withExtraRoutes } from '@analogjs/router';
import { siteFilesInterceptor } from './core/site/site-files.interceptor';

// Firebase imports
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { provideAuth, getAuth } from '@angular/fire/auth';
import { provideFirestore } from '@angular/fire/firestore';
import { provideStorage } from '@angular/fire/storage';
import { provideFunctions } from '@angular/fire/functions';

import { provideTransloco } from '@jsverse/transloco';
import { MatPaginatorIntl } from '@angular/material/paginator';

import { routes } from './app.routes';
import { environment } from '../environments/environment';
import { arcFirestore, arcFunctions, arcStorage } from './core/config/arc-firebase';
import { ADMIN_LANGUAGE_CODES, DEFAULT_ADMIN_LANGUAGE } from './core/i18n/admin-languages';
import { AdminTranslationLoader } from './core/i18n/translation.loader';
import { loadStartupLocaleData, provideAdminLocale } from './core/i18n/admin-locale.provider';
import { LanguageAreaService, MEMBER_LANGUAGE_LIST } from './core/i18n/member-language.service';
import { TranslatedPaginatorIntl } from './core/i18n/paginator-intl';
import { PwaService } from './core/pwa/pwa.service';
import { AnalyticsService } from './core/analytics/analytics.service';


export const appConfig: ApplicationConfig = {
  providers: [
    provideAnimations(),
    provideBrowserGlobalErrorListeners(),
    provideFileRouter(withExtraRoutes(routes), withComponentInputBinding()),
    provideHttpClient(
      withFetch(),
      withInterceptors([requestContextInterceptor, siteFilesInterceptor])
    ),
    provideClientHydration(withEventReplay(), withIncrementalHydration()),

    // Firebase Core Providers
    provideFirebaseApp(() => initializeApp(environment.firebaseConfig)),
    provideFirestore((injector) => arcFirestore(injector)),
    provideStorage((injector) => arcStorage(injector)),
    provideFunctions((injector) => arcFunctions(injector)),

    // Firebase Auth Provider
    provideAuth(() => getAuth()),

    // Admin UI translations (M6). The loader imports the JSON rather than
    // fetching it, so the server render has the same strings the browser
    // will — see core/i18n/translation.loader.ts.
    provideTransloco({
      config: {
        // The admin's languages, and the ones the app adds for its members (docs/app/member-languages.html).
        availableLangs: [...new Set([...ADMIN_LANGUAGE_CODES, ...MEMBER_LANGUAGE_LIST.map((l) => l.code)])],
        defaultLang: DEFAULT_ADMIN_LANGUAGE,
        // A key missing from a translation falls back to English rather than
        // rendering the key itself. This is what makes M7 shippable in
        // batches: a half-swept admin reads as half-translated, not broken.
        fallbackLang: DEFAULT_ADMIN_LANGUAGE,
        missingHandler: { useFallbackTranslation: true, logMissingKey: !environment.production },
        reRenderOnLangChange: true,
        prodMode: environment.production,
      },
      loader: AdminTranslationLoader,
    }),
    provideAdminLocale(),
    // Member languages: their locale data before the first render, and the language per area.
    provideAppInitializer(() => loadStartupLocaleData()),
    provideAppInitializer(() => { inject(LanguageAreaService); }),
    // Material's paginator ships its own English; see paginator-intl.ts.
    { provide: MatPaginatorIntl, useClass: TranslatedPaginatorIntl },

    // The installable app: service worker, update bar, install counts (docs/features/pwa.html).
    // Does nothing unless src/custom/pwa.ts turns it on.
    provideAppInitializer(() => inject(PwaService).start()),

    // Google Analytics 4: AnalyticsService loads it on demand, in its own chunk, and only
    // with the feature on and, in `required` mode, after consent (docs/features/analytics.html).
    // Started before the first navigation, so a page with data: { analytics: false }
    // is never tracked, not even the page a visit starts on.
    provideAppInitializer(() => { inject(AnalyticsService); }),
  ],
};

