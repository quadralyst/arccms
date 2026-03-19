import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import type { BroadcastEmailDoc, ProviderRateLimits, EmailSettings } from '../types.js';
import { processRecipientBatch } from './broadcastHelper.js';
import { resolveProviderLimits, legacyToProviderLimits, checkQuota } from '../mail-config/emailCounter.js';

/**
 * Maximum processing time budget (ms).
 * Cloud Functions v2 default timeout is 540s.
 * Leave 60s buffer for setup/teardown.
 */
const PROCESSING_BUDGET_MS = (540 - 60) * 1000;

/**
 * Triggers when a new BroadcastEmails document is created.
 * Only processes documents with status 'queued'.
 * Creates individual EmailLogs per recipient with rate-limited delays.
 * Each EmailLog triggers onEmailLogCreate → sendMail() for actual delivery.
 */
export const processBroadcast = onDocumentCreated(
    'BroadcastEmails/{broadcastId}',
    async (event) => {
        const broadcastData = event.data?.data() as BroadcastEmailDoc | undefined;
        const broadcastId = event.params.broadcastId;
        const broadcastRef = db.collection('BroadcastEmails').doc(broadcastId);

        if (!broadcastData) {
            console.error(`processBroadcast: No data for ${broadcastId}`);
            return;
        }

        // Only process documents with status 'queued'
        if (broadcastData.status !== 'queued') {
            console.log(`processBroadcast: ${broadcastId} status is '${broadcastData.status}', skipping.`);
            return;
        }

        // Resolve per-provider rate limits
        let activeProvider = 'smtp';
        let providerLimits: ProviderRateLimits = { perSecond: 1 };
        try {
            const settingsSnap = await db.collection('Settings').doc('email').get();
            const settings = settingsSnap.data() as EmailSettings | undefined;
            activeProvider = settings?.activeProvider || 'smtp';
            providerLimits = resolveProviderLimits(activeProvider, settings?.providerRateLimits);
        } catch (err) {
            console.warn('processBroadcast: Could not read settings, using defaults:', err);
        }

        // Use snapshot from document if available (captures what was active at queue time)
        if (broadcastData.providerRateLimitsSnapshot) {
            providerLimits = broadcastData.providerRateLimitsSnapshot;
        } else if (broadcastData.rateLimitSnapshot) {
            // Legacy fallback: convert old-style rate limit
            providerLimits = legacyToProviderLimits(broadcastData.rateLimitSnapshot);
        }

        // Atomically claim this broadcast (prevents duplicate processing on retries)
        const acquired = await db.runTransaction(async (txn) => {
            const snap = await txn.get(broadcastRef);
            if (snap.data()?.status !== 'queued') return false;
            txn.update(broadcastRef, {
                status: 'processing',
                providerRateLimitsSnapshot: JSON.parse(JSON.stringify(providerLimits)),
                updatedAt: Timestamp.now(),
            });
            return true;
        });

        if (!acquired) {
            console.log(`processBroadcast: ${broadcastId} already claimed by another instance, skipping.`);
            return;
        }

        // Build quota checker for daily/hourly limits
        const quotaChecker = async (): Promise<boolean> => {
            const { ok } = await checkQuota(activeProvider, providerLimits);
            return ok;
        };

        try {
            const result = await processRecipientBatch({
                broadcastRef,
                broadcastData,
                broadcastId,
                providerLimits,
                timeBudgetMs: PROCESSING_BUDGET_MS,
                startIndex: broadcastData.processedIndex || 0,
                initialSentCount: broadcastData.sentCount || 0,
                initialFailedCount: broadcastData.failedCount || 0,
                quotaChecker,
            });

            if (result.quotaExhausted) {
                // Quota limit reached — pause and chain for later resumption
                await broadcastRef.update({
                    status: 'paused',
                    processedIndex: result.processedIndex,
                    sentCount: result.sentCount,
                    failedCount: result.failedCount,
                    chunkNumber: (broadcastData.chunkNumber || 0) + 1,
                    errorMessage: 'Paused: daily/hourly email quota reached. Will resume when quota resets.',
                    updatedAt: Timestamp.now(),
                });

                await db.collection('_broadcast_continue').add({
                    broadcastId,
                    triggeredAt: Timestamp.now(),
                });

                console.log(
                    `processBroadcast: ${broadcastId} paused (quota exhausted) at ${result.processedIndex}/${broadcastData.totalCount}.`,
                );
            } else if (result.timedOut) {
                // Pause and trigger continuation
                await broadcastRef.update({
                    status: 'paused',
                    processedIndex: result.processedIndex,
                    sentCount: result.sentCount,
                    failedCount: result.failedCount,
                    chunkNumber: (broadcastData.chunkNumber || 0) + 1,
                    updatedAt: Timestamp.now(),
                });

                // Chain next invocation via continuation collection
                await db.collection('_broadcast_continue').add({
                    broadcastId,
                    triggeredAt: Timestamp.now(),
                });

                console.log(
                    `processBroadcast: ${broadcastId} paused at ${result.processedIndex}/${broadcastData.totalCount}. Continuation queued.`,
                );
            } else {
                // All recipients processed
                await broadcastRef.update({
                    status: 'completed',
                    processedIndex: result.processedIndex,
                    sentCount: result.sentCount,
                    failedCount: result.failedCount,
                    chunkNumber: (broadcastData.chunkNumber || 0) + 1,
                    updatedAt: Timestamp.now(),
                });

                console.log(
                    `processBroadcast: ${broadcastId} completed. Sent: ${result.sentCount}, Failed: ${result.failedCount}`,
                );
            }
        } catch (err) {
            console.error(`processBroadcast: ${broadcastId} fatal error:`, err);
            await broadcastRef.update({
                status: 'failed',
                errorMessage: err instanceof Error ? err.message : String(err),
                updatedAt: Timestamp.now(),
            });
        }
    },
);
