/**
 * Data Serialization Utilities
 *
 * Handles round-tripping of Firestore-specific types (Timestamp, DocumentReference, GeoPoint)
 * to/from JSON using __type sentinel objects.
 */

import { doc, Firestore, GeoPoint, Timestamp } from '@angular/fire/firestore';

/**
 * Serialize a Firestore value to a JSON-safe representation.
 * Recursively processes objects and arrays.
 */
export function serializeFirestoreValue(value: any): any {
    if (value === null || value === undefined) {
        return value;
    }

    // Firestore Timestamp (has toDate() and seconds/nanoseconds)
    if (
        value?.seconds !== undefined &&
        value?.nanoseconds !== undefined &&
        typeof value.toDate === 'function'
    ) {
        return {
            __type: 'timestamp',
            seconds: value.seconds,
            nanoseconds: value.nanoseconds,
        };
    }

    // Firestore DocumentReference (has path and firestore properties)
    if (value?.path && typeof value.path === 'string' && value?.firestore) {
        return {
            __type: 'ref',
            path: value.path,
        };
    }

    // Firestore GeoPoint (has latitude/longitude and toJSON)
    if (
        value?.latitude !== undefined &&
        value?.longitude !== undefined &&
        typeof value.toJSON === 'function'
    ) {
        return {
            __type: 'geopoint',
            latitude: value.latitude,
            longitude: value.longitude,
        };
    }

    // JavaScript Date
    if (value instanceof Date) {
        return {
            __type: 'timestamp',
            seconds: Math.floor(value.getTime() / 1000),
            nanoseconds: 0,
        };
    }

    // Arrays
    if (Array.isArray(value)) {
        return value.map((item) => serializeFirestoreValue(item));
    }

    // Plain objects
    if (typeof value === 'object') {
        const result: Record<string, any> = {};
        for (const key of Object.keys(value)) {
            result[key] = serializeFirestoreValue(value[key]);
        }
        return result;
    }

    // Primitives (string, number, boolean)
    return value;
}

/**
 * Deserialize a JSON value back into Firestore-native types.
 * Recognizes __type sentinel objects and converts them.
 */
export function deserializeFirestoreValue(value: any, firestore: Firestore): any {
    if (value === null || value === undefined) {
        return value;
    }

    // Check for __type sentinel objects
    if (typeof value === 'object' && !Array.isArray(value) && value.__type) {
        switch (value.__type) {
            case 'timestamp':
                return new Timestamp(value.seconds, value.nanoseconds);
            case 'ref':
                return doc(firestore, value.path);
            case 'geopoint':
                return new GeoPoint(value.latitude, value.longitude);
            default:
                // Unknown __type — pass through as plain object
                return value;
        }
    }

    // Arrays
    if (Array.isArray(value)) {
        return value.map((item) => deserializeFirestoreValue(item, firestore));
    }

    // Plain objects
    if (typeof value === 'object') {
        const result: Record<string, any> = {};
        for (const key of Object.keys(value)) {
            result[key] = deserializeFirestoreValue(value[key], firestore);
        }
        return result;
    }

    // Primitives
    return value;
}
