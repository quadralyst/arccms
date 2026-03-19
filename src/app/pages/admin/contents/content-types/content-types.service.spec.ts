import { TestBed } from '@angular/core/testing';
import { ContentTypesService } from './content-types.service';
import { Firestore } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { vi, describe, beforeEach, it, expect } from 'vitest';

vi.mock('@angular/fire/firestore', () => ({
    Firestore: class { },
    collection: vi.fn(),
    doc: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    startAfter: vi.fn(),
    endBefore: vi.fn(),
}));

describe('ContentTypesService', () => {
    let service: ContentTypesService;
    const mockFirestore = {};
    const mockAuth = {};

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                ContentTypesService,
                { provide: Firestore, useValue: mockFirestore },
                { provide: Auth, useValue: mockAuth },
            ],
        });
        service = TestBed.inject(ContentTypesService);
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });
});
