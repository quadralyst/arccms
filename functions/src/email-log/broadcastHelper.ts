import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import type { BroadcastEmailDoc, RateLimitConfig, ProviderRateLimits } from '../types.js';

/** Convert legacy rate limit config to milliseconds-per-email delay
 * @deprecated Use getDelayFromLimits instead */
export function getDelayMs(rateLimit: RateLimitConfig): number {
    const intervalMs: Record<string, number> = {
        second: 1000,
        minute: 60_000,
        hour: 3_600_000,
        day: 86_400_000,
    };
    const totalMs = intervalMs[rateLimit.interval] || 1000;
    return Math.ceil(totalMs / Math.max(rateLimit.maxEmails, 1));
}

/** Convert ProviderRateLimits to milliseconds-per-email delay (based on perSecond) */
export function getDelayFromLimits(limits: ProviderRateLimits): number {
    return Math.ceil(1000 / Math.max(limits.perSecond, 1));
}

/** Async sleep utility */
export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Max retries per individual email log creation */
const MAX_RETRIES = 3;

export interface BatchProcessResult {
    processedIndex: number;
    sentCount: number;
    failedCount: number;
    timedOut: boolean;
    /** True when daily/hourly quota is exhausted (broadcast should pause) */
    quotaExhausted: boolean;
}

/**
 * Process a batch of broadcast recipients by creating EmailLogs documents
 * with rate-limited delays between each.
 *
 * Each EmailLog creation triggers `onEmailLogCreate` → `sendMail()`,
 * which handles the actual email delivery.
 */
export async function processRecipientBatch(params: {
    broadcastRef: FirebaseFirestore.DocumentReference;
    broadcastData: BroadcastEmailDoc;
    broadcastId: string;
    providerLimits: ProviderRateLimits;
    timeBudgetMs: number;
    startIndex: number;
    initialSentCount: number;
    initialFailedCount: number;
    /** Optional callback that returns false when daily/hourly quota is exhausted */
    quotaChecker?: () => Promise<boolean>;
}): Promise<BatchProcessResult> {
    const {
        broadcastRef,
        broadcastData,
        broadcastId,
        providerLimits,
        timeBudgetMs,
        startIndex,
        initialSentCount,
        initialFailedCount,
        quotaChecker,
    } = params;

    const delayMs = getDelayFromLimits(providerLimits);
    const recipients = broadcastData.recipients || [];
    const totalCount = recipients.length;
    let sentCount = initialSentCount;
    let failedCount = initialFailedCount;
    const startTime = Date.now();

    for (let i = startIndex; i < totalCount; i++) {
        // Check time budget
        if (Date.now() - startTime > timeBudgetMs) {
            // Save progress before returning
            await broadcastRef.update({
                processedIndex: i,
                sentCount,
                failedCount,
                updatedAt: Timestamp.now(),
            });
            return { processedIndex: i, sentCount, failedCount, timedOut: true, quotaExhausted: false };
        }

        // Check quota every 25 emails (skip first iteration of the batch)
        if (quotaChecker && (i - startIndex) > 0 && (i - startIndex) % 25 === 0) {
            const hasQuota = await quotaChecker();
            if (!hasQuota) {
                await broadcastRef.update({
                    processedIndex: i,
                    sentCount,
                    failedCount,
                    updatedAt: Timestamp.now(),
                });
                return { processedIndex: i, sentCount, failedCount, timedOut: false, quotaExhausted: true };
            }
        }

        const recipient = recipients[i];

        // Create EmailLog with retry logic
        let success = false;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                await db.collection('EmailLogs').add({
                    senderEmail: broadcastData.senderEmail,
                    senderName: broadcastData.senderName,
                    toEmail: recipient.toEmail,
                    toName: recipient.toName,
                    subject: broadcastData.subject,
                    template: broadcastData.template,
                    text: broadcastData.previewText || '',
                    type: 'broadcast',
                    broadcastId,
                    waitlistId: broadcastData.waitlistId,
                    createdAt: Timestamp.now(),
                });
                success = true;
                sentCount++;
                break;
            } catch (err) {
                console.error(
                    `Broadcast ${broadcastId}: attempt ${attempt}/${MAX_RETRIES} failed for ${recipient.toEmail}:`,
                    err,
                );
                if (attempt < MAX_RETRIES) {
                    // Exponential backoff: 1s, 2s, 4s
                    await sleep(1000 * Math.pow(2, attempt - 1));
                }
            }
        }

        if (!success) {
            failedCount++;
            console.error(`Broadcast ${broadcastId}: all ${MAX_RETRIES} attempts failed for ${recipient.toEmail}`);
        }

        // Rate limit delay (skip on last iteration)
        if (i < totalCount - 1) {
            await sleep(delayMs);
        }

        // Periodically update progress (every 10 emails)
        if ((i + 1) % 10 === 0) {
            await broadcastRef.update({
                processedIndex: i + 1,
                sentCount,
                failedCount,
                updatedAt: Timestamp.now(),
            });
        }
    }

    // All done
    return { processedIndex: totalCount, sentCount, failedCount, timedOut: false, quotaExhausted: false };
}
