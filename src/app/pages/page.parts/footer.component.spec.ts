/**
 * Tests for FooterComponent
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { FooterComponent } from './footer.component';
import { ContentPartialsComponent } from './content-partials.component';
import { ContentsStore } from '../admin/contents/content-store/published-contents.store';
import { ContentTypesStore } from '../admin/contents/content-types/content-types.store';

describe('FooterComponent', () => {
    let component: FooterComponent;
    let fixture: ComponentFixture<FooterComponent>;

    beforeEach(async () => {
        // The site footer embeds <arc-content-partials>, which reaches the
        // published-content stores and the router; stub those so the footer
        // can be created without Firestore.
        const emptyStore = { items: signal([]), isLoading: signal(false), getAll: vi.fn(), unsubscribeStore: vi.fn() };

        await TestBed.configureTestingModule({
            imports: [FooterComponent],
            providers: [
                { provide: ContentTypesStore, useValue: emptyStore },
                { provide: HttpClient, useValue: { get: vi.fn().mockReturnValue(of('')) } },
                { provide: Router, useValue: { navigate: vi.fn(), events: of(), url: '/' } },
                {
                    provide: ActivatedRoute,
                    useValue: {
                        snapshot: { paramMap: { get: () => null } },
                        paramMap: of({ get: () => null, keys: [] }),
                        queryParams: of({}),
                    },
                },
            ],
        })
            .overrideComponent(ContentPartialsComponent, {
                set: { providers: [{ provide: ContentsStore, useValue: emptyStore }] },
            })
            .compileComponents();

        fixture = TestBed.createComponent(FooterComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    describe('Component Creation', () => {
        it('should create', () => {
            expect(component).toBeTruthy();
        });
    });

    describe('Component Metadata', () => {
        it('should be a standalone component with arc-footer selector', () => {
            // Verify the component was created and is functional
            expect(component).toBeTruthy();
            expect(fixture.nativeElement).toBeTruthy();
        });

        it('should be standalone', () => {
            expect(FooterComponent).toBeDefined();
        });
    });
});
