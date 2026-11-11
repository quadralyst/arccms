/**
 * Tests for WaitlistTagsPage
 * 
 * Uses mock store/service with Vitest.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { headerTestProviders } from '../../../../../test/header-test-providers';
import { Firestore } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { ActivatedRoute, Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import WaitlistTagsComponent from './tags.page';
import { WaitlistUserTagsStore } from '../joined-users/waitlist-user-tags.store';
import { WaitlistUserTagsService } from '../joined-users/waitlist-user-tags.service';
import { ConstantVariables } from '../../../../../shared/constants/common-constants';
import { ConfirmService } from '../../../../../shared/components/confirmation-popup/confirm.service';
import { NotifyService } from '../../../../../shared/services/notify.service';

// Create mock store
class MockWaitlistUserTagsStore {
    currentPageNumber = signal(0);
    items = signal<any[]>([]);
    isLoading = signal(false);
    totalRecords = signal(0);
    error = signal('');

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

describe('WaitlistTagsComponent', () => {
    let component: WaitlistTagsComponent;
    let fixture: ComponentFixture<WaitlistTagsComponent>;
    let mockRouter: any;
    let mockDialog: any;

    const mockFirestore = {};
    const confirmDialog = { ask: vi.fn(async () => true) };
    const notify = { error: vi.fn(), success: vi.fn() };
    const mockAuth = {
        currentUser: { uid: 'test-user' }
    };

    beforeEach(async () => {
        mockRouter = {
            navigate: vi.fn()
        };

        mockDialog = {
            open: vi.fn().mockReturnValue({
                afterClosed: () => of(false)
            })
        };

        await TestBed.configureTestingModule({
            imports: [WaitlistTagsComponent, NoopAnimationsModule],
            providers: [
                ...headerTestProviders(),
                { provide: WaitlistUserTagsStore, useClass: MockWaitlistUserTagsStore },
                { provide: WaitlistUserTagsService, useClass: MockWaitlistUserTagsService },
                ConstantVariables,
                { provide: Firestore, useValue: mockFirestore },
                { provide: Auth, useValue: mockAuth },
                { provide: Router, useValue: mockRouter },
                { provide: MatDialog, useValue: mockDialog },
                { provide: ConfirmService, useValue: confirmDialog },
                { provide: NotifyService, useValue: notify },
                {
                    provide: ActivatedRoute,
                    useValue: {
                        queryParams: of({
                            waitlistId: 'test-waitlist',
                            waitlistName: 'Test Waitlist'
                        }),
                        snapshot: {
                            queryParamMap: { get: vi.fn().mockReturnValue(null) },
                        },
                    }
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(WaitlistTagsComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    describe('initialization', () => {
        it('should extract waitlistId from query params', () => {
            expect(component.waitlistId).toBe('test-waitlist');
        });

        it('should extract waitlistName from query params', () => {
            expect(component.waitlistName).toBe('Test Waitlist');
        });
    });

    describe('goBack', () => {
        it('should navigate to waitlists page', () => {
            component.goBack();
            expect(mockRouter.navigate).toHaveBeenCalledWith(['/admin/waitlists']);
        });
    });

    describe('pagination', () => {
        it('should have default page size of 10', () => {
            expect(component.pageSize()).toBe(10);
        });

        it('should start at page 0', () => {
            expect(component.currentPage()).toBe(0);
        });

        it('should update page on page change', () => {
            component.onPageChange({ pageIndex: 2, pageSize: 25, length: 100 });
            expect(component.currentPage()).toBe(2);
            expect(component.pageSize()).toBe(25);
        });
    });

    describe('sorting', () => {
        it('should have default sort field of label', () => {
            expect(component.sortField()).toBe('label');
        });

        it('should have default sort order of asc', () => {
            expect(component.sortOrder()).toBe('asc');
        });

        it('should toggle sort order when same field clicked', () => {
            component.setSortField('label');
            expect(component.sortOrder()).toBe('desc');
        });

        it('should change field and reset to asc when different field clicked', () => {
            component.setSortField('usageCount');
            expect(component.sortField()).toBe('usageCount');
            expect(component.sortOrder()).toBe('asc');
        });

    });

    describe('quick add tag', () => {
        it('should not add tag if label is empty', () => {
            component.newTagLabel = '';
            const storeMock = component.tagsStore as any;
            component.quickAddTag();
            expect(storeMock.add).not.toHaveBeenCalled();
        });

        it('should not add tag if label is whitespace only', () => {
            component.newTagLabel = '   ';
            const storeMock = component.tagsStore as any;
            component.quickAddTag();
            expect(storeMock.add).not.toHaveBeenCalled();
        });
    });

    describe('drawer', () => {
        it('should have no current action initially', () => {
            expect(component.currentAction()).toBeNull();
        });

        it('should have no editing tag initially', () => {
            expect(component.editingTag()).toBeNull();
        });
    });

    describe('color selection', () => {
        it('should update edit color', () => {
            component.selectColor('#00FF00');
            expect(component.editColor()).toBe('#00FF00');
        });
    });


    describe('delete (RF4, 4.11)', () => {
        const tag = { id: 't1', label: 'VIP <i>x</i>', color: '#FF0000' } as any;
        const asked = () => (confirmDialog.ask.mock.calls.at(-1) as any[])[0];

        beforeEach(() => {
            confirmDialog.ask.mockClear();
            notify.error.mockClear();
        });

        it('says how many sign-ups lose the tag, naming it safely', async () => {
            vi.spyOn(component, 'signupsWithTag').mockResolvedValue(12);
            await component.deleteItem(tag);
            expect(asked().panelType).toBe('warn');
            expect(asked().dialogMessage).toContain('12 sign-ups have it and will lose it');
            expect(asked().dialogMessage).toContain('VIP &lt;i&gt;x&lt;/i&gt;');
        });

        it('has wording for one, none, and a count it could not read', async () => {
            const spy = vi.spyOn(component, 'signupsWithTag');
            spy.mockResolvedValueOnce(1);
            await component.deleteItem(tag);
            expect(asked().dialogMessage).toContain('1 sign-up has it');
            spy.mockResolvedValueOnce(0);
            await component.deleteItem(tag);
            expect(asked().dialogMessage).toContain('No sign-ups have it');
            spy.mockResolvedValueOnce(null);
            await component.deleteItem(tag);
            expect(asked().dialogMessage).toContain('Sign-ups that have it will lose it');
        });

        it('deletes only when confirmed, and says so when it fails', async () => {
            vi.spyOn(component, 'signupsWithTag').mockResolvedValue(0);
            const store = TestBed.inject(WaitlistUserTagsStore) as any;
            confirmDialog.ask.mockResolvedValueOnce(false);
            await component.deleteItem(tag);
            expect(store.delete).not.toHaveBeenCalled();

            store.delete.mockReturnValueOnce({ subscribe: (o: any) => o.error(new Error('denied')) });
            await component.deleteItem(tag);
            expect(store.delete).toHaveBeenCalledWith('t1');
            expect(notify.error).toHaveBeenCalledWith('admin.forms.tag_delete_failed');
        });
    });

    describe('load error and Retry (RF5, 5.1)', () => {
        const table = () => fixture.debugElement.query((el) => el.name === 'app-global-table').componentInstance;

        it('passes a failed load to the table as the standard error', () => {
            expect(table().error).toBeNull();
            (component.tagsStore as any).error.set('Missing or insufficient permissions.');
            fixture.detectChanges();
            expect(table().error).toBe(true);
        });

        it('Retry reads the tags again', () => {
            const store = component.tagsStore as any;
            store.getAll.mockClear();
            table().retry.emit();
            expect(store.getAll).toHaveBeenCalledTimes(1);
        });

        it('says so when adding or saving a tag fails, and reads the list again', () => {
            const store = component.tagsStore as any;
            vi.spyOn(console, 'error').mockImplementation(() => undefined);
            notify.error.mockClear();
            store.add.mockReturnValueOnce({ subscribe: (o: any) => o.error(new Error('denied')) });
            component.newTagLabel = 'VIP';
            store.getAll.mockClear();
            component.quickAddTag();
            expect(notify.error).toHaveBeenCalledWith('admin.forms.tags.add_failed');
            expect(store.getAll).toHaveBeenCalled();

            component.editingTag.set({ id: 't1', label: 'VIP', color: '#f00' } as any);
            component.editLabel.set('VIP 2');
            store.update.mockReturnValueOnce({ subscribe: (o: any) => o.error(new Error('denied')) });
            component.saveEdit();
            expect(notify.error).toHaveBeenCalledWith('admin.forms.tags.save_failed');
        });

        it('reads in the admin language, with column names as translation keys', () => {
            const text = (fixture.nativeElement as HTMLElement).textContent || '';
            expect(text).toContain('Add tag');
            expect(component.tableColumns.filter((c) => c.header !== '#').every((c) => /^(admin|common)\./.test(c.header))).toBe(true);
        });
    });

    describe('record count', () => {
        it('should return 0 for start record when no records', () => {
            expect(component.getStartRecord()).toBe(0);
        });

        it('should calculate end record based on page size', () => {
            expect(component.getEndRecord()).toBe(0);
        });
    });
});
