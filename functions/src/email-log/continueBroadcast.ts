import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import type { BroadcastEmailDoc, ProviderRateLimits, EmailSettings } from '../types.js';
import { processRecipientBatch } from './broadcastHelper.js';
import { legacyToProviderLimits, checkQuota } from '../mail-config/emailCounter.js';

/**
 * Processing time budget (ms). Same as processBroadcast.
 */
const PROCESSING_BUDGET_MS = (540 - 60) * 1000;

/**
 * Continuation function for broadcast processing.
 * Triggered when a document is created in _broadcast_continue collection.
 * Resumes a paused broadcast from its processedIndex.
 * Self-chains by creating another _broadcast_continue doc if it times out again.
 */
export const continueBroadcast = onDocumentCreated(
    '_broadcast_continue/{docId}',
    async (event) => {
        const data = event.data?.data();
        const docRef = event.data?.ref;

        if (!data?.broadcastId) {
            console.error('continueBroadcast: Missing broadcastId');
            if (docRef) await docRef.delete();
            return;
        }

        const broadcastId = data.broadcastId as string;
        const broadcastRef = db.collection('BroadcastEmails').doc(broadcastId);
        const broadcastSnap = await broadcastRef.get();

        if (!broadcastSnap.exists) {
            console.error(`continueBroadcast: Broadcast ${broadcastId} not found`);
            if (docRef) await docRef.delete();
            return;
        }

        const broadcastData = broadcastSnap.data() as BroadcastEmailDoc;

        // Only resume paused broadcasts
        if (broadcastData.status !== 'paused') {
            console.log(
                `continueBroadcast: ${broadcastId} status is '${broadcastData.status}', skipping.`,
            );
            if (docRef) await docRef.delete();
            return;
        }

        // Circuit breaker: prevent infinite self-chaining
        const MAX_CHUNKS = 200;
        if ((broadcastData.chunkNumber || 0) >= MAX_CHUNKS) {
            console.error(`continueBroadcast: ${broadcastId} exceeded max ${MAX_CHUNKS} chunks. Marking failed.`);
            await broadcastRef.update({
                status: 'failed',
                errorMessage: `Exceeded maximum processing chunks (${MAX_CHUNKS}). Please retry with a higher rate limit.`,
                updatedAt: Timestamp.now(),
            });
            if (docRef) await docRef.delete();
            return;
        }

        // Resolve rate limits from snapshot (set by processBroadcast)
        let providerLimits: ProviderRateLimits = { perSecond: 1 };
        if (broadcastData.providerRateLimitsSnapshot) {
            providerLimits = broadcastData.providerRateLimitsSnapshot;
        } else if (broadcastData.rateLimitSnapshot) {
            // Legacy fallback
            providerLimits = legacyToProviderLimits(broadcastData.rateLimitSnapshot);
        }

        // Read active provider for quota checking
        let activeProvider = 'smtp';
        try {
            const settingsSnap = await db.collection('Settings').doc('email').get();
            const settings = settingsSnap.data() as EmailSettings | undefined;
            activeProvider = settings?.activeProvider || 'smtp';
        } catch {
            /* use default */
        }

        // Atomically claim this broadcast (prevents duplicate processing on retries)
        const acquired = await db.runTransaction(async (txn) => {
            const snap = await txn.get(broadcastRef);
            if (snap.data()?.status !== 'paused') return false;
            txn.update(broadcastRef, { status: 'processing', updatedAt: Timestamp.now() });
            return true;
        });

        if (!acquired) {
            console.log(`continueBroadcast: ${broadcastId} not in 'paused' state or already claimed, skipping.`);
            if (docRef) await docRef.delete();
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
                    `continueBroadcast: ${broadcastId} paused (quota exhausted) at ${result.processedIndex}/${broadcastData.totalCount}.`,
                );
            } else if (result.timedOut) {
                // Pause and chain another continuation
                await broadcastRef.update({
                    status: 'paused',
                    processedIndex: result.processedIndex,
                    sentCount: result.sentCount,
                    failedCount: result.failedCount,
                    chunkNumber: (broadcastData.chunkNumber || 0) + 1,
                    updatedAt: Timestamp.now(),
                });

                await db.collection('_broadcast_continue').add({
                    broadcastId,
                    triggeredAt: Timestamp.now(),
                });

                console.log(
                    `continueBroadcast: ${broadcastId} paused again at ${result.processedIndex}/${broadcastData.totalCount}. Continuation queued.`,
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
                    `continueBroadcast: ${broadcastId} completed. Sent: ${result.sentCount}, Failed: ${result.failedCount}`,
                );
            }
        } catch (err) {
            console.error(`continueBroadcast: ${broadcastId} fatal error:`, err);
            await broadcastRef.update({
                status: 'failed',
                errorMessage: err instanceof Error ? err.message : String(err),
                updatedAt: Timestamp.now(),
            });
        }

        // Cleanup continuation trigger document
        if (docRef) await docRef.delete();
    },
);
