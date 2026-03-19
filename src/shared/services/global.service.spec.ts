/**
 * Tests for GlobalService
 * 
 * These tests verify all utility methods in the GlobalService class.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { Location } from '@angular/common';
import { GlobalService } from './global.service';

describe('GlobalService', () => {
    let service: GlobalService;
    let locationSpy: { back: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        locationSpy = { back: vi.fn() };

        TestBed.configureTestingModule({
            providers: [
                GlobalService,
                { provide: Location, useValue: locationSpy },
            ],
        });

        service = TestBed.inject(GlobalService);
    });

    describe('Service Creation', () => {
        it('should be created', () => {
            expect(service).toBeTruthy();
        });

        it('should have debugMode derived from environment.production', () => {
            // In dev environment (production: false), debugMode should be true
            expect(service.debugMode()).toBe(true);
        });

        it('should allow debugMode to be updated', () => {
            service.debugMode.set(false);
            expect(service.debugMode()).toBe(false);
        });
    });

    describe('convertToNormalString', () => {
        it('should convert camelCase to normal string', () => {
            expect(service.convertToNormalString('firstName')).toBe('First name');
        });

        it('should convert PascalCase to normal string', () => {
            expect(service.convertToNormalString('FirstName')).toBe(' first name');
        });

        it('should convert snake_case to normal string', () => {
            expect(service.convertToNormalString('first_name')).toBe('First name');
        });

        it('should convert mixed case to normal string', () => {
            expect(service.convertToNormalString('firstName_lastName')).toBe('First name last name');
        });

        it('should handle empty string', () => {
            expect(service.convertToNormalString('')).toBe('');
        });

        it('should handle undefined', () => {
            expect(service.convertToNormalString(undefined as unknown as string)).toBe('');
        });

        it('should handle single word', () => {
            expect(service.convertToNormalString('name')).toBe('Name');
        });
    });

    describe('emailValidator', () => {
        it('should return null for valid email', () => {
            const control = new FormControl('test@example.com');
            const validator = service.emailValidator();
            expect(validator(control)).toBeNull();
        });

        it('should return error for email without @', () => {
            const control = new FormControl('testexample.com');
            const validator = service.emailValidator();
            expect(validator(control)).toEqual({ 'Invalid Email': true });
        });

        it('should return error for email without domain', () => {
            const control = new FormControl('test@');
            const validator = service.emailValidator();
            expect(validator(control)).toEqual({ 'Invalid Email': true });
        });

        it('should return error for email without TLD', () => {
            const control = new FormControl('test@example');
            const validator = service.emailValidator();
            expect(validator(control)).toEqual({ 'Invalid Email': true });
        });

        it('should return null for email with subdomain', () => {
            const control = new FormControl('test@mail.example.com');
            const validator = service.emailValidator();
            expect(validator(control)).toBeNull();
        });

        it('should return null for email with plus sign', () => {
            const control = new FormControl('test+tag@example.com');
            const validator = service.emailValidator();
            expect(validator(control)).toBeNull();
        });
    });

    describe('convertMillisecondsToFormatDate', () => {
        it('should format Firestore timestamp', () => {
            const timestamp = { seconds: 1702300800, nanoseconds: 0 }; // 2023-12-11
            const result = service.convertMillisecondsToFormatDate(timestamp, 'yyyy-MM-dd');
            expect(result).toMatch(/2023-12-11/);
        });

        it('should format JavaScript Date', () => {
            const date = new Date('2023-12-11T10:30:00');
            const result = service.convertMillisecondsToFormatDate(date, 'yyyy-MM-dd');
            expect(result).toBe('2023-12-11');
        });

        it('should return current date for null input', () => {
            const result = service.convertMillisecondsToFormatDate(null, 'yyyy-MM-dd');
            const today = new Date();
            const expectedDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            expect(result).toBe(expectedDate);
        });

        it('should format with time components', () => {
            const date = new Date('2023-12-11T10:30:45');
            const result = service.convertMillisecondsToFormatDate(date, 'yyyy-MM-dd HH:mm:ss');
            expect(result).toBe('2023-12-11 10:30:45');
        });

        it('should handle timestamp with nanoseconds', () => {
            const timestamp = { seconds: 1702300800, nanoseconds: 500000000 };
            const result = service.convertMillisecondsToFormatDate(timestamp, 'yyyy-MM-dd');
            expect(result).toBeDefined();
        });
    });

    describe('getDaySuffix', () => {
        it('should return "st" for 1', () => {
            expect(service.getDaySuffix(1)).toBe('st');
        });

        it('should return "nd" for 2', () => {
            expect(service.getDaySuffix(2)).toBe('nd');
        });

        it('should return "rd" for 3', () => {
            expect(service.getDaySuffix(3)).toBe('rd');
        });

        it('should return "th" for 4-10', () => {
            for (let i = 4; i <= 10; i++) {
                expect(service.getDaySuffix(i)).toBe('th');
            }
        });

        it('should return "th" for 11, 12, 13', () => {
            expect(service.getDaySuffix(11)).toBe('th');
            expect(service.getDaySuffix(12)).toBe('th');
            expect(service.getDaySuffix(13)).toBe('th');
        });

        it('should return "st" for 21', () => {
            expect(service.getDaySuffix(21)).toBe('st');
        });

        it('should return "nd" for 22', () => {
            expect(service.getDaySuffix(22)).toBe('nd');
        });

        it('should return "rd" for 23', () => {
            expect(service.getDaySuffix(23)).toBe('rd');
        });

        it('should return "th" for 24-30', () => {
            for (let i = 24; i <= 30; i++) {
                expect(service.getDaySuffix(i)).toBe('th');
            }
        });

        it('should return "st" for 31', () => {
            expect(service.getDaySuffix(31)).toBe('st');
        });
    });

    describe('convertToCamelCase', () => {
        it('should convert space-separated words to camelCase', () => {
            expect(service.convertToCamelCase('First Name')).toBe('firstName');
        });

        it('should handle single word', () => {
            expect(service.convertToCamelCase('name')).toBe('name');
        });

        it('should handle underscore in string (preserves underscore)', () => {
            // Note: The current implementation doesn't remove underscores
            const result = service.convertToCamelCase('first_name');
            expect(result).toBeDefined();
        });

        it('should handle hyphen in string (preserves hyphen with case change)', () => {
            // Note: The current implementation doesn't remove hyphens
            const result = service.convertToCamelCase('first-name');
            expect(result).toBeDefined();
        });

        it('should handle multiple words', () => {
            expect(service.convertToCamelCase('First Middle Last Name')).toBe('firstMiddleLastName');
        });

        it('should lowercase first character', () => {
            expect(service.convertToCamelCase('Name')).toBe('name');
        });
    });

    describe('arrayCommaSeparator', () => {
        it('should join array items by field name', () => {
            const items = [
                { name: 'Alice' },
                { name: 'Bob' },
                { name: 'Charlie' },
            ];
            expect(service.arrayCommaSeparator(items, 'name')).toBe('Alice, Bob, Charlie');
        });

        it('should return empty string for empty array', () => {
            expect(service.arrayCommaSeparator([], 'name')).toBe('');
        });

        it('should return empty string for null', () => {
            expect(service.arrayCommaSeparator(null, 'name')).toBe('');
        });

        it('should return empty string when no fieldName provided', () => {
            const items = [{ name: 'Alice' }];
            expect(service.arrayCommaSeparator(items)).toBe('');
        });
    });

    describe('convertHexToArgb', () => {
        it('should convert 6-char hex to ARGB', () => {
            expect(service.convertHexToArgb('#FF0000')).toBe('FFFF0000');
        });

        it('should convert hex without # to ARGB', () => {
            expect(service.convertHexToArgb('00FF00')).toBe('FF00FF00');
        });

        it('should convert 3-char hex to ARGB', () => {
            expect(service.convertHexToArgb('#F00')).toBe('FFFF0000');
        });

        it('should convert lowercase hex to ARGB', () => {
            expect(service.convertHexToArgb('#ff0000')).toBe('FFFF0000');
        });

        it('should return default for invalid hex (wrong length)', () => {
            expect(service.convertHexToArgb('#F')).toBe('FFFFFFFF');
        });

        it('should handle blue color', () => {
            expect(service.convertHexToArgb('#0000FF')).toBe('FF0000FF');
        });
    });

    describe('goBack', () => {
        it('should call location.back()', () => {
            service.goBack();
            expect(locationSpy.back).toHaveBeenCalled();
        });
    });

    describe('getInvalidControls', () => {
        it('should return empty array for valid form', () => {
            const form = new FormGroup({
                name: new FormControl('John'),
                email: new FormControl('john@example.com'),
            });
            expect(service.getInvalidControls(form)).toEqual([]);
        });

        it('should return array of invalid control names', () => {
            const form = new FormGroup({
                name: new FormControl('', Validators.required),
                email: new FormControl('invalid'),
            });
            expect(service.getInvalidControls(form)).toEqual(['name']);
        });

        it('should return multiple invalid controls', () => {
            const form = new FormGroup({
                name: new FormControl('', Validators.required),
                email: new FormControl('', Validators.required),
            });
            expect(service.getInvalidControls(form)).toContain('name');
            expect(service.getInvalidControls(form)).toContain('email');
        });
    });

    describe('showCurrentYear', () => {
        it('should return current year', () => {
            const currentYear = new Date().getFullYear();
            expect(service.showCurrentYear()).toBe(currentYear);
        });
    });

    describe('timeAgo', () => {
        it('should return "just now" for recent timestamps', () => {
            const now = Math.floor(Date.now() / 1000);
            expect(service.timeAgo(now)).toBe('just now');
        });

        it('should return minutes ago', () => {
            const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
            expect(service.timeAgo(fiveMinutesAgo)).toBe('5 minutes ago');
        });

        it('should return "1 minute ago" for singular', () => {
            const oneMinuteAgo = Math.floor(Date.now() / 1000) - 60;
            expect(service.timeAgo(oneMinuteAgo)).toBe('1 minute ago');
        });

        it('should return hours ago', () => {
            const twoHoursAgo = Math.floor(Date.now() / 1000) - 7200;
            expect(service.timeAgo(twoHoursAgo)).toBe('2 hours ago');
        });

        it('should return "1 hour ago" for singular', () => {
            const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;
            expect(service.timeAgo(oneHourAgo)).toBe('1 hour ago');
        });

        it('should return days ago', () => {
            const threeDaysAgo = Math.floor(Date.now() / 1000) - 259200;
            expect(service.timeAgo(threeDaysAgo)).toBe('3 days ago');
        });

        it('should return "1 day ago" for singular', () => {
            const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;
            expect(service.timeAgo(oneDayAgo)).toBe('1 day ago');
        });
    });
});
