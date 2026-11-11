import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MatDialog } from '@angular/material/dialog';
import { Observable, firstValueFrom, of } from 'rxjs';
import { signal } from '@angular/core';
import { unsavedChangesGuard } from './unsaved-changes.guard';
import { AuthState } from '../pages/(auth)/auth.store';

// RF4 4.2: "Leave without saving?" with Stay (focused) and Leave.
describe('unsavedChangesGuard', () => {
    let dialog: { open: ReturnType<typeof vi.fn> };
    const currentUser = signal<unknown>({ id: 'admin-1' });
    const run = (component: unknown) => TestBed.runInInjectionContext(
        () => unsavedChangesGuard(component, null as any, null as any, null as any),
    );

    beforeEach(() => {
        dialog = { open: vi.fn().mockReturnValue({ afterClosed: () => of(undefined) }) };
        currentUser.set({ id: 'admin-1' });
        TestBed.configureTestingModule({ providers: [
            { provide: MatDialog, useValue: dialog },
            { provide: AuthState, useValue: { currentUser } },
        ] });
    });

    it('lets the page go without a question when nothing is unsaved', () => {
        expect(run({ hasUnsavedChanges: () => false })).toBe(true);
        expect(run({})).toBe(true);
        expect(dialog.open).not.toHaveBeenCalled();
    });

    it('asks with Stay as the cancel button and Leave as the red one; Stay keeps the page', async () => {
        const answer = run({ hasUnsavedChanges: () => true }) as Observable<boolean>;
        expect(await firstValueFrom(answer)).toBe(false);
        const data = dialog.open.mock.calls[0][1].data;
        expect(data.titleKey).toBe('common.leave.title');
        expect(data.cancelText).toBeTruthy();
        expect(data.btnText).toBeTruthy();
        expect(data.panelType).toBe('warn');
    });

    it('leaves only on Leave', async () => {
        dialog.open.mockReturnValue({ afterClosed: () => of(true) });
        expect(await firstValueFrom(run({ hasUnsavedChanges: () => true }) as Observable<boolean>)).toBe(true);
    });

    // RF4 review M5: once signed out, the work cannot be saved, so there is nothing to stay for.
    it('lets a signed-out person leave without asking', () => {
        currentUser.set(null);
        expect(run({ hasUnsavedChanges: () => true })).toBe(true);
        expect(dialog.open).not.toHaveBeenCalled();
    });
});
