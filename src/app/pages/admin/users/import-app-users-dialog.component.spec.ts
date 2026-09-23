import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { Functions } from '@angular/fire/functions';

const { mockCallable, mockHttpsCallable } = vi.hoisted(() => {
    const mockCallable = vi.fn();
    return { mockCallable, mockHttpsCallable: vi.fn(() => mockCallable) };
});
vi.mock('@angular/fire/functions', () => ({ Functions: class {}, httpsCallable: mockHttpsCallable }));

import { ImportAppUsersDialogComponent } from './import-app-users-dialog.component';
import { translocoTestingModule } from '../../../../test/transloco-test-providers';

const preview = { dryRun: true, scanned: 5, imported: 3, alreadyPresent: 1, skippedNoEmail: 1, welcomeEmails: 0 };

describe('ImportAppUsersDialogComponent', () => {
    const dialogRef = { close: vi.fn() };

    beforeEach(async () => {
        vi.clearAllMocks();
        mockCallable.mockResolvedValue({ data: preview });
        await TestBed.configureTestingModule({
            imports: [ImportAppUsersDialogComponent, translocoTestingModule()],
            providers: [{ provide: MatDialogRef, useValue: dialogRef }, { provide: Functions, useValue: {} }],
        }).compileComponents();
    });

    async function open() {
        const fixture = TestBed.createComponent(ImportAppUsersDialogComponent);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        return fixture;
    }

    it('opens with a dry run of the arccms- callable and shows what would happen', async () => {
        const fixture = await open();
        expect(mockHttpsCallable).toHaveBeenCalledWith(expect.anything(), 'arccms-importAppUsers', { timeout: 540_000 });
        expect(mockCallable).toHaveBeenCalledWith({ dryRun: true, sendWelcome: false });
        const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
        expect(text).toContain('3 to import');
        expect(text).toContain('Import 3 users');
    });

    it('imports without welcome emails unless ticked, and closes with the result', async () => {
        const fixture = await open();
        const done = { ...preview, dryRun: false };
        mockCallable.mockResolvedValueOnce({ data: done });
        await fixture.componentInstance.runImport();
        expect(mockCallable).toHaveBeenLastCalledWith({ dryRun: false, sendWelcome: false });
        expect(dialogRef.close).toHaveBeenCalledWith(done);
    });

    it('sends welcome emails only when the admin asks for them', async () => {
        const fixture = await open();
        fixture.componentInstance.sendWelcome = true;
        mockCallable.mockResolvedValueOnce({ data: { ...preview, dryRun: false, welcomeEmails: 3 } });
        await fixture.componentInstance.runImport();
        expect(mockCallable).toHaveBeenLastCalledWith({ dryRun: false, sendWelcome: true });
    });
});
