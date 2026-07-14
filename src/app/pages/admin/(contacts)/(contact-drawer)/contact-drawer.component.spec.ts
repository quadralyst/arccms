import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ContactDrawerComponent } from './contact-drawer.component';
import { AudienceService } from '../../(audience)/audience.service';
import { ToastService } from '../../../../../shared/services/toast.service';

describe('ContactDrawerComponent', () => {
    let component: ContactDrawerComponent;
    let audience: {
        addContact: ReturnType<typeof vi.fn>;
        previewCsv: ReturnType<typeof vi.fn>;
        importContacts: ReturnType<typeof vi.fn>;
        setConsent: ReturnType<typeof vi.fn>;
    };
    let toast: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        audience = {
            addContact: vi.fn().mockResolvedValue({}),
            previewCsv: vi.fn().mockResolvedValue({
                data: { validCount: 1, invalidCount: 0, duplicateCount: 0, valid: [{ email: 'a@b.com' }], invalidRows: [] },
            }),
            importContacts: vi.fn().mockResolvedValue({ data: { imported: 1 } }),
            setConsent: vi.fn().mockResolvedValue({}),
        };
        toast = { success: vi.fn(), error: vi.fn() };

        await TestBed.configureTestingModule({
            imports: [ContactDrawerComponent, NoopAnimationsModule],
            providers: [
                { provide: AudienceService, useValue: audience },
                { provide: ToastService, useValue: toast },
            ],
        }).compileComponents();
        component = TestBed.createComponent(ContactDrawerComponent).componentInstance;
    });

    it('creates', () => {
        expect(component).toBeTruthy();
    });

    describe('add mode', () => {
        it('rejects an invalid email without calling the service', async () => {
            component.newEmail = 'nope';
            await component.addContact();
            expect(audience.addContact).not.toHaveBeenCalled();
            expect(toast.error).toHaveBeenCalled();
        });

        it('adds a valid contact then emits saved and close', async () => {
            const events: string[] = [];
            component.saved.subscribe(() => events.push('saved'));
            component.close.subscribe(() => events.push('close'));
            component.newEmail = 'A@B.com';
            component.newName = 'Alice';
            component.newConsent = true;
            await component.addContact();
            expect(audience.addContact).toHaveBeenCalledWith('a@b.com', 'Alice', [], true);
            expect(events).toEqual(['saved', 'close']);
        });
    });

    describe('import mode', () => {
        it('previewCsv stores the parsed preview', async () => {
            component.csvText = 'a@b.com,Alice';
            await component.previewCsv();
            expect(component.csvPreview()?.validCount).toBe(1);
        });

        it('importCsv requires a target list', async () => {
            component.csvPreview.set({ validCount: 1, invalidCount: 0, duplicateCount: 0, valid: [{ email: 'a@b.com' }], invalidRows: [] });
            component.importListId = '';
            await component.importCsv();
            expect(audience.importContacts).not.toHaveBeenCalled();
            expect(toast.error).toHaveBeenCalled();
        });

        it('importCsv imports with the chosen list and consent flag', async () => {
            component.csvPreview.set({ validCount: 1, invalidCount: 0, duplicateCount: 0, valid: [{ email: 'a@b.com' }], invalidRows: [] });
            component.importListId = 'list1';
            component.importConsent = true;
            await component.importCsv();
            expect(audience.importContacts).toHaveBeenCalledWith([{ email: 'a@b.com' }], 'list1', true);
        });
    });

    describe('view mode', () => {
        it('setConsent updates the contact and emits saved + close', async () => {
            const events: string[] = [];
            component.saved.subscribe(() => events.push('saved'));
            component.close.subscribe(() => events.push('close'));
            component.contact = { id: 'hash1', email: 'a@b.com' };
            await component.setConsent('unsubscribed');
            expect(audience.setConsent).toHaveBeenCalledWith('hash1', 'unsubscribed');
            expect(events).toEqual(['saved', 'close']);
        });

        it('setConsent is a no-op without a contact id', async () => {
            component.contact = { id: undefined, email: 'a@b.com' };
            await component.setConsent('subscribed');
            expect(audience.setConsent).not.toHaveBeenCalled();
        });
    });
});
