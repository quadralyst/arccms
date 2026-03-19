import { ComponentFixture, TestBed } from '@angular/core/testing';
import UsersDashboardComponent from './dashboard.page';
import { GlobalService } from '../../../../shared/services/global.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer } from '@angular/platform-browser';
import { of } from 'rxjs';
import { signal } from '@angular/core';
import { vi, describe, beforeEach, it, expect } from 'vitest';

describe('UsersDashboardComponent', () => {
    let component: UsersDashboardComponent;
    let fixture: ComponentFixture<UsersDashboardComponent>;

    const mockGlobal = {
        debugMode: signal(false)
    };
    const mockToast = {};
    const mockLocation = {};
    const mockRouter = { navigate: vi.fn() };
    const mockParamMap = {
        get: vi.fn(),
        keys: []
    };
    const mockRoute = { paramMap: of(mockParamMap) };
    const mockSanitizer = {};

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [UsersDashboardComponent],
            providers: [
                { provide: GlobalService, useValue: mockGlobal },
                { provide: ToastService, useValue: mockToast },
                { provide: Location, useValue: mockLocation },
                { provide: Router, useValue: mockRouter },
                { provide: ActivatedRoute, useValue: mockRoute },
                { provide: DomSanitizer, useValue: mockSanitizer }
            ]
        }).compileComponents();

        fixture = TestBed.createComponent(UsersDashboardComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });
});
