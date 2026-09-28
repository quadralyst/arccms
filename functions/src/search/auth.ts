import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { owner } from '../init.js';
import { isArcAdmin } from '../users/claims.js';

/** Whether the caller is an admin, by claim on the token or on the user record. */
export async function isAdminCaller(request: CallableRequest): Promise<boolean> {
    if (!request.auth) return false;
    if (isArcAdmin(request.auth.token)) return true;
    try {
        const userRecord = await owner.getUser(request.auth.uid);
        return isArcAdmin(userRecord.customClaims);
    } catch {
        return false;
    }
}

/** Throws the standard errors for a callable that only admins may use. */
export async function requireAdmin(request: CallableRequest): Promise<void> {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Authentication required.');
    }
    if (!(await isAdminCaller(request))) {
        throw new HttpsError('permission-denied', 'Admin access required.');
    }
}
