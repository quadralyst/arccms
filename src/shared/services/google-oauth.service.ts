/**
 * Google OAuth Service
 *
 * Handles the Google Identity Services (GIS) authorization code flow
 * for Google Analytics access. Independent of Firebase Auth — the admin
 * can be logged in via email/password and still OAuth for GA.
 *
 * Also provides wrapper methods for analytics cloud functions.
 */

import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initCodeClient(config: {
            client_id: string;
            scope: string;
            ux_mode: 'popup' | 'redirect';
            callback: (response: { code?: string; error?: string }) => void;
          }): { requestCode: () => void };
        };
      };
    };
  }
}

interface ConnectAnalyticsResult {
  success: boolean;
  selectedProperty?: { propertyId: string; displayName: string; measurementId?: string };
  allProperties?: Array<{ propertyId: string; displayName: string; accountName?: string }>;
}

interface AnalyticsActionResult {
  success: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class GoogleOAuthService {
  private functions = inject(Functions);
  private gisLoadingPromise: Promise<void> | null = null;

  /**
   * Opens Google OAuth consent popup using GIS library.
   * Returns the authorization code on success.
   */
  async requestAuthorizationCode(clientId: string): Promise<string> {
    await this.loadGISScript();

    return new Promise((resolve, reject) => {
      const initCodeClient = window.google?.accounts?.oauth2?.initCodeClient;
      if (!initCodeClient) {
        reject(new Error('Google Identity Services not available'));
        return;
      }

      let settled = false;

      const client = initCodeClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/analytics.readonly',
        ux_mode: 'popup',
        callback: (response) => {
          settled = true;
          if (response.error) {
            reject(new Error(response.error));
          } else if (response.code) {
            resolve(response.code);
          } else {
            reject(new Error('No authorization code received'));
          }
        },
      });

      client.requestCode();

      // Timeout if popup is blocked or user doesn't interact within 2 minutes
      setTimeout(() => {
        if (!settled) {
          reject(new Error('Authorization timed out. The popup may have been blocked by your browser.'));
        }
      }, 120_000);
    });
  }

  /**
   * Dynamically load the Google Identity Services script.
   * Caches the loading promise to prevent duplicate script tags.
   */
  private loadGISScript(): Promise<void> {
    if (window.google?.accounts?.oauth2) {
      return Promise.resolve();
    }

    if (this.gisLoadingPromise) {
      return this.gisLoadingPromise;
    }

    this.gisLoadingPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => {
        this.gisLoadingPromise = null; // Allow retry on failure
        reject(new Error('Failed to load Google Identity Services'));
      };
      document.head.appendChild(script);
    });

    return this.gisLoadingPromise;
  }

  // ── Cloud Function Wrappers ──

  connectAnalytics(data: {
    authorizationCode: string;
    redirectUri: string;
    measurementId: string;
  }): Promise<ConnectAnalyticsResult> {
    const callable = httpsCallable<typeof data, ConnectAnalyticsResult>(this.functions, 'connectGoogleAnalytics');
    return callable(data).then((r) => r.data);
  }

  refreshAnalyticsData(): Promise<AnalyticsActionResult> {
    const callable = httpsCallable<Record<string, never>, AnalyticsActionResult>(this.functions, 'refreshAnalyticsData');
    return callable({}).then((r) => r.data);
  }

  disconnectAnalytics(): Promise<AnalyticsActionResult> {
    const callable = httpsCallable<Record<string, never>, AnalyticsActionResult>(this.functions, 'disconnectGoogleAnalytics');
    return callable({}).then((r) => r.data);
  }

  selectProperty(data: { propertyId: string; displayName: string }): Promise<AnalyticsActionResult> {
    const callable = httpsCallable<typeof data, AnalyticsActionResult>(this.functions, 'selectAnalyticsProperty');
    return callable(data).then((r) => r.data);
  }
}
