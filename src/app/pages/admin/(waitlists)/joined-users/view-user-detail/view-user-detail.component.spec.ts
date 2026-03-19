/**
 * Tests for ViewUserDetailComponent
 *
 * Focuses on component logic without full Firestore integration.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { signal, SimpleChange } from '@angular/core';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ViewUserDetailComponent } from './view-user-detail.component';

// Mock Firestore query functions used by referral methods
const mockGetDocs = vi.fn();
vi.mock('@angular/fire/firestore', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@angular/fire/firestore')>();
    return {
        ...actual,
        getDocs: (...args: unknown[]) => mockGetDocs(...args),
        collection: vi.fn((...args: unknown[]) => args.join('/')),
        query: vi.fn((...args: unknown[]) => args[0]),
        where: vi.fn(),
        orderBy: vi.fn(),
    };
});
import { WaitlistUserTagsStore } from '../waitlist-user-tags.store';
import { WaitlistUserTagsService } from '../waitlist-user-tags.service';
import { GlobalService } from '../../../../../../shared/services/global.service';
import { ConstantVariables } from '../../../../../../shared/constants/common-constants';

// Create mock store that doesn't depend on Firestore
class MockWaitlistUserTagsStore {
    items = signal<any[]>([]);
    isLoading = signal(false);
    totalRecords = signal(0);

    setWaitlistId = vi.fn();
    getAll = vi.fn();
    add = vi.fn().mockReturnValue({ subscribe: vi.fn() });
    update = vi.fn().mockReturnValue({ subscribe: vi.fn() });
    delete = vi.fn().mockReturnValue({ subscribe: vi.fn() });
    updateUsedColors = vi.fn();
    addTagWithAutoColor = vi.fn().mockReturnValue({ label: 'Test', color: '#FF0000' });
}

// Create mock service
class MockWaitlistUserTagsService {
    waitlistId = '';
    collectionName = 'WaitlistUserTags_default';
    setWaitlistId = vi.fn();
}

describe('ViewUserDetailComponent', () => {
    let component: ViewUserDetailComponent;
    let fixture: ComponentFixture<ViewUserDetailComponent>;

    const mockFirestore = {};
    const mockAuth = {
        currentUser: { uid: 'test-user' }
    };

    const mockUser = {
        id: 'user-1',
        email: 'test@example.com',
        firstName: 'John',
        emailVerified: true,
        queuePosition: 5,
        totalReferrals: 3,
        referralCode: 'ABC123',
        referralLink: 'https://example.com/ref/ABC123',
        signupTimestamp: new Date(),
        formData: {
            city: 'New York',
            phone: '1234567890',
            source: 'Google'
        },
        tags: []
    };

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [ViewUserDetailComponent, NoopAnimationsModule],
            providers: [
                { provide: WaitlistUserTagsStore, useClass: MockWaitlistUserTagsStore },
                { provide: WaitlistUserTagsService, useClass: MockWaitlistUserTagsService },
                GlobalService,
                ConstantVariables,
                { provide: Firestore, useValue: mockFirestore },
                { provide: Auth, useValue: mockAuth },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(ViewUserDetailComponent);
        component = fixture.componentInstance;
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    describe('Input/Output bindings', () => {
        it('should accept user input', () => {
            component.user = mockUser;
            expect(component.user).toEqual(mockUser);
        });

        it('should accept waitlistId input', () => {
            component.waitlistId = 'waitlist-123';
            expect(component.waitlistId).toBe('waitlist-123');
        });

        it('should emit close event', () => {
            const closeSpy = vi.spyOn(component.close, 'emit');
            component.closePanel();
            expect(closeSpy).toHaveBeenCalled();
        });
    });

    describe('formDataEntries', () => {
        it('should return empty array when user is null', () => {
            component.user = null;
            fixture.detectChanges();
            expect(component.formDataEntries()).toEqual([]);
        });
    });

    describe('formatFieldLabel', () => {
        it('should convert camelCase to Title Case', () => {
            expect(component.formatFieldLabel('firstName')).toBe('First Name');
        });

        it('should convert snake_case to Title Case', () => {
            expect(component.formatFieldLabel('first_name')).toBe('First name');
        });

        it('should handle simple words', () => {
            expect(component.formatFieldLabel('city')).toBe('City');
        });
    });

    describe('formatFieldValue', () => {
        it('should return dash for null', () => {
            expect(component.formatFieldValue(null)).toBe('—');
        });

        it('should return dash for undefined', () => {
            expect(component.formatFieldValue(undefined)).toBe('—');
        });

        it('should return Yes for true', () => {
            expect(component.formatFieldValue(true)).toBe('Yes');
        });

        it('should return No for false', () => {
            expect(component.formatFieldValue(false)).toBe('No');
        });

        it('should join arrays with comma', () => {
            expect(component.formatFieldValue(['a', 'b', 'c'])).toBe('a, b, c');
        });

        it('should stringify objects', () => {
            expect(component.formatFieldValue({ key: 'value' })).toBe('{"key":"value"}');
        });

        it('should convert numbers to string', () => {
            expect(component.formatFieldValue(42)).toBe('42');
        });
    });

    describe('formatDate', () => {
        it('should return N/A for null', () => {
            expect(component.formatDate(null)).toBe('N/A');
        });

        it('should format Date objects', () => {
            const date = new Date('2025-01-15T10:30:00');
            const result = component.formatDate(date);
            expect(result).toContain('Jan');
            expect(result).toContain('15');
            expect(result).toContain('2025');
        });

        it('should handle Firestore timestamps', () => {
            const firestoreDate = {
                toDate: () => new Date('2025-01-15T10:30:00')
            };
            const result = component.formatDate(firestoreDate);
            expect(result).toContain('Jan');
            expect(result).toContain('15');
        });
    });

    describe('Tags functionality', () => {
        it('should have empty selected tags initially', () => {
            expect(component.selectedTags()).toEqual([]);
        });

        it('should toggle tag dropdown on focus', () => {
            component.onTagSearchFocus();
            expect(component.showTagDropdown()).toBe(true);
        });

        it('should update tag search term on input', () => {
            const event = { target: { value: 'test' } } as any;
            component.onTagSearchInput(event);
            expect(component.tagSearchTerm()).toBe('test');
        });
    });

    describe('Notes functionality', () => {
        it('should have empty notes initially', () => {
            expect(component.notes()).toEqual([]);
        });

        it('should have empty new note content initially', () => {
            expect(component.newNoteContent()).toBe('');
        });

        it('should not be saving note initially', () => {
            expect(component.isSavingNote()).toBe(false);
        });

        it('should have no editing note initially', () => {
            expect(component.editingNoteId()).toBeNull();
        });

        it('should start edit mode for a note', () => {
            const note = { id: 'note-1', content: 'Test content', createdAt: new Date() };
            component.startEditNote(note);
            expect(component.editingNoteId()).toBe('note-1');
            expect(component.editNoteContent()).toBe('Test content');
        });

        it('should cancel edit mode', () => {
            component.editingNoteId.set('note-1');
            component.editNoteContent.set('Some content');
            component.cancelEditNote();
            expect(component.editingNoteId()).toBeNull();
            expect(component.editNoteContent()).toBe('');
        });
    });

    describe('Referral visibility', () => {
        beforeEach(() => {
            mockGetDocs.mockReset();
            // Default: empty snapshot for notes/tags
            mockGetDocs.mockResolvedValue({ empty: true, docs: [], forEach: vi.fn() });
        });

        it('should have empty referral signals initially', () => {
            expect(component.referredByCode()).toBe('');
            expect(component.referredByUser()).toBeNull();
            expect(component.referredUsers()).toEqual([]);
            expect(component.isLoadingReferredBy()).toBe(false);
            expect(component.isLoadingReferredUsers()).toBe(false);
        });

        it('should clear referral signals when user has no referredBy', async () => {
            component.user = { ...mockUser, referredBy: undefined, isConfirmed: true };
            component.waitlistId = 'wl-1';
            component.ngOnChanges({
                user: new SimpleChange(null, component.user, true),
            });

            // Wait for async methods to complete
            await vi.waitFor(() => {
                expect(component.isLoadingReferredBy()).toBe(false);
            });

            expect(component.referredByCode()).toBe('');
            expect(component.referredByUser()).toBeNull();
        });

        it('should set referredByCode and resolve referrer when code matches a user', async () => {
            const referrerDoc = {
                id: 'referrer-1',
                data: () => ({ firstName: 'Jane', email: 'jane@example.com', referralCode: 'XYZ789' }),
            };
            // First call: notes (empty). Second call: referrer lookup. Third+: referrals.
            mockGetDocs
                .mockResolvedValueOnce({ empty: true, docs: [], forEach: vi.fn() }) // notes
                .mockResolvedValueOnce({ empty: false, docs: [referrerDoc] })        // referrer query
                .mockResolvedValueOnce({ empty: true, docs: [] });                   // referrals

            component.user = { ...mockUser, referredBy: 'XYZ789', waitlistedUserId: 'wu-1', isConfirmed: true };
            component.waitlistId = 'wl-1';
            component.ngOnChanges({
                user: new SimpleChange(null, component.user, true),
            });

            await vi.waitFor(() => {
                expect(component.isLoadingReferredBy()).toBe(false);
            });

            expect(component.referredByCode()).toBe('XYZ789');
            expect(component.referredByUser()).toEqual({ firstName: 'Jane', email: 'jane@example.com' });
        });

        it('should set referredByCode but leave referredByUser null for arbitrary/external codes', async () => {
            // All queries return empty — no matching referrer
            mockGetDocs.mockResolvedValue({ empty: true, docs: [], forEach: vi.fn() });

            component.user = { ...mockUser, referredBy: 'PRODUCTHUNT', waitlistedUserId: 'wu-1', isConfirmed: true };
            component.waitlistId = 'wl-1';
            component.ngOnChanges({
                user: new SimpleChange(null, component.user, true),
            });

            await vi.waitFor(() => {
                expect(component.isLoadingReferredBy()).toBe(false);
            });

            expect(component.referredByCode()).toBe('PRODUCTHUNT');
            expect(component.referredByUser()).toBeNull();
        });

        it('should load referred users from subcollection', async () => {
            const referral1 = {
                id: 'ref-1',
                data: () => ({
                    referredName: 'Bob',
                    referredMaskedEmail: 'b***@example.com',
                    status: 'completed',
                    createdAt: new Date(),
                    completedAt: new Date(),
                }),
            };
            const referral2 = {
                id: 'ref-2',
                data: () => ({
                    referredName: 'Alice',
                    referredMaskedEmail: 'a***@example.com',
                    status: 'pending',
                    createdAt: new Date(),
                    completedAt: null,
                }),
            };

            mockGetDocs
                .mockResolvedValueOnce({ empty: true, docs: [], forEach: vi.fn() })      // notes
                .mockResolvedValueOnce({ empty: false, docs: [referral1, referral2] });   // referrals (no referrer lookup since no referredBy)

            component.user = { ...mockUser, waitlistedUserId: 'wu-1', isConfirmed: true };
            component.waitlistId = 'wl-1';
            component.ngOnChanges({
                user: new SimpleChange(null, component.user, true),
            });

            await vi.waitFor(() => {
                expect(component.isLoadingReferredUsers()).toBe(false);
            });

            const referred = component.referredUsers();
            expect(referred).toHaveLength(2);
            expect(referred[0].referredName).toBe('Bob');
            expect(referred[0].status).toBe('completed');
            expect(referred[1].referredName).toBe('Alice');
            expect(referred[1].status).toBe('pending');
        });

        it('should return empty referred users when no waitlistedUserId', async () => {
            mockGetDocs.mockResolvedValue({ empty: true, docs: [], forEach: vi.fn() });

            component.user = { ...mockUser, waitlistedUserId: undefined, isConfirmed: true };
            component.waitlistId = 'wl-1';
            component.ngOnChanges({
                user: new SimpleChange(null, component.user, true),
            });

            await vi.waitFor(() => {
                expect(component.isLoadingReferredUsers()).toBe(false);
            });

            expect(component.referredUsers()).toEqual([]);
        });

        it('should handle Firestore errors gracefully in loadReferredByInfo', async () => {
            mockGetDocs
                .mockResolvedValueOnce({ empty: true, docs: [], forEach: vi.fn() }) // notes
                .mockRejectedValueOnce(new Error('Firestore error'))                  // referrer query fails
                .mockResolvedValueOnce({ empty: true, docs: [] });                    // referrals

            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            component.user = { ...mockUser, referredBy: 'BADCODE', waitlistedUserId: 'wu-1', isConfirmed: true };
            component.waitlistId = 'wl-1';
            component.ngOnChanges({
                user: new SimpleChange(null, component.user, true),
            });

            await vi.waitFor(() => {
                expect(component.isLoadingReferredBy()).toBe(false);
            });

            expect(component.referredByCode()).toBe('BADCODE');
            expect(component.referredByUser()).toBeNull();
            expect(consoleSpy).toHaveBeenCalledWith('Error loading referrer info:', expect.any(Error));
            consoleSpy.mockRestore();
        });

        it('should handle Firestore errors gracefully in loadReferredUsers', async () => {
            mockGetDocs
                .mockResolvedValueOnce({ empty: true, docs: [], forEach: vi.fn() }) // notes
                .mockRejectedValueOnce(new Error('Firestore error'));                 // referrals fail (no referrer lookup since no referredBy)

            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            component.user = { ...mockUser, waitlistedUserId: 'wu-1', isConfirmed: true };
            component.waitlistId = 'wl-1';
            component.ngOnChanges({
                user: new SimpleChange(null, component.user, true),
            });

            await vi.waitFor(() => {
                expect(component.isLoadingReferredUsers()).toBe(false);
            });

            expect(component.referredUsers()).toEqual([]);
            expect(consoleSpy).toHaveBeenCalledWith('Error loading referred users:', expect.any(Error));
            consoleSpy.mockRestore();
        });
    });

    describe('Signup Metadata Display', () => {
        it('should return empty array if no metadata', () => {
            component.user = { ...mockUser, signupMetadata: undefined };
            component.ngOnChanges({
                user: new SimpleChange(null, component.user, true)
            });
            fixture.detectChanges();
            expect(component.metadataEntries()).toEqual([]);
            expect(component.hasSignupMetadata()).toBe(false);
        });

        it('should format metadata entries correctly', () => {
            component.user = {
                ...mockUser,
                signupMetadata: {
                    utmSource: 'google',
                    deviceType: 'mobile',
                    timeOnPageMs: 5000,
                    isReturnVisitor: true,
                    country: 'US',
                    isDisposableEmail: true
                }
            };
            component.ngOnChanges({
                user: new SimpleChange(null, component.user, true)
            });
            fixture.detectChanges();

            const entries = component.metadataEntries();
            const keys = entries.map(e => e.key);
            
            expect(keys).toContain('utmSource');
            expect(keys).toContain('deviceType');
            expect(keys).toContain('timeOnPage');
            expect(keys).toContain('isReturnVisitor');
            expect(keys).toContain('country');
            expect(keys).toContain('isDisposableEmail');
        });

        it('should format duration correctly', () => {
           // Access private method via any cast for testing, or rely on public output
           // Since we test the public metadataEntries(), let's check the value there
           component.user = {
               ...mockUser,
               signupMetadata: { timeOnPageMs: 65000 }
           };
           component.ngOnChanges({
            user: new SimpleChange(null, component.user, true)
           });
           fixture.detectChanges();
           
           const entry = component.metadataEntries().find(e => e.key === 'timeOnPage');
           expect(entry?.value).toBe('1m 5s');
        });

        it('should add icons for known fields', () => {
            component.user = {
                ...mockUser,
                signupMetadata: { deviceType: 'mobile' }
            };
            component.ngOnChanges({
                user: new SimpleChange(null, component.user, true)
            });
            fixture.detectChanges();
            
            const entry = component.metadataEntries().find(e => e.key === 'deviceType');
            expect(entry?.icon).toBe('fa-mobile-alt');
        });

        it('should display visitor count for return visitors', () => {
            component.user = {
                ...mockUser,
                signupMetadata: { isReturnVisitor: true, visitCount: 5 }
            };
            component.ngOnChanges({
                user: new SimpleChange(null, component.user, true)
            });
            fixture.detectChanges();
            
            const entry = component.metadataEntries().find(e => e.key === 'isReturnVisitor');
            expect(entry?.value).toBe('Returning (5)');
        });
    });
});
