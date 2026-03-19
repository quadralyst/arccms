/**
 * Tests for WaitlistUserTagsModel
 */
import { IWaitlistUserTag, getWaitlistUserTagsCollectionName } from './waitlist-user-tags.model';

describe('WaitlistUserTagsModel', () => {
    describe('IWaitlistUserTag interface', () => {
        it('should create a valid tag object', () => {
            const tag: IWaitlistUserTag = {
                id: 'tag-1',
                label: 'Lead',
                color: '#D81B60',
                waitlistId: 'waitlist-123',
                usageCount: 5,
                createdBy: 'user-1',
                createdAt: new Date(),
                modifiedBy: 'user-1',
                modifiedAt: new Date(),
            };

            expect(tag.id).toBe('tag-1');
            expect(tag.label).toBe('Lead');
            expect(tag.color).toBe('#D81B60');
            expect(tag.waitlistId).toBe('waitlist-123');
            expect(tag.usageCount).toBe(5);
        });
    });

    describe('getWaitlistUserTagsCollectionName', () => {
        it('should return correct collection name for waitlist', () => {
            const collectionName = getWaitlistUserTagsCollectionName('my-waitlist');
            expect(collectionName).toBe('WaitlistUserTags_my-waitlist');
        });

        it('should handle special characters in waitlist ID', () => {
            const collectionName = getWaitlistUserTagsCollectionName('waitlist-123-abc');
            expect(collectionName).toBe('WaitlistUserTags_waitlist-123-abc');
        });

        it('should return consistent collection name for same waitlist', () => {
            const name1 = getWaitlistUserTagsCollectionName('test');
            const name2 = getWaitlistUserTagsCollectionName('test');
            expect(name1).toBe(name2);
        });
    });
});
