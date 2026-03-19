/**
 * Interface for waitlist user notes/journal entries
 * Notes are stored as subcollection: Waitlists/{waitlistId}/users/{userId}/notes
 */
export interface IWaitlistUserNote {
    id: string;
    content: string;
    createdAt: any; // Firestore Timestamp
    createdBy?: string;
}

export const WAITLIST_NOTES_COMPONENT_NAME: string = 'WaitlistUserNotes';

/**
 * Helper function to get notes subcollection path for a user
 */
export function getWaitlistUserNotesPath(waitlistId: string, userId: string): string {
    return `Waitlists/${waitlistId}/users/${userId}/notes`;
}
