import { Injectable, signal, WritableSignal } from '@angular/core';

export interface SequenceToast {
    id: number;
    message: string;
    type: 'success' | 'error' | 'warning' | 'info';
    duration: number;
    icon?: string;
}

export interface ToastData {
    message: string;
    type: 'success' | 'error' | 'warning' | 'info';
    icon?: string;
}

/**
 * Toast Service (Simplified Version)
 * 
 * This is a simplified toast service that uses console and DOM-based notifications.
 * When Angular Material is added (Step 12+), this will be upgraded to use MatSnackBar.
 */
@Injectable({
    providedIn: 'root',
})
export class ToastService {
    // Sequence toasts management
    sequenceToasts: WritableSignal<SequenceToast[]> = signal([]);

    private toastContainer: HTMLElement | null = null;
    private toastIdCounter = 0;

    constructor() {
        this.createToastContainer();
    }

    private createToastContainer(): void {
        if (typeof document === 'undefined') return; // SSR guard

        this.toastContainer = document.getElementById('toast-container');
        if (!this.toastContainer) {
            this.toastContainer = document.createElement('div');
            this.toastContainer.id = 'toast-container';
            this.toastContainer.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 1000001;
        display: flex;
        flex-direction: column;
        gap: 10px;
        max-width: 400px;
      `;
            document.body.appendChild(this.toastContainer);
        }
    }

    showToastMsg(msg: string, actionType: string = 'OK', color: string = 'info'): void {
        this.showToast(msg, color as 'success' | 'error' | 'warning' | 'info');
    }

    openCustomSnackbar(
        message: string,
        type: 'success' | 'error' | 'warning' | 'info',
        icon: string,
        position: 'top' | 'bottom' = 'top',
    ): void {
        this.showToast(message, type, 5000);
    }

    private showToast(
        message: string,
        type: 'success' | 'error' | 'warning' | 'info',
        duration: number = 5000
    ): void {
        if (typeof document === 'undefined' || !this.toastContainer) return; // SSR guard

        const toastId = ++this.toastIdCounter;
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.setAttribute('data-id', toastId.toString());

        const colors = {
            success: { bg: '#d4edda', border: '#28a745', text: '#155724', icon: '✓' },
            error: { bg: '#f8d7da', border: '#dc3545', text: '#721c24', icon: '✕' },
            warning: { bg: '#fff3cd', border: '#ffc107', text: '#856404', icon: '⚠' },
            info: { bg: '#d1ecf1', border: '#17a2b8', text: '#0c5460', icon: 'ℹ' },
        };

        const style = colors[type];

        toast.style.cssText = `
      padding: 12px 16px;
      background: ${style.bg};
      border-left: 4px solid ${style.border};
      color: ${style.text};
      border-radius: 4px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      display: flex;
      align-items: center;
      gap: 10px;
      animation: slideIn 0.3s ease-out;
      font-family: system-ui, -apple-system, sans-serif;
    `;

        toast.innerHTML = `
      <span style="font-size: 1.2em;">${style.icon}</span>
      <span style="flex: 1;">${message}</span>
      <button style="background: none; border: none; cursor: pointer; font-size: 1.2em; opacity: 0.7;" onclick="this.parentElement.remove()">×</button>
    `;

        this.toastContainer.appendChild(toast);

        // Auto-remove after duration
        setTimeout(() => {
            if (toast.parentElement) {
                toast.style.animation = 'slideOut 0.3s ease-in forwards';
                setTimeout(() => toast.remove(), 300);
            }
        }, duration);
    }

    removeSequenceToast(id: number): void {
        this.sequenceToasts.update((currentToasts) => currentToasts.filter((t) => t.id !== id));
    }

    showSequentialToasts(toasts: ToastData[], delayBetween: number = 3000): void {
        toasts.forEach((toast, index) => {
            const delay = index * delayBetween;
            setTimeout(() => {
                this.showToast(toast.message, toast.type, 3000);
            }, delay);
        });
    }

    openSequenceCustomSnackbar(
        message: string,
        type: 'success' | 'error' | 'warning' | 'info',
        icon?: string,
        position: 'top' | 'bottom' = 'top',
    ): void {
        this.showToast(message, type, 3000);
    }

    clearAllSequenceToasts(): void {
        this.sequenceToasts.set([]);
    }

    // Convenience methods
    success(message: string): void {
        this.showToast(message, 'success');
    }

    error(message: string): void {
        this.showToast(message, 'error');
    }

    warning(message: string): void {
        this.showToast(message, 'warning');
    }

    info(message: string): void {
        this.showToast(message, 'info');
    }
}
