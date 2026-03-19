import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Mock firebase-admin/firestore
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(),
  Timestamp: {
    now: vi.fn(() => ({ seconds: Date.now() / 1000, nanoseconds: 0 })),
  },
  FieldValue: {
    increment: vi.fn((val) => `INCREMENT_${val}`),
    serverTimestamp: vi.fn(() => ({ _serverTimestamp: true })),
  },
}));

// Mock init
vi.mock('../init', () => ({
  db: {
    collection: vi.fn().mockReturnThis(),
    doc: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    get: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: vi.fn((path, handler) => handler),
  onDocumentUpdated: vi.fn((path, handler) => handler),
  onDocumentDeleted: vi.fn((path, handler) => handler),
}));

describe('Referral Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('referralHelper', () => {
    it('should export incrementReferralCounts function', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../utils/referralHelper.ts'),
        'utf-8'
      );
      
      expect(fileContent).toContain('export async function incrementReferralCounts');
    });

    it('should update both WaitlistedUsers and Waitlists/users collections', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../utils/referralHelper.ts'),
        'utf-8'
      );

      expect(fileContent).toContain("db.collection('WaitlistedUsers')");
      expect(fileContent).toContain("db.collection('Waitlists')");
      expect(fileContent).toContain(".collection('users')");
    });

    it('should use batched writes for atomicity', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../utils/referralHelper.ts'),
        'utf-8'
      );

      expect(fileContent).toContain('db.batch()');
      expect(fileContent).toContain('batch.update(');
      expect(fileContent).toContain('batch.commit()');
      // Should NOT have sequential awaits on individual updates
      expect(fileContent).not.toContain('await waitlistedUserRef.update(');
      expect(fileContent).not.toContain('await userDoc.ref.update(');
    });
  });

  describe('onReferralCreate', () => {
    it('should use shared referralHelper', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../waitlists/referral/onReferralCreate.ts'),
        'utf-8'
      );
      
      expect(fileContent).toContain("import { incrementReferralCounts } from '../../utils/referralHelper.js'");
    });

    it('should have TypeScript interface for ReferralData', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../waitlists/referral/onReferralCreate.ts'),
        'utf-8'
      );
      
      expect(fileContent).toContain('interface ReferralData');
    });

    it('should only process completed referrals', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../waitlists/referral/onReferralCreate.ts'),
        'utf-8'
      );
      
      expect(fileContent).toContain('REFERRAL_STATUS.COMPLETED');
    });
  });

  describe('onReferralUpdate', () => {
    it('should use shared referralHelper', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../waitlists/referral/onReferralUpdate.ts'),
        'utf-8'
      );
      
      expect(fileContent).toContain("import { incrementReferralCounts } from '../../utils/referralHelper.js'");
    });

    it('should not use any type', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../waitlists/referral/onReferralUpdate.ts'),
        'utf-8'
      );
      
      // Should not have (referral: any) pattern
      expect(fileContent).not.toContain('referral: any');
    });

    it('should check for status change from pending to completed', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../waitlists/referral/onReferralUpdate.ts'),
        'utf-8'
      );
      
      expect(fileContent).toContain('REFERRAL_STATUS.PENDING');
      expect(fileContent).toContain('REFERRAL_STATUS.COMPLETED');
    });
  });
});

describe('Referral Decrement on User Delete', () => {
  describe('decrementReferralCounts helper', () => {
    it('should export decrementReferralCounts function', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../utils/referralHelper.ts'),
        'utf-8'
      );

      expect(fileContent).toContain('export async function decrementReferralCounts');
    });

    it('should decrement counts in both WaitlistedUsers and Waitlists/users', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../utils/referralHelper.ts'),
        'utf-8'
      );

      // Must decrement (not increment) by using FieldValue.increment(-1)
      expect(fileContent).toContain('FieldValue.increment(-1)');
    });

    it('should use batched writes for atomicity', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../utils/referralHelper.ts'),
        'utf-8'
      );

      // Count batch operations in the decrement function
      const decrementSection = fileContent.split('decrementReferralCounts')[1];
      expect(decrementSection).toContain('db.batch()');
      expect(decrementSection).toContain('batch.update(');
      expect(decrementSection).toContain('batch.delete(');
      expect(decrementSection).toContain('batch.commit()');
    });

    it('should find referrer by referral code', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../utils/referralHelper.ts'),
        'utf-8'
      );

      const decrementSection = fileContent.split('decrementReferralCounts')[1];
      expect(decrementSection).toContain("where('referralCode', '==', referrerCode)");
    });

    it('should delete referral records from subcollection', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../utils/referralHelper.ts'),
        'utf-8'
      );

      const decrementSection = fileContent.split('decrementReferralCounts')[1];
      expect(decrementSection).toContain("collection('referrals')");
      expect(decrementSection).toContain("where('referredUserId', '==', deletedUserId)");
      expect(decrementSection).toContain('batch.delete(');
    });

    it('should bail out early if referrer not found', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../utils/referralHelper.ts'),
        'utf-8'
      );

      const decrementSection = fileContent.split('decrementReferralCounts')[1];
      expect(decrementSection).toContain('if (referrerSnapshot.empty) return');
    });
  });

  describe('onWaitlistUserDelete trigger', () => {
    it('should use onDocumentDeleted from firebase-functions/v2/firestore', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../waitlists/waitlist-details/onWaitlistUserDelete.ts'),
        'utf-8'
      );

      expect(fileContent).toContain('onDocumentDeleted');
    });

    it('should trigger on Waitlists/{WaitlistsId}/users/{usersId} path', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../waitlists/waitlist-details/onWaitlistUserDelete.ts'),
        'utf-8'
      );

      expect(fileContent).toContain("'Waitlists/{WaitlistsId}/users/{usersId}'");
    });

    it('should import decrementReferralCounts from referralHelper', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../waitlists/waitlist-details/onWaitlistUserDelete.ts'),
        'utf-8'
      );

      expect(fileContent).toContain("import { decrementReferralCounts } from '../../utils/referralHelper.js'");
    });

    it('should only decrement when referredBy field exists', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../waitlists/waitlist-details/onWaitlistUserDelete.ts'),
        'utf-8'
      );

      expect(fileContent).toContain('deletedData.referredBy');
      expect(fileContent).toContain('if (deletedData.referredBy)');
    });

    it('should be exported from index.ts', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../index.ts'),
        'utf-8'
      );

      expect(fileContent).toContain("'./waitlists/waitlist-details/onWaitlistUserDelete.js'");
    });

    it('should handle errors gracefully with try-catch', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../waitlists/waitlist-details/onWaitlistUserDelete.ts'),
        'utf-8'
      );

      expect(fileContent).toContain('try {');
      expect(fileContent).toContain('} catch (error)');
      expect(fileContent).toContain('console.error');
    });
  });
});

describe('Leaderboard Function', () => {
  describe('getOptimizedLeaderboard', () => {
    it('should require authentication', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../waitlists/leaderboard/getLeaderBoardData.ts'),
        'utf-8'
      );

      expect(fileContent).toContain('request.auth');
      expect(fileContent).toContain("'unauthenticated'");
    });

    it('should validate collectionName against allowed patterns', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../waitlists/leaderboard/getLeaderBoardData.ts'),
        'utf-8'
      );

      // Must validate collectionName to prevent arbitrary Firestore access
      expect(fileContent).toContain('Invalid collection name.');
      expect(fileContent).toContain('Waitlists');
      // Must verify the waitlist exists before allowing access
      expect(fileContent).toContain('.exists');
    });

    it('should have TypeScript interface for LeaderboardUser', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../waitlists/leaderboard/getLeaderBoardData.ts'),
        'utf-8'
      );
      
      expect(fileContent).toContain('interface LeaderboardUser');
    });

    it('should use v2 onCall API', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../waitlists/leaderboard/getLeaderBoardData.ts'),
        'utf-8'
      );
      
      expect(fileContent).toContain("from 'firebase-functions/v2/https'");
    });

    it('should handle optional userEmail', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../waitlists/leaderboard/getLeaderBoardData.ts'),
        'utf-8'
      );
      
      expect(fileContent).toContain('userEmail?: string');
      expect(fileContent).toContain("!userEmail || userEmail.trim() === ''");
    });

    it('should use count() for efficient user counting', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../waitlists/leaderboard/getLeaderBoardData.ts'),
        'utf-8'
      );

      expect(fileContent).toContain('.count().get()');
    });

    it('should use cursor-based pagination (startAfter) instead of offset', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../waitlists/leaderboard/getLeaderBoardData.ts'),
        'utf-8'
      );

      // Must use startAfter for cursor-based pagination
      expect(fileContent).toContain('.startAfter(');
      // Must NOT use .offset() which degrades at scale
      expect(fileContent).not.toContain('.offset(');
    });

    it('should return UserPositionData with cursor fields from findUserPosition', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const fileContent = fs.readFileSync(
        path.resolve(__dirname, '../waitlists/leaderboard/getLeaderBoardData.ts'),
        'utf-8'
      );

      // findUserPosition should return structured data for cursor queries
      expect(fileContent).toContain('interface UserPositionData');
      expect(fileContent).toContain('totalReferrals: number');
      expect(fileContent).toContain('signupTimestamp:');
    });
  });
});
