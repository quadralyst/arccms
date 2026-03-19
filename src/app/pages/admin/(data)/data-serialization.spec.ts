import { describe, expect, it, vi } from 'vitest';
import { serializeFirestoreValue, deserializeFirestoreValue } from './data-serialization';

// Mock Firestore types for testing
function createMockTimestamp(seconds: number, nanoseconds: number) {
    return {
        seconds,
        nanoseconds,
        toDate: () => new Date(seconds * 1000 + nanoseconds / 1e6),
        toMillis: () => seconds * 1000 + nanoseconds / 1e6,
    };
}

function createMockDocRef(path: string) {
    return {
        path,
        firestore: {}, // truthy firestore property
        id: path.split('/').pop(),
    };
}

function createMockGeoPoint(latitude: number, longitude: number) {
    return {
        latitude,
        longitude,
        toJSON: () => ({ latitude, longitude }),
    };
}

const mockFirestore = {} as any;

// Mock @angular/fire/firestore for deserialization
vi.mock('@angular/fire/firestore', () => {
    class MockTimestamp {
        constructor(
            public seconds: number,
            public nanoseconds: number,
        ) {}
        toDate() {
            return new Date(this.seconds * 1000);
        }
    }

    class MockGeoPoint {
        constructor(
            public latitude: number,
            public longitude: number,
        ) {}
        toJSON() {
            return { latitude: this.latitude, longitude: this.longitude };
        }
    }

    return {
        Timestamp: MockTimestamp,
        GeoPoint: MockGeoPoint,
        doc: vi.fn((firestore: any, path: string) => ({
            path,
            firestore,
            id: path.split('/').pop(),
        })),
    };
});

describe('Data Serialization', () => {
    describe('serializeFirestoreValue', () => {
        it('should serialize Firestore Timestamp to __type sentinel', () => {
            const timestamp = createMockTimestamp(1700000000, 500000000);
            const result = serializeFirestoreValue(timestamp);

            expect(result).toEqual({
                __type: 'timestamp',
                seconds: 1700000000,
                nanoseconds: 500000000,
            });
        });

        it('should serialize DocumentReference to __type sentinel with path', () => {
            const docRef = createMockDocRef('DraftContents/abc123');
            const result = serializeFirestoreValue(docRef);

            expect(result).toEqual({
                __type: 'ref',
                path: 'DraftContents/abc123',
            });
        });

        it('should serialize JavaScript Date to timestamp format', () => {
            const date = new Date('2024-01-15T10:30:00.000Z');
            const result = serializeFirestoreValue(date);

            expect(result).toEqual({
                __type: 'timestamp',
                seconds: Math.floor(date.getTime() / 1000),
                nanoseconds: 0,
            });
        });

        it('should serialize GeoPoint to __type sentinel', () => {
            const geopoint = createMockGeoPoint(37.7749, -122.4194);
            const result = serializeFirestoreValue(geopoint);

            expect(result).toEqual({
                __type: 'geopoint',
                latitude: 37.7749,
                longitude: -122.4194,
            });
        });

        it('should serialize nested objects recursively', () => {
            const data = {
                title: 'Test',
                metadata: {
                    createdAt: createMockTimestamp(1700000000, 0),
                    author: {
                        ref: createMockDocRef('users/user1'),
                    },
                },
            };
            const result = serializeFirestoreValue(data);

            expect(result).toEqual({
                title: 'Test',
                metadata: {
                    createdAt: { __type: 'timestamp', seconds: 1700000000, nanoseconds: 0 },
                    author: {
                        ref: { __type: 'ref', path: 'users/user1' },
                    },
                },
            });
        });

        it('should serialize arrays recursively', () => {
            const data = [
                createMockTimestamp(1700000000, 0),
                'plain string',
                createMockDocRef('Contents/doc1'),
            ];
            const result = serializeFirestoreValue(data);

            expect(result).toEqual([
                { __type: 'timestamp', seconds: 1700000000, nanoseconds: 0 },
                'plain string',
                { __type: 'ref', path: 'Contents/doc1' },
            ]);
        });

        it('should pass through null values', () => {
            expect(serializeFirestoreValue(null)).toBeNull();
        });

        it('should pass through undefined values', () => {
            expect(serializeFirestoreValue(undefined)).toBeUndefined();
        });

        it('should pass through primitive string values', () => {
            expect(serializeFirestoreValue('hello')).toBe('hello');
        });

        it('should pass through primitive number values', () => {
            expect(serializeFirestoreValue(42)).toBe(42);
        });

        it('should pass through primitive boolean values', () => {
            expect(serializeFirestoreValue(true)).toBe(true);
            expect(serializeFirestoreValue(false)).toBe(false);
        });

        it('should pass through plain objects without Firestore types', () => {
            const data = { name: 'Test', count: 5, active: true };
            const result = serializeFirestoreValue(data);
            expect(result).toEqual({ name: 'Test', count: 5, active: true });
        });

        it('should handle empty objects', () => {
            expect(serializeFirestoreValue({})).toEqual({});
        });

        it('should handle empty arrays', () => {
            expect(serializeFirestoreValue([])).toEqual([]);
        });
    });

    describe('deserializeFirestoreValue', () => {
        it('should deserialize __type timestamp to Timestamp', () => {
            const data = { __type: 'timestamp', seconds: 1700000000, nanoseconds: 500000000 };
            const result = deserializeFirestoreValue(data, mockFirestore);

            expect(result.seconds).toBe(1700000000);
            expect(result.nanoseconds).toBe(500000000);
            expect(typeof result.toDate).toBe('function');
        });

        it('should deserialize __type ref to DocumentReference', () => {
            const data = { __type: 'ref', path: 'DraftContents/abc123' };
            const result = deserializeFirestoreValue(data, mockFirestore);

            expect(result.path).toBe('DraftContents/abc123');
        });

        it('should deserialize __type geopoint to GeoPoint', () => {
            const data = { __type: 'geopoint', latitude: 37.7749, longitude: -122.4194 };
            const result = deserializeFirestoreValue(data, mockFirestore);

            expect(result.latitude).toBe(37.7749);
            expect(result.longitude).toBe(-122.4194);
        });

        it('should deserialize nested objects recursively', () => {
            const data = {
                title: 'Test',
                metadata: {
                    createdAt: { __type: 'timestamp', seconds: 1700000000, nanoseconds: 0 },
                    author: {
                        ref: { __type: 'ref', path: 'users/user1' },
                    },
                },
            };
            const result = deserializeFirestoreValue(data, mockFirestore);

            expect(result.title).toBe('Test');
            expect(result.metadata.createdAt.seconds).toBe(1700000000);
            expect(result.metadata.author.ref.path).toBe('users/user1');
        });

        it('should deserialize arrays recursively', () => {
            const data = [
                { __type: 'timestamp', seconds: 1700000000, nanoseconds: 0 },
                'plain string',
                { __type: 'ref', path: 'Contents/doc1' },
            ];
            const result = deserializeFirestoreValue(data, mockFirestore);

            expect(result[0].seconds).toBe(1700000000);
            expect(result[1]).toBe('plain string');
            expect(result[2].path).toBe('Contents/doc1');
        });

        it('should pass through null values', () => {
            expect(deserializeFirestoreValue(null, mockFirestore)).toBeNull();
        });

        it('should pass through undefined values', () => {
            expect(deserializeFirestoreValue(undefined, mockFirestore)).toBeUndefined();
        });

        it('should pass through primitive values', () => {
            expect(deserializeFirestoreValue('hello', mockFirestore)).toBe('hello');
            expect(deserializeFirestoreValue(42, mockFirestore)).toBe(42);
            expect(deserializeFirestoreValue(true, mockFirestore)).toBe(true);
        });

        it('should handle unknown __type gracefully by passing through', () => {
            const data = { __type: 'unknown_type', value: 'test' };
            const result = deserializeFirestoreValue(data, mockFirestore);

            expect(result).toEqual({ __type: 'unknown_type', value: 'test' });
        });

        it('should handle objects without __type as regular objects', () => {
            const data = { name: 'Test', count: 5 };
            const result = deserializeFirestoreValue(data, mockFirestore);

            expect(result).toEqual({ name: 'Test', count: 5 });
        });
    });

    describe('round-trip serialization', () => {
        it('should produce equivalent data after serialize then deserialize', () => {
            const original = {
                title: 'Test Article',
                count: 42,
                active: true,
                tags: ['news', 'update'],
                metadata: {
                    nested: {
                        value: 'deep',
                    },
                },
                nullField: null,
            };

            const serialized = serializeFirestoreValue(original);
            const deserialized = deserializeFirestoreValue(serialized, mockFirestore);

            expect(deserialized).toEqual(original);
        });

        it('should round-trip Timestamp values through serialize/deserialize', () => {
            const timestamp = createMockTimestamp(1700000000, 500000000);
            const serialized = serializeFirestoreValue(timestamp);
            const deserialized = deserializeFirestoreValue(serialized, mockFirestore);

            expect(deserialized.seconds).toBe(1700000000);
            expect(deserialized.nanoseconds).toBe(500000000);
        });

        it('should round-trip DocumentReference values through serialize/deserialize', () => {
            const docRef = createMockDocRef('Contents/abc123');
            const serialized = serializeFirestoreValue(docRef);
            const deserialized = deserializeFirestoreValue(serialized, mockFirestore);

            expect(deserialized.path).toBe('Contents/abc123');
        });
    });
});
