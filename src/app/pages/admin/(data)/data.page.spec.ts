import { ComponentFixture, TestBed } from '@angular/core/testing';
import { headerTestProviders } from '../../../../test/header-test-providers';
import { describe, it, expect, beforeEach } from 'vitest';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import DataPageComponent from './data.page';
import { Firestore } from '@angular/fire/firestore';

describe('DataPageComponent', () => {
    let component: DataPageComponent;
    let fixture: ComponentFixture<DataPageComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [
                DataPageComponent,
                NoopAnimationsModule,
            ],
            providers: [
                ...headerTestProviders(),
                provideRouter([]),
                { provide: Firestore, useValue: {} },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(DataPageComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should have four data categories', () => {
        expect(component.dataCategories().length).toBe(4);
    });

        it('should have correct category labels', () => {
        // Labels hold translation keys; the template resolves them with
        // `| translatable`, the same contract as a table column header.
        const categories = component.dataCategories();
        expect(categories[0].label).toBe('admin.nav.export_data');
        expect(categories[1].label).toBe('admin.nav.import_data');
        expect(categories[2].label).toBe('admin.nav.export_files');
        expect(categories[3].label).toBe('admin.nav.import_files');
    });

    it('should have correct routes for all categories', () => {
        const categories = component.dataCategories();
        expect(categories[0].route).toBe('/admin/data/export-data');
        expect(categories[1].route).toBe('/admin/data/import-data');
        expect(categories[2].route).toBe('/admin/data/export-files');
        expect(categories[3].route).toBe('/admin/data/import-files');
    });
});
