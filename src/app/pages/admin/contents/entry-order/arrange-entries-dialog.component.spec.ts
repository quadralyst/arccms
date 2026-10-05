/**
 * The Arrange dialog (specs/site-sections-spec.md, SS2).
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ArrangeEntriesDialogComponent } from './arrange-entries-dialog.component';
import { EntryOrderService, OrderedEntry } from './entry-order.service';
import { NotifyService } from '../../../../../shared/services/notify.service';

const ENTRIES: OrderedEntry[] = [
    { id: 'a', title: 'Design', published: true, sortOrder: 1 },
    { id: 'b', title: 'Search', published: true, sortOrder: 2 },
    { id: 'c', title: 'Hosting', published: false },
];

describe('ArrangeEntriesDialogComponent', () => {
    let fixture: ComponentFixture<ArrangeEntriesDialogComponent>;
    let component: ArrangeEntriesDialogComponent;
    const entryOrder = { load: vi.fn(), save: vi.fn() };
    const dialogRef = { close: vi.fn() };
    const notify = { success: vi.fn(), error: vi.fn() };

    async function open(entries: OrderedEntry[] = ENTRIES) {
        entryOrder.load.mockResolvedValue(entries);
        await TestBed.configureTestingModule({
            imports: [ArrangeEntriesDialogComponent, NoopAnimationsModule],
            providers: [
                { provide: MAT_DIALOG_DATA, useValue: { slug: 'services', typeName: 'Services' } },
                { provide: MatDialogRef, useValue: dialogRef },
                { provide: EntryOrderService, useValue: entryOrder },
                { provide: NotifyService, useValue: notify },
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(ArrangeEntriesDialogComponent);
        component = fixture.componentInstance;
        await fixture.whenStable();
        fixture.detectChanges();
    }

    const root = () => fixture.nativeElement as HTMLElement;
    const titles = () => [...root().querySelectorAll('.arrange-title')].map((el) => el.textContent?.trim());
    const saveButton = () => root().querySelector('[data-testid="arrange-save"]') as HTMLButtonElement;

    beforeEach(() => {
        vi.clearAllMocks();
        entryOrder.save.mockResolvedValue(undefined);
    });

    it('lists the entries in their order, marking those not on the site', async () => {
        await open();
        expect(entryOrder.load).toHaveBeenCalledWith('services');
        expect(titles()).toEqual(['Design', 'Search', 'Hosting']);
        expect(root().querySelectorAll('.arrange-draft').length).toBe(1);
        expect(saveButton().disabled).toBe(true); // nothing moved yet
    });

    it('moves an entry with its arrows and saves the new order', async () => {
        await open();
        const downOnFirst = root().querySelectorAll('.arrange-row')[0].querySelectorAll('button')[1] as HTMLButtonElement;
        downOnFirst.click();
        fixture.detectChanges();
        expect(titles()).toEqual(['Search', 'Design', 'Hosting']);
        expect(saveButton().disabled).toBe(false);

        saveButton().click();
        await fixture.whenStable();
        expect(entryOrder.save).toHaveBeenCalledWith('services', ['b', 'a', 'c']);
        expect(dialogRef.close).toHaveBeenCalledWith(true);
        expect(notify.success).toHaveBeenCalledWith('admin.contents.arrange.saved');
    });

    it('cannot move the first entry up or the last one down', async () => {
        await open();
        const rows = root().querySelectorAll('.arrange-row');
        expect((rows[0].querySelectorAll('button')[0] as HTMLButtonElement).disabled).toBe(true);
        expect((rows[2].querySelectorAll('button')[1] as HTMLButtonElement).disabled).toBe(true);
    });

    it('takes a drag as a move', async () => {
        await open();
        component.drop({ previousIndex: 2, currentIndex: 0 } as never);
        fixture.detectChanges();
        expect(titles()).toEqual(['Hosting', 'Design', 'Search']);
    });

    it('says the list page shows only the first 100 when there are many', async () => {
        await open(Array.from({ length: 201 }, (_, i) => ({ id: `e${i}`, title: `Entry ${i}`, published: true })));
        expect(root().querySelector('[data-testid="arrange-warning"]')).not.toBeNull();
    });

    it('stays open and says so when saving fails', async () => {
        await open();
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        entryOrder.save.mockRejectedValue(new Error('offline'));
        component.move(0, 1);
        await component.save();
        expect(dialogRef.close).not.toHaveBeenCalled();
        expect(notify.error).toHaveBeenCalledWith('admin.contents.arrange.save_failed');
        expect(component.saving()).toBe(false);
    });
});
