import { onCall } from 'firebase-functions/v2/https';
import { db } from '../init.js';

/**
 * Callable cloud function to ensure a waitlist document exists.
 * Called from the public waitlist signup form (unauthenticated).
 * If the waitlist already exists (by ID or slug), returns it.
 * If not, creates a new one with sensible defaults using admin SDK.
 */
export const ensureWaitlistExists = onCall(async (request) => {
    const waitlistId: string = request.data?.waitlistId;
    if (!waitlistId || typeof waitlistId !== 'string' || waitlistId.length > 200) {
        return { success: false, reason: 'invalid-waitlist-id' };
    }

    // 1. Check by document ID
    const docRef = db.collection('Waitlists').doc(waitlistId);
    const docSnap = await docRef.get();
    if (docSnap.exists) {
        return { success: true, existed: true };
    }

    // 2. Check by slug
    const slugQuery = await db
        .collection('Waitlists')
        .where('slug', '==', waitlistId)
        .limit(1)
        .get();
    if (!slugQuery.empty) {
        return { success: true, existed: true };
    }

    // 3. Create with defaults
    const formattedTitle = waitlistId === 'default'
        ? 'Default Waitlist'
        : waitlistId
            .split('-')
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');

    await docRef.set({
        id: waitlistId,
        name: formattedTitle,
        slug: waitlistId,
        description: 'Be the first to know when we launch',
        isActive: true,
        startingPoint: 1000,
        totalSignups: 0,
        uiConfig: {
            title: formattedTitle,
            description: 'Be the first to know when we launch',
            buttonText: 'Join Waitlist',
            theme: 'light',
            width: '100%',
            maxWidth: '400px',
        },
        createdAt: new Date(),
    });

    return { success: true, existed: false };
});
