import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import { arcDatabaseId, DEFAULT_DATABASE_ID } from './arc-config.js';

initializeApp();

/**
 * The install's Firestore database (docs/coexistence-spec.md, CO-D2): `(default)`
 * unless `ARC_DATABASE_ID` names another. Every function reads and writes through
 * this handle; do not call `getFirestore()` anywhere else.
 */
const databaseId = arcDatabaseId();
export const db = databaseId === DEFAULT_DATABASE_ID ? getFirestore() : getFirestore(databaseId);
export const owner = getAuth();
export const storage = getStorage();
