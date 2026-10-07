/**
 * Development Environment Configuration
 *
 * Arc CMS ships this file with no Firebase project, so a new copy never talks to
 * someone else's: `npm run dev` stops and says to run `npm run arc:configure`.
 * Set up your project with arc:configure (docs/app/environments.html), which writes
 * src/environments/firebase-web.<projectId>.ts; `npm run dev` then uses the project
 * of your `default` alias. Or fill in your own web settings here: from then on this
 * file is yours, and Arc CMS never changes its values.
 */

export const environment = {
    production: false,

    firebaseConfig: {
        apiKey: '',
        authDomain: '',
        projectId: '',
        storageBucket: '',
        messagingSenderId: '',
        appId: '',
    },
};
