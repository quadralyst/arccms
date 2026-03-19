/**
 * Tests for WaitlistUserTagsService
 * 
 * Uses mocks to avoid Firestore DI issues.
 */
import { describe, it, expect } from 'vitest';
import { getWaitlistUserTagsCollectionName } from './waitlist-user-tags.model';

describe('WaitlistUserTagsService', () => {
    describe('Collection naming', () => {
        it('should generate correct collection name for waitlist', () => {
            const name = getWaitlistUserTagsCollectionName('test-waitlist');
            expect(name).toBe('WaitlistUserTags_test-waitlist');
        });

        it('should handle different waitlist IDs', () => {
            const name1 = getWaitlistUserTagsCollectionName('waitlist-a');
            const name2 = getWaitlistUserTagsCollectionName('waitlist-b');
            expect(name1).not.toBe(name2);
        });

        it('should produce consistent names for same ID', () => {
            const name1 = getWaitlistUserTagsCollectionName('same');
            const name2 = getWaitlistUserTagsCollectionName('same');
            expect(name1).toBe(name2);
        });
    });
});
