import { mergeApplicationConfig, ApplicationConfig } from '@angular/core';
import { provideServerRendering } from '@angular/platform-server';

import { appConfig } from './app.config';

// Firebase SSR imports
import { initializeServerApp, provideFirebaseApp } from '@angular/fire/app';
import { provideAuth, getAuth } from '@angular/fire/auth';
import { provideFirestore } from '@angular/fire/firestore';
import { provideStorage } from '@angular/fire/storage';
import { getFunctions, provideFunctions } from '@angular/fire/functions';
import { environment } from '../environments/environment';
import { arcFirestore, arcStorage } from './core/config/arc-firebase';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(),
    // Override client Firebase config with server-safe versions
    provideFirebaseApp(() => initializeServerApp(environment.firebaseConfig, {})),
    provideFirestore((injector) => arcFirestore(injector)),
    provideStorage((injector) => arcStorage(injector)),
    provideFunctions(() => getFunctions()),
    provideAuth(() => getAuth()),
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);

