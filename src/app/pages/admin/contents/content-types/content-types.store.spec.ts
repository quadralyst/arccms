import { TestBed } from '@angular/core/testing';
import { ContentTypesStore } from './content-types.store';
import { ContentTypesService } from './content-types.service';
import { AuthState } from '../../../(auth)/auth.store';
import { vi, describe, beforeEach, it, expect } from 'vitest';

describe('ContentTypesStore', () => {
    let store: ContentTypesStore;
    const mockService = {
        getAll: vi.fn(),
        unsubscribeStore: vi.fn()
    };
    const mockAuthStore = {
        currentUser: vi.fn().mockReturnValue({ id: '123' })
    };

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                ContentTypesStore,
                { provide: ContentTypesService, useValue: mockService },
                { provide: AuthState, useValue: mockAuthStore }
            ],
        });
        store = TestBed.inject(ContentTypesStore);
    });

    it('should be created', () => {
        expect(store).toBeTruthy();
    });
});
