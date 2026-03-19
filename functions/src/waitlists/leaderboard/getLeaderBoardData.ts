import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { CollectionReference, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { db } from '../../init.js';

interface LeaderboardUser {
  maskedEmail: string;
  totalReferrals: number;
  firstName?: string;
}

export const getOptimizedLeaderboard = onCall<{
  userEmail?: string; // Make userEmail optional
  collectionName?: string;
}>(
  {
    region: 'us-central1',
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    try {
      const { userEmail, collectionName } = request.data;

      // Validate collectionName to prevent arbitrary Firestore collection access.
      // Admin SDK bypasses security rules, so we must whitelist at the application level.
      // Allowed: 'WaitlistedUsers' (default) or a valid Waitlists/{id}/users subcollection path.
      let collectionPath = 'WaitlistedUsers';
      if (collectionName && collectionName !== 'WaitlistedUsers') {
        // Only allow Waitlists/{waitlistId}/users pattern
        const waitlistPathMatch = collectionName.match(/^Waitlists\/([^/]+)\/users$/);
        if (!waitlistPathMatch) {
          throw new HttpsError('invalid-argument', 'Invalid collection name.');
        }
        // Verify the waitlist actually exists
        const waitlistDoc = await db.collection('Waitlists').doc(waitlistPathMatch[1]).get();
        if (!waitlistDoc.exists) {
          throw new HttpsError('invalid-argument', 'Invalid collection name.');
        }
        collectionPath = collectionName;
      }
      const leaderboardRef = db.collection(collectionPath);

      // Check if collection exists by trying to get at least one document
      const testQuery = await leaderboardRef.limit(1).get();
      if (testQuery.empty && collectionName) {
        return {
          displayLeaderboard: [],
          totalUsers: 0,
        };
      }

      // Get total count of users
      const totalCountSnapshot = await leaderboardRef.where('isConfirmed', '==', true).count().get();
      const totalUsers = totalCountSnapshot.data().count;

      // If no userEmail is provided, fetch top 10 users
      if (!userEmail || userEmail.trim() === '') {
        const topUsersQuery = leaderboardRef
          .where('isConfirmed', '==', true)
          .orderBy('totalReferrals', 'desc')
          .orderBy('signupTimestamp', 'asc')
          .limit(10);

        const topUsersSnapshot = await topUsersQuery.get();
        const topUsers = topUsersSnapshot.docs.map((doc: QueryDocumentSnapshot) => {
          const data = doc.data();
          return {
            id: doc.id,
            maskedEmail: data.maskedEmail || '',
            totalReferrals: data.totalReferrals || 0,
            firstName: data.firstName || '',
          };
        }) as LeaderboardUser[];

        return {
          displayLeaderboard: topUsers,
          totalUsers,
        };
      }

      // Original logic when userEmail is provided
      // Get top 5 users
      const topUsersQuery = leaderboardRef
        .where('isConfirmed', '==', true)
        .orderBy('totalReferrals', 'desc')
        .orderBy('signupTimestamp', 'asc')
        .limit(5);

      const topUsersSnapshot = await topUsersQuery.get();
      const topUsers = topUsersSnapshot.docs.map((doc: QueryDocumentSnapshot) => {
        const data = doc.data();
        return {
          id: doc.id,
          maskedEmail: data.maskedEmail || '',
          totalReferrals: data.totalReferrals || 0,
          firstName: data.firstName || '',
        };
      }) as LeaderboardUser[];

      // Check if current user is in top 5 by matching email against doc data
      const topUserDocs = topUsersSnapshot.docs;
      const userInTop5Index = topUserDocs.findIndex((doc: QueryDocumentSnapshot) => doc.data().email === userEmail);

      if (userInTop5Index !== -1) {
        // User is in top 5, return only top 5
        return {
          displayLeaderboard: topUsers,
          currentUserPosition: userInTop5Index + 1,
          totalUsers,
        };
      }

      // Find current user's position and cursor data in the full leaderboard
      const userPositionData = await findUserPosition(leaderboardRef, userEmail);

      if (!userPositionData) {
        // Current user not found, return top 5 only
        return {
          displayLeaderboard: topUsers,
          totalUsers,
        };
      }

      // Cursor-based: get 3 users ranked immediately ABOVE the current user.
      // Reverse the ordering so `startAfter` moves toward higher-ranked users.
      // Firestore can serve reversed ordering from the existing composite index.
      const aboveQuery = leaderboardRef
        .where('isConfirmed', '==', true)
        .orderBy('totalReferrals', 'asc')
        .orderBy('signupTimestamp', 'desc')
        .startAfter(userPositionData.totalReferrals, userPositionData.signupTimestamp)
        .limit(3);

      const aboveSnapshot = await aboveQuery.get();
      // Reverse to restore descending-referrals order (highest ranked first)
      const aboveUsers: LeaderboardUser[] = aboveSnapshot.docs.reverse().map((doc: QueryDocumentSnapshot) => {
        const data = doc.data();
        return {
          maskedEmail: data.maskedEmail || '',
          totalReferrals: data.totalReferrals || 0,
          firstName: data.firstName || '',
        };
      });

      // Cursor-based: get 3 users ranked immediately BELOW the current user.
      const belowQuery = leaderboardRef
        .where('isConfirmed', '==', true)
        .orderBy('totalReferrals', 'desc')
        .orderBy('signupTimestamp', 'asc')
        .startAfter(userPositionData.totalReferrals, userPositionData.signupTimestamp)
        .limit(3);

      const belowSnapshot = await belowQuery.get();
      const belowUsers: LeaderboardUser[] = belowSnapshot.docs.map((doc: QueryDocumentSnapshot) => {
        const data = doc.data();
        return {
          maskedEmail: data.maskedEmail || '',
          totalReferrals: data.totalReferrals || 0,
          firstName: data.firstName || '',
        };
      });

      // Combine: above users + current user + below users
      const aroundUsers: LeaderboardUser[] = [
        ...aboveUsers,
        userPositionData.user,
        ...belowUsers,
      ];

      // Combine results
      const displayLeaderboard: (LeaderboardUser | { isSeparator: true })[] = [
        ...topUsers,
        { isSeparator: true },
        ...aroundUsers,
      ];

      return {
        displayLeaderboard,
        currentUserPosition: userPositionData.position,
        totalUsers,
      };
    } catch (error: unknown) {
      console.error('Error in getOptimizedLeaderboard:', error);
      const msg = error instanceof Error ? error.message : 'An unexpected error occurred';
      throw new HttpsError('internal', msg);
    }
  },
);

/** Data returned by findUserPosition for cursor-based pagination */
interface UserPositionData {
  position: number;
  totalReferrals: number;
  signupTimestamp: unknown; // Firestore Timestamp
  user: LeaderboardUser;
}

/**
 * Find user's leaderboard position and return cursor data for pagination.
 * Uses count() queries to compute position without reading intermediate docs.
 */
async function findUserPosition(
  leaderboardRef: CollectionReference,
  userEmail: string,
): Promise<UserPositionData | null> {
  try {
    // First, get the user's document
    const userQuery = await leaderboardRef.where('email', '==', userEmail).limit(1).get();

    if (userQuery.empty) {
      return null;
    }

    const userDoc = userQuery.docs[0];
    const userData = userDoc.data();
    const userScore = userData.totalReferrals || 0;
    const userSignupTimestamp = userData.signupTimestamp;

    // Count how many users have a higher score
    const higherScoreQuery = await leaderboardRef.where('totalReferrals', '>', userScore).count().get();
    const higherScoreCount = higherScoreQuery.data().count;

    // Count users with same score but earlier signup timestamp (for tie-breaking)
    const sameScoreQuery = await leaderboardRef
      .where('totalReferrals', '==', userScore)
      .where('signupTimestamp', '<', userSignupTimestamp)
      .count()
      .get();
    const sameScoreEarlierCount = sameScoreQuery.data().count;

    return {
      position: higherScoreCount + sameScoreEarlierCount + 1,
      totalReferrals: userScore,
      signupTimestamp: userSignupTimestamp,
      user: {
        maskedEmail: userData.maskedEmail || '',
        totalReferrals: userScore,
        firstName: userData.firstName || '',
      },
    };
  } catch (error) {
    console.error('Error finding user position:', error);
    return null;
  }
}
