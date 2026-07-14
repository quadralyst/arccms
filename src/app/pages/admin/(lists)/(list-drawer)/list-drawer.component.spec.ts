import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ListDrawerComponent } from './list-drawer.component';
import { AudienceService } from '../../(audience)/audience.service';
import { ToastService } from '../../../../../shared/services/toast.service';

describe('ListDrawerComponent', () => {
    let component: ListDrawerComponent;
    let audience: { createList: ReturnType<typeof vi.fn>; updateList: ReturnType<typeof vi.fn> };
    let toast: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        audience = { createList: vi.fn().mockResolvedValue(undefined), updateList: vi.fn().mockResolvedValue(undefined) };
        toast = { success: vi.fn(), error: vi.fn() };

        await TestBed.configureTestingModule({
            imports: [ListDrawerComponent, NoopAnimationsModule],
            providers: [
                { provide: AudienceService, useValue: audience },
                { provide: ToastService, useValue: toast },
            ],
        }).compileComponents();
        component = TestBed.createComponent(ListDrawerComponent).componentInstance;
    });

    it('creates', () => {
        expect(component).toBeTruthy();
    });

    it('does nothing on submit when the name is blank', async () => {
        component.mode = 'add';
        component.name = '   ';
        await component.submit();
        expect(audience.createList).not.toHaveBeenCalled();
        expect(audience.updateList).not.toHaveBeenCalled();
    });

    it('creates a list in add mode then emits saved + close', async () => {
        const events: string[] = [];
        component.saved.subscribe(() => events.push('saved'));
        component.close.subscribe(() => events.push('close'));
        component.mode = 'add';
        component.name = 'Newsletter';
        component.description = 'Weekly digest';
        await component.submit();
        expect(audience.createList).toHaveBeenCalledWith('Newsletter', 'Weekly digest');
        expect(events).toEqual(['saved', 'close']);
    });

    it('ngOnChanges hydrates the form from the list in edit mode', () => {
        component.mode = 'edit';
        component.list = { id: 'l1', name: 'VIPs', description: 'Top customers', type: 'manual' };
        component.ngOnChanges();
        expect(component.name).toBe('VIPs');
        expect(component.description).toBe('Top customers');
    });

    it('updates the existing list in edit mode', async () => {
        component.mode = 'edit';
        component.list = { id: 'l1', name: 'VIPs', type: 'manual' };
        component.ngOnChanges();
        component.name = 'VIP customers';
        await component.submit();
        expect(audience.updateList).toHaveBeenCalledWith('l1', { name: 'VIP customers', description: '' });
        expect(audience.createList).not.toHaveBeenCalled();
    });
});
