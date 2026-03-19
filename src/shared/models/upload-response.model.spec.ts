/**
 * Tests for Upload Response Model
 * 
 * Tests verify the upload response and task interfaces.
 */

import { describe, it, expect } from 'vitest';
import { UploadResponse, UploadTask } from './upload-response.model';

describe('Upload Response Model', () => {
    describe('UploadResponse Interface', () => {
        it('should create an object conforming to UploadResponse', () => {
            const response: UploadResponse = {
                progress: 100,
                downloadURL: 'https://storage.example.com/file.jpg',
            };

            expect(response.progress).toBe(100);
            expect(response.downloadURL).toBe('https://storage.example.com/file.jpg');
        });

        it('should have progress as number', () => {
            const response: UploadResponse = {
                progress: 50,
                downloadURL: '',
            };

            expect(typeof response.progress).toBe('number');
        });

        it('should have downloadURL as string', () => {
            const response: UploadResponse = {
                progress: 0,
                downloadURL: 'https://example.com/file.pdf',
            };

            expect(typeof response.downloadURL).toBe('string');
        });

        it('should allow progress from 0 to 100', () => {
            const start: UploadResponse = { progress: 0, downloadURL: '' };
            const middle: UploadResponse = { progress: 50, downloadURL: '' };
            const complete: UploadResponse = { progress: 100, downloadURL: 'https://example.com/file.jpg' };

            expect(start.progress).toBe(0);
            expect(middle.progress).toBe(50);
            expect(complete.progress).toBe(100);
        });
    });

    describe('UploadTask Interface', () => {
        it('should create an object conforming to UploadTask', () => {
            const mockFile = new File(['test'], 'test.txt', { type: 'text/plain' });
            const task: UploadTask = {
                file: mockFile,
                path: '/uploads/test.txt',
                progress: 0,
                status: 'pending',
            };

            expect(task.file).toBe(mockFile);
            expect(task.path).toBe('/uploads/test.txt');
            expect(task.progress).toBe(0);
            expect(task.status).toBe('pending');
        });

        it('should have all required fields', () => {
            const mockFile = new File([''], 'empty.txt');
            const task: UploadTask = {
                file: mockFile,
                path: '/uploads/empty.txt',
                progress: 0,
                status: 'pending',
            };

            expect(task).toHaveProperty('file');
            expect(task).toHaveProperty('path');
            expect(task).toHaveProperty('progress');
            expect(task).toHaveProperty('status');
        });

        it('should allow optional downloadURL', () => {
            const mockFile = new File(['test'], 'test.txt');
            const task: UploadTask = {
                file: mockFile,
                path: '/uploads/test.txt',
                progress: 100,
                downloadURL: 'https://storage.example.com/test.txt',
                status: 'complete',
            };

            expect(task.downloadURL).toBe('https://storage.example.com/test.txt');
        });

        it('should allow optional error message', () => {
            const mockFile = new File(['test'], 'test.txt');
            const task: UploadTask = {
                file: mockFile,
                path: '/uploads/test.txt',
                progress: 25,
                error: 'Upload failed: Network error',
                status: 'error',
            };

            expect(task.error).toBe('Upload failed: Network error');
        });
    });

    describe('UploadTask Status Values', () => {
        const mockFile = new File([''], 'test.txt');

        it('should accept pending status', () => {
            const task: UploadTask = {
                file: mockFile,
                path: '/uploads/test.txt',
                progress: 0,
                status: 'pending',
            };
            expect(task.status).toBe('pending');
        });

        it('should accept uploading status', () => {
            const task: UploadTask = {
                file: mockFile,
                path: '/uploads/test.txt',
                progress: 50,
                status: 'uploading',
            };
            expect(task.status).toBe('uploading');
        });

        it('should accept complete status', () => {
            const task: UploadTask = {
                file: mockFile,
                path: '/uploads/test.txt',
                progress: 100,
                downloadURL: 'https://example.com/file.txt',
                status: 'complete',
            };
            expect(task.status).toBe('complete');
        });

        it('should accept error status', () => {
            const task: UploadTask = {
                file: mockFile,
                path: '/uploads/test.txt',
                progress: 0,
                error: 'Failed',
                status: 'error',
            };
            expect(task.status).toBe('error');
        });
    });

    describe('Upload Progress Tracking', () => {
        const mockFile = new File(['data'], 'file.txt');

        it('should track progress starting at 0', () => {
            const task: UploadTask = {
                file: mockFile,
                path: '/uploads/file.txt',
                progress: 0,
                status: 'pending',
            };
            expect(task.progress).toBe(0);
        });

        it('should track progress incrementally', () => {
            const progresses = [0, 25, 50, 75, 100];

            progresses.forEach((progress) => {
                const task: UploadTask = {
                    file: mockFile,
                    path: '/uploads/file.txt',
                    progress,
                    status: progress === 100 ? 'complete' : 'uploading',
                };
                expect(task.progress).toBe(progress);
            });
        });
    });
});
