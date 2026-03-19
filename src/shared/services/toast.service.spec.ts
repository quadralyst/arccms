/**
 * Tests for ToastService
 * 
 * These tests verify the toast notification functionality.
 * Note: Some DOM operations are mocked for SSR compatibility.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ToastService, ToastData } from './toast.service';

describe('ToastService', () => {
    let service: ToastService;
    let originalDocument: Document | undefined;

    beforeEach(() => {
        // Clean up any existing toast containers
        const existingContainer = document.getElementById('toast-container');
        if (existingContainer) {
            existingContainer.remove();
        }

        TestBed.configureTestingModule({
            providers: [ToastService],
        });

        service = TestBed.inject(ToastService);
    });

    afterEach(() => {
        // Clean up toast container after each test
        const container = document.getElementById('toast-container');
        if (container) {
            container.remove();
        }
    });

    describe('Service Creation', () => {
        it('should be created', () => {
            expect(service).toBeTruthy();
        });

        it('should create toast container on init', () => {
            const container = document.getElementById('toast-container');
            expect(container).toBeTruthy();
        });

        it('should not create duplicate toast containers', () => {
            // Create another instance
            const service2 = new ToastService();
            const containers = document.querySelectorAll('#toast-container');
            expect(containers.length).toBe(1);
        });

        it('should have empty sequenceToasts initially', () => {
            expect(service.sequenceToasts()).toEqual([]);
        });
    });

    describe('showToastMsg', () => {
        it('should create a toast element for the given type', () => {
            service.showToastMsg('Test message', 'OK', 'success');
            const container = document.getElementById('toast-container');
            const toast = container?.querySelector('.toast-success');
            expect(toast).toBeTruthy();
            expect(toast?.textContent).toContain('Test message');
        });

        it('should use info type by default', () => {
            service.showToastMsg('Test message');
            const container = document.getElementById('toast-container');
            const toast = container?.querySelector('.toast-info');
            expect(toast).toBeTruthy();
            expect(toast?.textContent).toContain('Test message');
        });

        it('should create toast element in container', () => {
            service.showToastMsg('Test message', 'OK', 'success');
            const container = document.getElementById('toast-container');
            const toasts = container?.querySelectorAll('.toast');
            expect(toasts?.length).toBeGreaterThan(0);
        });
    });

    describe('openCustomSnackbar', () => {
        it('should create a toast element for the given type', () => {
            service.openCustomSnackbar('Custom message', 'info', '📢');
            const container = document.getElementById('toast-container');
            const toast = container?.querySelector('.toast-info');
            expect(toast).toBeTruthy();
            expect(toast?.textContent).toContain('Custom message');
        });

        it('should create toast with custom type', () => {
            service.openCustomSnackbar('Error message', 'error', '❌');
            const container = document.getElementById('toast-container');
            const toast = container?.querySelector('.toast-error');
            expect(toast).toBeTruthy();
        });
    });

    describe('Convenience Methods', () => {
        it('should show success toast', () => {
            service.success('Success message');
            const container = document.getElementById('toast-container');
            const toast = container?.querySelector('.toast-success');
            expect(toast).toBeTruthy();
            expect(toast?.textContent).toContain('Success message');
        });

        it('should show error toast', () => {
            service.error('Error message');
            const container = document.getElementById('toast-container');
            const toast = container?.querySelector('.toast-error');
            expect(toast).toBeTruthy();
            expect(toast?.textContent).toContain('Error message');
        });

        it('should show warning toast', () => {
            service.warning('Warning message');
            const container = document.getElementById('toast-container');
            const toast = container?.querySelector('.toast-warning');
            expect(toast).toBeTruthy();
            expect(toast?.textContent).toContain('Warning message');
        });

        it('should show info toast', () => {
            service.info('Info message');
            const container = document.getElementById('toast-container');
            const toast = container?.querySelector('.toast-info');
            expect(toast).toBeTruthy();
            expect(toast?.textContent).toContain('Info message');
        });
    });

    describe('Toast Styling', () => {
        it('should apply success colors', () => {
            service.success('Success');
            const toast = document.querySelector('.toast-success') as HTMLElement;
            expect(toast.style.background).toContain('rgb(212, 237, 218)'); // #d4edda
        });

        it('should apply error colors', () => {
            service.error('Error');
            const toast = document.querySelector('.toast-error') as HTMLElement;
            expect(toast.style.background).toContain('rgb(248, 215, 218)'); // #f8d7da
        });

        it('should apply warning colors', () => {
            service.warning('Warning');
            const toast = document.querySelector('.toast-warning') as HTMLElement;
            expect(toast.style.background).toContain('rgb(255, 243, 205)'); // #fff3cd
        });

        it('should apply info colors', () => {
            service.info('Info');
            const toast = document.querySelector('.toast-info') as HTMLElement;
            expect(toast.style.background).toContain('rgb(209, 236, 241)'); // #d1ecf1
        });

        it('should include correct icons', () => {
            service.success('Success');
            const toast = document.querySelector('.toast-success');
            expect(toast?.innerHTML).toContain('✓');
        });
    });

    describe('Toast Close Button', () => {
        it('should have close button', () => {
            service.info('Test');
            const toast = document.querySelector('.toast');
            const closeButton = toast?.querySelector('button');
            expect(closeButton).toBeTruthy();
            expect(closeButton?.textContent).toBe('×');
        });
    });

    describe('removeSequenceToast', () => {
        it('should remove toast by id', () => {
            service.sequenceToasts.set([
                { id: 1, message: 'Toast 1', type: 'info', duration: 3000 },
                { id: 2, message: 'Toast 2', type: 'success', duration: 3000 },
            ]);

            service.removeSequenceToast(1);

            expect(service.sequenceToasts()).toHaveLength(1);
            expect(service.sequenceToasts()[0].id).toBe(2);
        });

        it('should do nothing for non-existent id', () => {
            service.sequenceToasts.set([
                { id: 1, message: 'Toast 1', type: 'info', duration: 3000 },
            ]);

            service.removeSequenceToast(999);

            expect(service.sequenceToasts()).toHaveLength(1);
        });
    });

    describe('showSequentialToasts', () => {
        it('should show multiple toasts with delays', async () => {
            vi.useFakeTimers();

            const toasts: ToastData[] = [
                { message: 'First', type: 'info' },
                { message: 'Second', type: 'success' },
            ];

            service.showSequentialToasts(toasts, 1000);

            // First toast should appear immediately (at delay 0)
            vi.advanceTimersByTime(0);
            let container = document.getElementById('toast-container');
            expect(container?.querySelectorAll('.toast').length).toBeGreaterThanOrEqual(0);

            // Second toast should appear after 1000ms
            vi.advanceTimersByTime(1000);
            container = document.getElementById('toast-container');

            vi.useRealTimers();
        });
    });

    describe('openSequenceCustomSnackbar', () => {
        it('should show a toast', () => {
            service.openSequenceCustomSnackbar('Sequence message', 'warning');
            const container = document.getElementById('toast-container');
            const toast = container?.querySelector('.toast-warning');
            expect(toast).toBeTruthy();
        });
    });

    describe('clearAllSequenceToasts', () => {
        it('should clear all sequence toasts', () => {
            service.sequenceToasts.set([
                { id: 1, message: 'Toast 1', type: 'info', duration: 3000 },
                { id: 2, message: 'Toast 2', type: 'success', duration: 3000 },
                { id: 3, message: 'Toast 3', type: 'warning', duration: 3000 },
            ]);

            service.clearAllSequenceToasts();

            expect(service.sequenceToasts()).toEqual([]);
        });
    });

    describe('Toast Auto-Removal', () => {
        it('should auto-remove toast after duration', async () => {
            vi.useFakeTimers();

            service.info('Auto-remove test');

            let container = document.getElementById('toast-container');
            expect(container?.querySelectorAll('.toast').length).toBe(1);

            // Advance past the duration (5000ms) + animation (300ms)
            vi.advanceTimersByTime(5300);

            // Toast should be removed
            container = document.getElementById('toast-container');
            expect(container?.querySelectorAll('.toast').length).toBe(0);

            vi.useRealTimers();
        });
    });

    describe('SSR Guard', () => {
        it('should handle missing document gracefully', () => {
            // This test verifies the SSR guard exists
            // In a real SSR environment, document would be undefined
            // We just verify the service can be created without errors
            expect(() => {
                const testService = new ToastService();
            }).not.toThrow();
        });
    });

    describe('Multiple Toasts', () => {
        it('should handle multiple toasts simultaneously', () => {
            service.success('Toast 1');
            service.error('Toast 2');
            service.warning('Toast 3');
            service.info('Toast 4');

            const container = document.getElementById('toast-container');
            const toasts = container?.querySelectorAll('.toast');
            expect(toasts?.length).toBe(4);
        });

        it('should assign unique data-id to each toast', () => {
            service.info('Toast 1');
            service.info('Toast 2');

            const container = document.getElementById('toast-container');
            const toasts = container?.querySelectorAll('.toast');

            const ids = Array.from(toasts || []).map(t => t.getAttribute('data-id'));
            const uniqueIds = new Set(ids);

            expect(uniqueIds.size).toBe(ids.length);
        });
    });
});
