import { Location } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';
import { AbstractControl, FormGroup, ValidatorFn } from '@angular/forms';
import { environment } from '../../environments/environment';

@Injectable({
    providedIn: 'root',
})
export class GlobalService {
    location = inject(Location);

    // Debug mode - enabled in non-production environments
    debugMode = signal(!environment.production);

    /**
     * Converts camelCase or snake_case to a human-readable string
     */
    convertToNormalString(inputString = ''): string {
        if (!inputString) {
            return '';
        }

        // Convert camel case to spaces
        let normalString = inputString.replace(/([A-Z])/g, ' $1');

        // Convert snake case to spaces
        normalString = normalString.replace(/_/g, ' ');

        // Convert the entire string to lowercase
        normalString = normalString.toLowerCase();

        // Capitalize the first letter of the first word
        normalString = normalString.charAt(0).toUpperCase() + normalString.slice(1);

        return normalString;
    }

    /**
     * Email validator for reactive forms
     */
    public emailValidator(): ValidatorFn {
        return (control: AbstractControl): { [key: string]: any } | null => {
            const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
            const valid = emailRegex.test(control.value);
            return valid ? null : { 'Invalid Email': true };
        };
    }

    /**
     * Converts a Firestore timestamp or Date to a formatted string
     */
    convertMillisecondsToFormatDate(date: any, format: string = 'yyyy-MM-dd HH:mm:ss'): string | null {
        if (!date) {
            return this.formatDate(new Date(), format);
        }

        if (date && (date.seconds || date.nanoseconds)) {
            // Convert Firestore Timestamp to JavaScript Date
            const milliseconds = date.seconds * 1000 + Math.floor((date.nanoseconds || 0) / 1000000);
            const dateObject = new Date(milliseconds);
            return this.formatDate(dateObject, format);
        }

        // Fallback for standard JavaScript Date objects
        return this.formatDate(new Date(date), format);
    }

    /**
     * Simple date formatter
     */
    private formatDate(date: Date, format: string): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');

        // Month abbreviations
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
            'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const monthAbbr = monthNames[date.getMonth()];

        return format
            .replace('yyyy', String(year))
            .replace('MMM', monthAbbr)
            .replace('MM', month)
            .replace('dd', day)
            .replace('HH', hours)
            .replace('mm', minutes)
            .replace('ss', seconds);
    }

    /**
     * Get the day suffix (st, nd, rd, th)
     */
    getDaySuffix(day: number): string {
        if (day >= 11 && day <= 13) {
            return 'th';
        }
        switch (day % 10) {
            case 1:
                return 'st';
            case 2:
                return 'nd';
            case 3:
                return 'rd';
            default:
                return 'th';
        }
    }

    /**
     * Convert a label to camelCase
     */
    convertToCamelCase(label: string): string {
        return label
            .replace(/(?:^\w|[A-Z]|\b\w|\s+|\_|\-)/g, (match, index) =>
                index === 0 ? match.toLowerCase() : match.toUpperCase(),
            )
            .replace(/\s+/g, '');
    }

    /**
     * Join array items with comma separator
     */
    arrayCommaSeparator(item: any, fieldName?: string): string {
        if (item && item.length) {
            return fieldName ? item.map((sub: any) => sub[fieldName]).join(', ') : '';
        } else {
            return '';
        }
    }

    /**
     * Convert hex color to ARGB format
     */
    convertHexToArgb(hex: string): string {
        hex = hex.replace(/^#/, '');

        if (hex.length === 3) {
            hex = hex
                .split('')
                .map((c) => c + c)
                .join('');
        }

        if (hex.length !== 6) {
            console.warn('Invalid hex color:', hex);
            return 'FFFFFFFF';
        }

        return `FF${hex.toUpperCase()}`;
    }

    /**
     * Navigate back
     */
    public goBack(): void {
        this.location.back();
    }

    /**
     * Get invalid form controls
     */
    public getInvalidControls(form: FormGroup): string[] {
        const invalidControls: string[] = [];
        Object.keys(form.controls).forEach((key) => {
            const control = form.get(key);
            if (control?.invalid) {
                invalidControls.push(key);
            }
        });
        return invalidControls;
    }

    /**
     * Get current year
     */
    showCurrentYear(): number {
        return new Date().getFullYear();
    }

    /**
     * Convert timestamp to "time ago" string
     */
    timeAgo(seconds: any): string {
        const now = new Date();
        const pastDate = new Date(seconds * 1000);

        const diffInMilliseconds = now.getTime() - pastDate.getTime();
        const diffInSeconds = Math.floor(diffInMilliseconds / 1000);
        const diffInMinutes = Math.floor(diffInSeconds / 60);
        const diffInHours = Math.floor(diffInMinutes / 60);
        const diffInDays = Math.floor(diffInHours / 24);

        if (diffInDays > 0) {
            return `${diffInDays} day${diffInDays > 1 ? 's' : ''} ago`;
        } else if (diffInHours > 0) {
            return `${diffInHours} hour${diffInHours > 1 ? 's' : ''} ago`;
        } else if (diffInMinutes > 0) {
            return `${diffInMinutes} minute${diffInMinutes > 1 ? 's' : ''} ago`;
        } else {
            return 'just now';
        }
    }

    /**
     * Copy text to clipboard
     * Returns a promise that resolves to true on success, false on failure
     */
    async copyToClipboard(text: string): Promise<boolean> {
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
            try {
                await navigator.clipboard.writeText(text);
                return true;
            } catch {
                return false;
            }
        }
        return false;
    }
}
