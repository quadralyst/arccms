
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Use vi.hoisted to ensure these are available for the mock factory
const mocks = vi.hoisted(() => {
    const mockDelete = vi.fn(() => Promise.resolve());
    const mockCommit = vi.fn(() => Promise.resolve());
    const mockBatch = vi.fn(() => ({
        delete: mockDelete,
        commit: mockCommit,
    }));
    const mockLimit = vi.fn();
    const mockListCollections = vi.fn(() => Promise.resolve([]));
    const mockGet = vi.fn();
    const mockCollection = vi.fn();
    const mockDoc = vi.fn();

    return {
        mockDelete,
        mockCommit,
        mockBatch,
        mockLimit,
        mockListCollections,
        mockGet,
        mockCollection,
        mockDoc,
    };
});

// Extract for easier usage
const {
    mockDelete, mockBatch, mockLimit,
    mockListCollections, mockGet, mockCollection, mockDoc
} = mocks;

// The mocked Firestore instance structure
// const mockFirestore = {
//     collection: mockCollection,
//     doc: mockDoc,
//     batch: mockBatch,
// };

// Mock Query logic
const mockQuery = {
    get: mockGet,
    limit: mockLimit,
};

// Setup implementations (can be done here as this runs after hoisting)
mockCollection.mockReturnValue(mockQuery);
mockDoc.mockReturnValue({
    listCollections: mockListCollections,
    collection: mockCollection,
});
mockLimit.mockReturnValue(mockQuery);


vi.mock('firebase-admin/firestore', () => {
    const {
        mockCollection, mockDoc, mockBatch
    } = mocks;

    return {
        getFirestore: vi.fn(() => ({
            collection: mockCollection,
            doc: mockDoc,
            batch: mockBatch,
        })),
        Timestamp: {
            now: vi.fn(() => ({ seconds: Date.now() / 1000, nanoseconds: 0 })),
        },
        FieldValue: {
            increment: vi.fn((n: number) => ({ _increment: n })),
            serverTimestamp: vi.fn(() => ({ _serverTimestamp: true })),
        },
    };
});

vi.mock('firebase-admin/app', () => ({
    initializeApp: vi.fn(),
}));

vi.mock('firebase-admin/auth', () => ({
    getAuth: vi.fn(() => ({})),
}));

vi.mock('firebase-admin/storage', () => ({
    getStorage: vi.fn(() => ({})),
}));


import { deleteSubCollections } from './onWaitlistsDelete.js';

describe('onWaitlistsDelete', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Default behaviors
        mockCollection.mockReturnValue(mockQuery);
        mockLimit.mockReturnValue(mockQuery);
        mockDoc.mockReturnValue({
            listCollections: mockListCollections,
            collection: mockCollection,
            ref: { listCollections: mockListCollections, collection: mockCollection }
        });
    });

    it('should recursively delete subcollections', async () => {
        const waitlistId = '123';

        // Define refs first so we can reference them

        // docB (Deepest)
        const docB = {
            id: 'docB',
            ref: {
                delete: vi.fn(),
                listCollections: vi.fn().mockResolvedValue([]),
                collection: vi.fn(),
            }
        };

        const nestedColRef = {
            id: 'NestedCol',
            limit: vi.fn().mockReturnValue({
                get: vi.fn()
                    .mockResolvedValueOnce({
                        size: 1,
                        docs: [docB]
                    })
                    .mockResolvedValueOnce({
                        size: 0,
                        docs: []
                    })
            })
        };

        // docA (Middle)
        const docA = {
            id: 'docA',
            ref: {
                delete: vi.fn(),
                // CRITICAL FIX: Return objects that look like CollectionReferences (have limit)
                listCollections: vi.fn().mockResolvedValue([nestedColRef]),
                collection: vi.fn(),
            }
        };

        // Implement docA.ref.collection for parallel safety if code used it (it doesn't in new logic, but robust)
        docA.ref.collection.mockImplementation((id) => {
            if (id === 'NestedCol') return nestedColRef;
            return { limit: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ size: 0, docs: [] }) }) };
        });

        const subCol1Ref = {
            limit: vi.fn().mockReturnValue({
                get: vi.fn()
                    .mockResolvedValueOnce({
                        size: 1,
                        docs: [docA]
                    })
                    .mockResolvedValueOnce({
                        size: 0,
                        docs: []
                    })
            })
        };


        // Top level doc
        const mockWaitlistDoc = {
            listCollections: vi.fn().mockResolvedValue([{ id: 'SubCol1' }]), // Top level uses id to get collection
            collection: vi.fn(),
            ref: { listCollections: vi.fn(), collection: vi.fn() }
        };

        // db.collection('Waitlists').doc('123')
        mockCollection.mockImplementation((path) => {
            if (path === 'Waitlists') {
                return {
                    doc: (id: string) => {
                        if (id === waitlistId) return mockWaitlistDoc;
                        return { listCollections: vi.fn().mockResolvedValue([]) };
                    }
                };
            }
            return mockQuery;
        });

        mockWaitlistDoc.collection.mockImplementation((id) => {
            if (id === 'SubCol1') return subCol1Ref;
            return { limit: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ size: 0, docs: [] }) }) };
        });

        // Invoke directly
        await deleteSubCollections(waitlistId);

        // Assertions
        expect(mockWaitlistDoc.listCollections).toHaveBeenCalled(); // PASS (Waitlist processing)
        expect(mockWaitlistDoc.collection).toHaveBeenCalledWith('SubCol1'); // PASS

        expect(mockBatch).toHaveBeenCalled();
        expect(mockDelete).toHaveBeenCalledWith(docA.ref); // PASS (docA deleted)

        expect(docA.ref.listCollections).toHaveBeenCalled(); // PASS (Recursion check)
        // In new logic, we call deleteCollectionInBatches(nestedColRef).
        // So nestedColRef.limit should be called.
        expect(nestedColRef.limit).toHaveBeenCalled();

        expect(mockDelete).toHaveBeenCalledWith(docB.ref); // PASS (docB deleted)
    });
});
