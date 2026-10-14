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
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { RowActionsComponent } from '../../../../shared/components/row-actions/row-actions.component';

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
                { provide: ProductsStore, useValue: { getAll: vi.fn(), isLoading: signal(false), items: signal([]) } },
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
