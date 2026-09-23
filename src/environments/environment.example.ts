/**
 * Example Environment Configuration
 *
 * Copy this file to create your environment files:
 *   - environment.ts       (development)
 *   - environment.prod.ts  (production)
 *
 * Then fill in your Firebase project credentials from the Firebase Console:
 *   Project Settings > General > Your Apps > Firebase SDK snippet
 */

export const environment = {
    production: false,

    // Firebase configuration
    // Get these values from https://console.firebase.google.com
    // Project Settings > General > Your Apps > Web App
    firebaseConfig: {
        apiKey: 'YOUR_API_KEY',
        authDomain: 'your-project.firebaseapp.com',
        databaseURL: 'https://your-project.firebaseio.com',
        projectId: 'your-project-id',
        storageBucket: 'your-project.appspot.com',
        messagingSenderId: 'YOUR_MESSAGING_SENDER_ID',
        appId: 'YOUR_APP_ID',
        measurementId: 'G-YOUR_MEASUREMENT_ID',
    },

    // Optional. Leave this out for a normal install: ArcCMS then uses the
    // (default) Firestore database, the storageBucket above and uploads at the
    // bucket root. Set it only when ArcCMS shares its Firebase project with
    // another app (docs/coexistence-spec.md).
    // arc: {
    //     databaseId: 'arccms',
    //     storageBucket: 'your-project-arccms',
    //     storagePrefix: '',
    // },
};
