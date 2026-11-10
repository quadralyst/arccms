import { onCall } from 'firebase-functions/v2/https';
import { db } from '../init.js';
import { DEFAULT_WAITLIST_FORM_ID } from './defaultForm.js';
import { requireAdmin } from '../search/auth.js';

/** Ids this callable accepts: letters, digits, '-' and '_', no slash. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

/** The default form, under its current id or its original one. */
function isDefaultFormId(id: string): boolean {
    return id === DEFAULT_WAITLIST_FORM_ID || id === 'default';
}

/**
 * Callable cloud function to ensure a waitlist document exists.
 * If the waitlist already exists (by ID or slug), says so.
 * If not, creates a new one with sensible defaults using admin SDK.
 *
 * The public form script (arc-site.js) calls it when a page's form is missing,
 * so the default form is created on first use: anyone may ask for that one.
 * Any other id needs an admin, so a visitor cannot fill the site with forms.
 */
export const ensureWaitlistExists = onCall(async (request) => {
    const raw: unknown = request.data?.waitlistId;
    const waitlistId = typeof raw === 'string' ? raw.trim() : '';
    if (!SAFE_ID.test(waitlistId)) {
        return { success: false, reason: 'invalid-waitlist-id' };
    }
    if (!isDefaultFormId(waitlistId)) {
        await requireAdmin(request);
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
    // The default form, under its current or its original id, gets the same
    // plain name onboarding gives it.
    const formattedTitle = isDefaultFormId(waitlistId)
        ? 'Waitlist'
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
