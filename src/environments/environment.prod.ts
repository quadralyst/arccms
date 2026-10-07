/**
 * Production Environment Configuration
 *
 * Arc CMS ships this file with no Firebase project, so a new copy never talks to
 * someone else's. A production build without ARC_PROJECT uses the project of your
 * `default` alias when arc:configure has written its firebase-web.<projectId>.ts,
 * else this file, which then must name your project (docs/app/environments.html).
 * Once you fill it in it is yours: Arc CMS never changes its values.
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
