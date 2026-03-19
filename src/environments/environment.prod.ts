/**
 * Production Environment Configuration
 *
 * Copy environment.example.ts and fill in your Firebase credentials.
 * See INSTALL.md for setup instructions.
 */

export const environment = {
    production: true,

    firebaseConfig: {
        apiKey: 'YOUR_API_KEY',
        authDomain: 'your-project.firebaseapp.com',
        projectId: 'your-project-id',
        storageBucket: 'your-project.appspot.com',
        messagingSenderId: 'YOUR_MESSAGING_SENDER_ID',
        appId: 'YOUR_APP_ID',
        measurementId: 'G-YOUR_MEASUREMENT_ID',
    },
};
