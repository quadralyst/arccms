import {
  provideHttpClient,
  withFetch,
  withInterceptors,
} from '@angular/common/http';
import {
  ApplicationConfig,
  EnvironmentProviders,
  Provider,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideClientHydration, withEventReplay, withIncrementalHydration } from '@angular/platform-browser';
import { provideAnimations } from '@angular/platform-browser/animations';
import { withComponentInputBinding } from '@angular/router';
import { provideFileRouter, requestContextInterceptor, withExtraRoutes } from '@analogjs/router';

// Firebase imports
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { provideAuth, getAuth } from '@angular/fire/auth';
import { getFirestore, provideFirestore } from '@angular/fire/firestore';
import { getStorage, provideStorage } from '@angular/fire/storage';
import { getFunctions, provideFunctions } from '@angular/fire/functions';
import { getAnalytics, provideAnalytics, ScreenTrackingService, UserTrackingService } from '@angular/fire/analytics';

import { provideTransloco } from '@jsverse/transloco';
import { MatPaginatorIntl } from '@angular/material/paginator';

import { routes } from './app.routes';
import { environment } from '../environments/environment';
import { ADMIN_LANGUAGE_CODES, DEFAULT_ADMIN_LANGUAGE } from './core/i18n/admin-languages';
import { AdminTranslationLoader } from './core/i18n/translation.loader';
import { provideAdminLocale } from './core/i18n/admin-locale.provider';
import { TranslatedPaginatorIntl } from './core/i18n/paginator-intl';

// Analytics requires `window` and must only run in the browser.
// During SSR, `typeof window` is 'undefined', so we skip these providers.
const analyticsProviders: (Provider | EnvironmentProviders)[] = typeof window !== 'undefined'
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
      withInterceptors([requestContextInterceptor])
    ),
    provideClientHydration(withEventReplay(), withIncrementalHydration()),

    // Firebase Core Providers
    provideFirebaseApp(() => initializeApp(environment.firebaseConfig)),
    provideFirestore(() => getFirestore()),
    provideStorage(() => getStorage()),
    provideFunctions(() => getFunctions()),

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

    // Google Analytics 4 - Automatic screen/user tracking (browser-only)
    ...analyticsProviders,
  ],
};

