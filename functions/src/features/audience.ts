/**
 * The audience feature's Cloud Functions (specs/feature-flags-spec.md). Exported only
 * when the app has the feature: functions/src/feature-exports.gen.ts lists this file.
 */

// Audience: contacts and their sync, lists, tags, fields, CSV import, the
// one-time migrations onto contacts, and the App audience (specs/coexistence-spec.md 5b).
export * from '../email-core/contactSync.js';
export * from '../email-core/backfillContacts.js';
export * from '../email-core/csvImport.js';
export * from '../email-core/adminContacts.js';
export * from '../email-core/backfillFormLists.js';
export * from '../email-core/migrateTagsToContacts.js';
export * from '../email-core/contactTagSync.js';
export * from '../email-core/adminContactFields.js';
export * from '../email-core/backfillPendingContacts.js';
export * from '../app-audience/adminCallables.js';
export * from '../app-audience/listAppUsers.js';
export * from '../app-audience/onAppUserWritten.js';
export * from '../app-audience/appLists.js';
