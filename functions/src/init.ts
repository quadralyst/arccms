import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';

initializeApp();

export const db = getFirestore();
export const owner = getAuth();
export const storage = getStorage();
