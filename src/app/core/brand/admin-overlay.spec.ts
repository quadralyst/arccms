/**
 * The dialog layer takes the admin's colours only while the admin or the wizard is open
 * (specs/admin-brand-spec.md AB-D4): the website's and sign-in page's dialogs keep theirs.
 */
import { describe, it, expect } from 'vitest';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { OverlayContainer } from '@angular/cdk/overlay';
import { ADMIN_OVERLAY_CLASS, useAdminOverlay } from './admin-overlay';

@Component({ selector: 'arc-test-admin', template: '' })
class AdminLike {
    constructor() {
        useAdminOverlay();
    }
}

describe('useAdminOverlay', () => {
    it('marks the dialog layer while the page is open, and unmarks it when it closes', () => {
        const container = TestBed.inject(OverlayContainer).getContainerElement();
        expect(container.classList.contains(ADMIN_OVERLAY_CLASS)).toBe(false);
        const fixture = TestBed.createComponent(AdminLike);
        expect(container.classList.contains(ADMIN_OVERLAY_CLASS)).toBe(true);
        fixture.destroy();
        expect(container.classList.contains(ADMIN_OVERLAY_CLASS)).toBe(false);
    });
});
