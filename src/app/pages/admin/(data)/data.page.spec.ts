import { ComponentFixture, TestBed } from '@angular/core/testing';
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
        const categories = component.dataCategories();
        expect(categories[0].label).toBe('Export Data');
        expect(categories[1].label).toBe('Import Data');
        expect(categories[2].label).toBe('Export Files');
        expect(categories[3].label).toBe('Import Files');
    });

    it('should have correct routes for all categories', () => {
        const categories = component.dataCategories();
        expect(categories[0].route).toBe('/admin/data/export-data');
        expect(categories[1].route).toBe('/admin/data/import-data');
        expect(categories[2].route).toBe('/admin/data/export-files');
        expect(categories[3].route).toBe('/admin/data/import-files');
    });
});
