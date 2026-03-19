/**
 * Analytics Connection Status Service
 *
 * Provides reactive access to Google Analytics connection status across the application.
 * Listens to Settings/analytics_status (admin-only doc — no tokens or secrets).
 * Follows the same pattern as EmailConfigStatusService.
 */

import { Injectable, OnDestroy, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Firestore, Timestamp, doc, onSnapshot } from '@angular/fire/firestore';

const SETTINGS_COLLECTION = 'Settings';
const ANALYTICS_STATUS_DOC = 'analytics_status';

@Injectable({
  providedIn: 'root',
})
export class AnalyticsConnectionStatusService implements OnDestroy {
  private firestore = inject(Firestore);
  private platformId = inject(PLATFORM_ID);

  isConnected = signal(false);
  isLoading = signal(true);
  propertyName = signal<string | null>(null);
  propertyId = signal<string | null>(null);
  measurementId = signal<string | null>(null);
  lastSyncDate = signal<Timestamp | null>(null);

  private unsubscribe: (() => void) | null = null;

  constructor() {
    this.initializeListener();
  }

  private initializeListener(): void {
    if (!isPlatformBrowser(this.platformId)) {
      this.isLoading.set(false);
      return;
    }

    const docRef = doc(this.firestore, SETTINGS_COLLECTION, ANALYTICS_STATUS_DOC);

    this.unsubscribe = onSnapshot(
      docRef,
      (snapshot) => {
        const data = snapshot.data();
        this.isConnected.set(!!data?.['isConnected']);
        this.propertyName.set(data?.['propertyName'] || null);
        this.propertyId.set(data?.['propertyId'] || null);
        this.measurementId.set(data?.['measurementId'] || null);
        this.lastSyncDate.set(data?.['lastSyncDate'] || null);
        this.isLoading.set(false);
      },
      (error) => {
        console.error('Error listening to analytics status:', error);
        this.isConnected.set(false);
        this.isLoading.set(false);
      },
    );
  }

  ngOnDestroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
  }
}
