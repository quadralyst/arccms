/**
 * Tests for WaitlistUserNotesModel
 */
import { IWaitlistUserNote, getWaitlistUserNotesPath } from './waitlist-user-notes.model';

describe('WaitlistUserNotesModel', () => {
    describe('IWaitlistUserNote interface', () => {
        it('should create a valid note object', () => {
            const note: IWaitlistUserNote = {
                id: 'note-1',
                content: 'This is a test note',
                createdAt: new Date(),
                createdBy: 'user-1',
            };

            expect(note.id).toBe('note-1');
            expect(note.content).toBe('This is a test note');
            expect(note.createdBy).toBe('user-1');
        });

        it('should allow note without createdBy', () => {
            const note: IWaitlistUserNote = {
                id: 'note-2',
                content: 'Anonymous note',
                createdAt: new Date(),
            };

            expect(note.id).toBe('note-2');
            expect(note.createdBy).toBeUndefined();
        });
    });

    describe('getWaitlistUserNotesPath', () => {
        it('should return correct subcollection path', () => {
            const path = getWaitlistUserNotesPath('waitlist-123', 'user-456');
            expect(path).toBe('Waitlists/waitlist-123/users/user-456/notes');
        });

        it('should handle different IDs correctly', () => {
            const path = getWaitlistUserNotesPath('my-waitlist', 'john-doe');
            expect(path).toBe('Waitlists/my-waitlist/users/john-doe/notes');
        });

        it('should return consistent path for same parameters', () => {
            const path1 = getWaitlistUserNotesPath('wl', 'usr');
            const path2 = getWaitlistUserNotesPath('wl', 'usr');
            expect(path1).toBe(path2);
        });
    });
});
