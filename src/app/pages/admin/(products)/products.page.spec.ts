import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';

vi.mock('@angular/fire/functions', () => ({
    Functions: class {},
    httpsCallable: vi.fn(() => async () => ({ data: {} })),
}));

import { Functions } from '@angular/fire/functions';
import ProductsPageComponent from './products.page';
import { ProductsStore } from './products.store';
import { ProductsService } from './products.service';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { RowActionsComponent } from '../../../../shared/components/row-actions/row-actions.component';
import { ConfirmService } from '../../../../shared/components/confirmation-popup/confirm.service';

function productsService() {
    let next = 0;
    return {
        loadCodes: vi.fn().mockResolvedValue({}),
        saveWithCodes: vi.fn().mockResolvedValue(undefined),
        newProductId: vi.fn(() => `new${++next}`),
        deleteCodes: vi.fn().mockResolvedValue(undefined),
        moveLegacyCodes: vi.fn().mockResolvedValue(0),
    };
}

describe('ProductsPageComponent pricing tiers', () => {
    let fixture: ComponentFixture<ProductsPageComponent>;
    let page: ProductsPageComponent;

    const root = () => fixture.nativeElement as HTMLElement;
    const rows = () => Array.from(root().querySelectorAll<HTMLElement>('[formarrayname="tiers"] .tier-row'));
    const labelInputs = () => rows().map((row) => row.querySelector('input[formcontrolname="label"]') as HTMLInputElement);
    const removeButton = (row: HTMLElement) => row.querySelector('button[color="warn"]') as HTMLButtonElement;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [ProductsPageComponent, NoopAnimationsModule],
            providers: [
                { provide: ProductsStore, useValue: { getAll: vi.fn(), isLoading: signal(false), items: signal([]), error: signal('') } },
                { provide: ProductsService, useValue: productsService() },
                { provide: Functions, useValue: {} },
                { provide: Router, useValue: { navigate: vi.fn() } },
                { provide: ActivatedRoute, useValue: { snapshot: { params: {} }, params: of({}), queryParams: of({}) } },
            ],
        })
            // The page header and row menu are not under test here.
            .overrideComponent(ProductsPageComponent, {
                remove: { imports: [PageHeaderComponent, RowActionsComponent] },
                add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] },
            })
            .compileComponents();

        fixture = TestBed.createComponent(ProductsPageComponent);
        page = fixture.componentInstance;
        fixture.detectChanges();

        page.openCreate();
        ['Early', 'Regular', 'Late'].forEach((label) => {
            page.addTier();
            page.tiers.at(page.tiers.length - 1).get('label')?.setValue(label);
        });
        fixture.detectChanges();
    });

    it('removing the middle tier removes that tier from the screen', () => {
        const lateRow = rows()[2];
        removeButton(rows()[1]).click();
        fixture.detectChanges();

        expect(page.tiers.controls.map((t) => t.get('label')?.value)).toEqual(['Early', 'Late']);
        expect(labelInputs().map((input) => input.value)).toEqual(['Early', 'Late']);
        expect(rows()[1]).toBe(lateRow);
    });

    it('sends later edits to the tier shown, not to the removed one', () => {
        removeButton(rows()[1]).click();
        fixture.detectChanges();

        const input = labelInputs()[1];
        input.value = 'Late bird';
        input.dispatchEvent(new Event('input'));

        expect(page.tiers.at(1).get('label')?.value).toBe('Late bird');
        expect(page.tiers.at(0).get('label')?.value).toBe('Early');
    });

    it('marks the form as changed', () => {
        expect(page.form.dirty).toBe(false);
        removeButton(rows()[1]).click();
        expect(page.form.dirty).toBe(true);
    });
});

describe('ProductsPageComponent tier discount codes', () => {
    let page: ProductsPageComponent;
    let service: ReturnType<typeof productsService>;
    let store: { getAll: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; add: ReturnType<typeof vi.fn>; isLoading: ReturnType<typeof signal<boolean>>; items: ReturnType<typeof signal<any[]>>; error: ReturnType<typeof signal<string>> };

    const legacyProduct = {
        id: 'p1', name: 'Gold', active: true, type: 'one_time', premiumType: 'gold', tierRank: 1, purchaseCount: 0,
        providerProductIds: { dodo: 'prod_gold' },
        tiers: [{ label: 'Early', maxCount: 10, discountCode: 'EARLY', discountPct: 50 }],
    };

    async function setUp(items: any[], codes: Record<string, string[]> = {}, tweak?: (s: ReturnType<typeof productsService>) => void) {
        service = productsService();
        service.loadCodes.mockResolvedValue(codes);
        tweak?.(service);
        store = {
            getAll: vi.fn(), isLoading: signal(false), items: signal(items), error: signal(''),
            update: vi.fn(() => of(undefined)), add: vi.fn(() => of('new1')),
        };
        await TestBed.configureTestingModule({
            imports: [ProductsPageComponent, NoopAnimationsModule],
            providers: [
                { provide: ProductsStore, useValue: store },
                { provide: ProductsService, useValue: service },
                { provide: Functions, useValue: {} },
                { provide: Router, useValue: { navigate: vi.fn() } },
                { provide: ActivatedRoute, useValue: { snapshot: { params: {} }, params: of({}), queryParams: of({}) } },
            ],
        })
            .overrideComponent(ProductsPageComponent, {
                remove: { imports: [PageHeaderComponent, RowActionsComponent] },
                add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] },
            })
            .compileComponents();
        const fixture = TestBed.createComponent(ProductsPageComponent);
        page = fixture.componentInstance;
        fixture.detectChanges();
        await fixture.whenStable();
        await new Promise((resolve) => setTimeout(resolve));
        TestBed.tick();
    }

    it('saves the product and its codes together, never the codes on the product', async () => {
        await setUp([]);
        page.openCreate();
        page.form.patchValue({ name: 'Gold', dodoProductId: 'prod_gold', premiumType: 'gold', tierRank: 1 });
        page.addTier();
        page.tiers.at(0).patchValue({ label: 'Early', maxCount: 10, discountCode: ' EARLY ' });
        await page.save();

        expect(service.saveWithCodes).toHaveBeenCalledTimes(1);
        const [id, isNew, saved, codes] = service.saveWithCodes.mock.calls[0] as any[];
        expect([id, isNew, codes]).toEqual(['new1', true, ['EARLY']]);
        expect(saved.tiers[0]).not.toHaveProperty('discountCode');
        expect(store.add).not.toHaveBeenCalled();
    });

    // A save that failed used to have created the product already, so saving again made a second one.
    it('saves a new product again under the same id after a failed save', async () => {
        await setUp([]);
        service.saveWithCodes.mockRejectedValueOnce(new Error('offline'));
        page.openCreate();
        page.form.patchValue({ name: 'Gold', dodoProductId: 'prod_gold', premiumType: 'gold', tierRank: 1 });
        await page.save();
        await page.save();

        const ids = service.saveWithCodes.mock.calls.map((call: any[]) => call[0]);
        expect(ids).toEqual(['new1', 'new1']);
        expect(page.showForm()).toBe(false);
    });

    it('saves an edited product with its codes in the same write', async () => {
        await setUp([], { p1: ['EARLY'] });
        page.editProduct({ ...legacyProduct, tiers: [{ label: 'Early', maxCount: 10, discountPct: 50 }] } as any);
        expect(page.tiers.at(0).get('discountCode')?.value).toBe('EARLY');
        await page.save();

        const [id, isNew, saved, codes] = service.saveWithCodes.mock.calls[0] as any[];
        expect([id, isNew, codes]).toEqual(['p1', false, ['EARLY']]);
        expect(saved.tiers[0]).not.toHaveProperty('discountCode');
        expect(store.update).not.toHaveBeenCalled();
    });

    it('keeps the form open, with nothing saved, when the write fails', async () => {
        await setUp([]);
        service.saveWithCodes.mockRejectedValue(new Error('denied'));
        page.editProduct({ ...legacyProduct } as any);
        await page.save();

        expect(page.showForm()).toBe(true);
        expect(store.update).not.toHaveBeenCalled();
    });

    it('moves codes older versions left on products on the server, then reads the codes', async () => {
        await setUp([legacyProduct], { p1: ['EARLY'] });
        expect(service.moveLegacyCodes).toHaveBeenCalledTimes(1);
        expect(service.moveLegacyCodes.mock.invocationCallOrder[0]).toBeLessThan(service.loadCodes.mock.invocationCallOrder[0]);
        expect(page.codes()).toEqual({ p1: ['EARLY'] });
    });

    it('still reads the codes when the move fails', async () => {
        service = productsService();
        await setUp([legacyProduct], { p1: ['EARLY'] }, (s) => s.moveLegacyCodes.mockRejectedValue(new Error('offline')));
        expect(page.codes()).toEqual({ p1: ['EARLY'] });
    });
});

describe('ProductsPageComponent delete (RF4, 4.10)', () => {
    let page: ProductsPageComponent;
    let service: ReturnType<typeof productsService>;
    const store = {
        getAll: vi.fn(), isLoading: signal(false), items: signal<any[]>([]), error: signal(''),
        delete: vi.fn(() => of(undefined)),
    };
    const confirmDialog = { ask: vi.fn(async () => true) };
    const product = { id: 'p1', name: 'Gold <b>plan</b>' } as any;

    beforeEach(async () => {
        vi.clearAllMocks();
        service = productsService();
        await TestBed.configureTestingModule({
            imports: [ProductsPageComponent, NoopAnimationsModule],
            providers: [
                { provide: ProductsStore, useValue: store },
                { provide: ProductsService, useValue: service },
                { provide: ConfirmService, useValue: confirmDialog },
                { provide: Functions, useValue: {} },
                { provide: Router, useValue: { navigate: vi.fn() } },
                { provide: ActivatedRoute, useValue: { snapshot: { params: {} }, params: of({}), queryParams: of({}) } },
            ],
        })
            .overrideComponent(ProductsPageComponent, {
                remove: { imports: [PageHeaderComponent, RowActionsComponent] },
                add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] },
            })
            .compileComponents();
        page = TestBed.createComponent(ProductsPageComponent).componentInstance;
    });

    it('asks with the dialog, never the browser confirm(), naming the product safely', async () => {
        const nativeConfirm = vi.spyOn(window, 'confirm');
        confirmDialog.ask.mockResolvedValueOnce(false);
        await page.remove(product);
        expect(store.delete).not.toHaveBeenCalled();

        await page.remove(product);
        expect(store.delete).toHaveBeenCalledWith('p1');
        expect(service.deleteCodes).toHaveBeenCalledWith('p1');
        expect(nativeConfirm).not.toHaveBeenCalled();
        const asked = (confirmDialog.ask.mock.calls[0] as any[])[0];
        expect(asked.panelType).toBe('warn');
        expect(asked.dialogMessage).toContain('Gold &lt;b&gt;plan&lt;/b&gt;');
        expect(asked.dialogMessage).toContain('and its codes');
        nativeConfirm.mockRestore();
    });
});

describe('ProductsPageComponent load error and names (RF5)', () => {
    let fixture: ComponentFixture<ProductsPageComponent>;
    const store = { getAll: vi.fn(), isLoading: signal(false), items: signal<any[]>([]), error: signal('') };

    beforeEach(async () => {
        vi.clearAllMocks();
        store.items.set([]);
        store.error.set('');
        await TestBed.configureTestingModule({
            imports: [ProductsPageComponent, NoopAnimationsModule],
            providers: [
                { provide: ProductsStore, useValue: store },
                { provide: ProductsService, useValue: productsService() },
                { provide: Functions, useValue: {} },
                { provide: Router, useValue: { navigate: vi.fn() } },
                { provide: ActivatedRoute, useValue: { snapshot: { params: {} }, params: of({}), queryParams: of({}) } },
            ],
        })
            .overrideComponent(ProductsPageComponent, {
                remove: { imports: [PageHeaderComponent, RowActionsComponent] },
                add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] },
            })
            .compileComponents();
        fixture = TestBed.createComponent(ProductsPageComponent);
        fixture.detectChanges();
    });

    it('a read that fails says so in plain words, with Retry, not "no products"', () => {
        store.error.set('FirebaseError: Missing or insufficient permissions.');
        fixture.detectChanges();
        const root = fixture.nativeElement as HTMLElement;
        const alert = root.querySelector('.alert-danger')!;
        expect(alert.getAttribute('role')).toBe('alert');
        expect(alert.textContent).toContain('This list did not load');
        expect(root.textContent).not.toContain('FirebaseError');
        expect(root.textContent).not.toContain('No products yet.');
        store.getAll.mockClear();
        (alert.querySelector('button') as HTMLButtonElement).click();
        expect(store.getAll).toHaveBeenCalled();
    });

    it('names its icon-only buttons and shows the type in words', () => {
        store.items.set([{ id: 'p1', name: 'Gold', active: true, type: 'one_time', premiumType: 'gold', tierRank: 1, tiers: [] }]);
        fixture.detectChanges();
        const root = fixture.nativeElement as HTMLElement;
        expect(root.querySelector('tbody')!.textContent).toContain('One-time');
        expect(root.querySelector('tbody')!.textContent).not.toContain('one_time');
        const page = fixture.componentInstance;
        page.openCreate();
        page.addTier();
        fixture.detectChanges();
        const remove = root.querySelector('.tier-row button[color="warn"]')!;
        expect(remove.getAttribute('aria-label')).toBe('Delete tier 1');
        for (const button of Array.from(root.querySelectorAll('button[mat-icon-button]'))) {
            expect(button.getAttribute('aria-label'), button.outerHTML).toBeTruthy();
        }
    });
});
