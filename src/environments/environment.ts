/**
 * Development Environment Configuration
 * 
 * This file contains the development environment settings including
 * Firebase configuration for local/development testing.
 */

export const environment = {
    production: false,

    // For Local Testing only
    firebaseConfig: {
        apiKey: 'AIzaSyBBCl1esmI7bPFTRAdxm0SbR8Z3R-8LwdY',
        authDomain: 'xlm-project-864ff.firebaseapp.com',
        databaseURL: 'https://xlm-project-864ff.firebaseio.com',
        projectId: 'xlm-project-864ff',
        storageBucket: 'xlm-project-864ff.appspot.com',
        messagingSenderId: '957465473852',
        appId: '1:957465473852:web:8c4b169c444d18b6a36439',
        measurementId: 'G-7JE7LY5876',
    },
};
