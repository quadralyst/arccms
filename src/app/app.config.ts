import {
  provideHttpClient,
  withFetch,
  withInterceptors,
} from '@angular/common/http';
import {
  ApplicationConfig,
  EnvironmentProviders,
  Provider,
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
import { getAnalytics, provideAnalytics, ScreenTrackingService, UserTrackingService } from '@angular/fire/analytics';

import { provideTransloco } from '@jsverse/transloco';
import { MatPaginatorIntl } from '@angular/material/paginator';

import { routes } from './app.routes';
import { environment } from '../environments/environment';
import { arcFirestore, arcFunctions, arcStorage } from './core/config/arc-firebase';
import { ADMIN_LANGUAGE_CODES, DEFAULT_ADMIN_LANGUAGE } from './core/i18n/admin-languages';
import { AdminTranslationLoader } from './core/i18n/translation.loader';
import { provideAdminLocale } from './core/i18n/admin-locale.provider';
import { TranslatedPaginatorIntl } from './core/i18n/paginator-intl';
import { PwaService } from './core/pwa/pwa.service';
import { AnalyticsService } from './core/analytics/analytics.service';
import { arcConfig } from './core/config/arc-config';
import { isOn } from './core/features/features';

// Google Analytics, exactly as before, for an install that tracks every visitor
// (analyticsConsent `always`, the default). With `required`, AnalyticsService loads it
// only after consent; with the analytics feature off, nothing loads
// (docs/features/analytics.html). Browser only.
const analyticsProviders: (Provider | EnvironmentProviders)[] = typeof window !== 'undefined'
  && isOn('analytics') && arcConfig.analyticsConsent === 'always'
  ? [
    provideAnalytics(() => getAnalytics()),
    ScreenTrackingService,
    UserTrackingService,
  ]
  : [];

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
        availableLangs: [...ADMIN_LANGUAGE_CODES],
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
    // Material's paginator ships its own English; see paginator-intl.ts.
    { provide: MatPaginatorIntl, useClass: TranslatedPaginatorIntl },

    // The installable app: service worker, update bar, install counts (docs/features/pwa.html).
    // Does nothing unless src/custom/pwa.ts turns it on.
    provideAppInitializer(() => inject(PwaService).start()),

    // Google Analytics 4 - Automatic screen/user tracking (browser-only)
    ...analyticsProviders,
    // Started before the first navigation, so a page with data: { analytics: false }
    // is never tracked, not even the page a visit starts on.
    provideAppInitializer(() => { inject(AnalyticsService); }),
  ],
};

