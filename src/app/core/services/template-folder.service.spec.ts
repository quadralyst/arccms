/**
 * Tests for Template Folder Service
 *
 * Tests verify the TemplateFolderService functionality including:
 * - Available templates fetching
 * - Template folder validation
 * - Display name formatting
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TemplateFolderService, TemplateFolder } from './template-folder.service';

describe('TemplateFolderService', () => {
    let service: TemplateFolderService;
    let httpMock: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [HttpClientTestingModule],
            providers: [TemplateFolderService]
        });

        service = TestBed.inject(TemplateFolderService);
        httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
        httpMock.verify();
    });

    describe('Service Creation', () => {
        it('should be created', () => {
            expect(service).toBeTruthy();
        });

        it('should have initial empty template folders', () => {
            expect(service.templateFolders()).toEqual([]);
        });

        it('should have initial isLoading as false', () => {
            expect(service.isLoading()).toBe(false);
        });
    });

    describe('getAvailableTemplates', () => {
        it('should fetch templates from API', () => {
            const mockFolders = ['articles', 'blog'];

            service.getAvailableTemplates().subscribe((templates) => {
                expect(templates.length).toBe(3); // 2 + default
                expect(templates[0].name).toBe('default');
                expect(templates[1].name).toBe('articles');
                expect(templates[2].name).toBe('blog');
            });

            const req = httpMock.expectOne('/api/templates');
            expect(req.request.method).toBe('GET');
            req.flush(mockFolders);
        });

        it('should add default template at the beginning', () => {
            const mockFolders = ['custom'];

            service.getAvailableTemplates().subscribe((templates) => {
                expect(templates[0]).toEqual({
                    name: 'default',
                    displayName: 'Default Template',
                    isValid: true
                });
            });

            const req = httpMock.expectOne('/api/templates');
            req.flush(mockFolders);
        });

        it('should format display names correctly', () => {
            const mockFolders = ['blog-modern', 'simple-clean'];

            service.getAvailableTemplates().subscribe((templates) => {
                expect(templates[1].displayName).toBe('Blog Modern');
                expect(templates[2].displayName).toBe('Simple Clean');
            });

            const req = httpMock.expectOne('/api/templates');
            req.flush(mockFolders);
        });

        it('should update templateFolders signal', () => {
            const mockFolders = ['test'];

            service.getAvailableTemplates().subscribe(() => {
                expect(service.templateFolders().length).toBe(2);
            });

            const req = httpMock.expectOne('/api/templates');
            req.flush(mockFolders);
        });

        it('should handle API errors gracefully', () => {
            service.getAvailableTemplates().subscribe((templates) => {
                expect(templates.length).toBe(1);
                expect(templates[0].name).toBe('default');
            });

            const req = httpMock.expectOne('/api/templates');
            req.error(new ErrorEvent('Network error'));
        });

        it('should set isLoading to true during fetch', () => {
            service.getAvailableTemplates().subscribe();

            expect(service.isLoading()).toBe(true);

            const req = httpMock.expectOne('/api/templates');
            req.flush([]);

            expect(service.isLoading()).toBe(false);
        });
    });

    describe('validateTemplateFolder', () => {
        it('should return valid for default template', () => {
            service.validateTemplateFolder('default').subscribe((result) => {
                expect(result).toEqual({
                    name: 'default',
                    displayName: 'Default Template',
                    isValid: true
                });
            });

            // No HTTP requests expected for 'default'
            httpMock.expectNone('/templates/default/default-list.html');
        });

        it('should validate custom template folder with required files', () => {
            service.validateTemplateFolder('articles').subscribe((result) => {
                expect(result.name).toBe('articles');
                expect(result.isValid).toBe(true);
            });

            const listReq = httpMock.expectOne('/templates/articles/articles-list.html');
            listReq.flush(null);

            const detailReq = httpMock.expectOne('/templates/articles/articles-detail.html');
            detailReq.flush(null);
        });

        it('should return invalid when list file is missing', () => {
            service.validateTemplateFolder('broken').subscribe((result) => {
                expect(result.isValid).toBe(false);
                expect(result.invalidReason).toContain('broken-list.html');
            });

            const listReq = httpMock.expectOne('/templates/broken/broken-list.html');
            listReq.error(new ErrorEvent('Not found'));

            const detailReq = httpMock.expectOne('/templates/broken/broken-detail.html');
            detailReq.flush(null);
        });

        it('should return invalid when detail file is missing', () => {
            service.validateTemplateFolder('incomplete').subscribe((result) => {
                expect(result.isValid).toBe(false);
                expect(result.invalidReason).toContain('incomplete-detail.html');
            });

            const listReq = httpMock.expectOne('/templates/incomplete/incomplete-list.html');
            listReq.flush(null);

            const detailReq = httpMock.expectOne('/templates/incomplete/incomplete-detail.html');
            detailReq.error(new ErrorEvent('Not found'));
        });
    });

    describe('loadAndValidateTemplates', () => {
        it('should load templates from manifest', () => {
            service.loadAndValidateTemplates().subscribe((templates) => {
                expect(templates.length).toBeGreaterThan(0);
            });

            const req = httpMock.expectOne('/templates/templates.json');
            req.flush({ folders: ['articles', 'manuals'] });
        });

        it('should update templateFolders signal on success', () => {
            service.loadAndValidateTemplates().subscribe(() => {
                expect(service.templateFolders().length).toBe(3);
            });

            const req = httpMock.expectOne('/templates/templates.json');
            req.flush({ folders: ['articles', 'manuals'] });
        });

        it('should return default only on error', () => {
            service.loadAndValidateTemplates().subscribe((templates) => {
                expect(templates.length).toBe(1);
                expect(templates[0].name).toBe('default');
            });

            const req = httpMock.expectOne('/templates/templates.json');
            req.error(new ErrorEvent('Network error'));
        });

        it('should set isLoading during operation', () => {
            service.loadAndValidateTemplates().subscribe();

            expect(service.isLoading()).toBe(true);

            const req = httpMock.expectOne('/templates/templates.json');
            req.flush({ folders: [] });

            expect(service.isLoading()).toBe(false);
        });
    });

    describe('formatDisplayName', () => {
        it('should format hyphenated names', () => {
            // Testing via getAvailableTemplates since formatDisplayName is private
            const mockFolders = ['blog-modern-style'];

            service.getAvailableTemplates().subscribe((templates) => {
                expect(templates[1].displayName).toBe('Blog Modern Style');
            });

            const req = httpMock.expectOne('/api/templates');
            req.flush(mockFolders);
        });

        it('should capitalize single word names', () => {
            const mockFolders = ['simple'];

            service.getAvailableTemplates().subscribe((templates) => {
                expect(templates[1].displayName).toBe('Simple');
            });

            const req = httpMock.expectOne('/api/templates');
            req.flush(mockFolders);
        });
    });

    describe('TemplateFolder Interface', () => {
        it('should have required properties', () => {
            const template: TemplateFolder = {
                name: 'test',
                displayName: 'Test',
                isValid: true
            };

            expect(template.name).toBe('test');
            expect(template.displayName).toBe('Test');
            expect(template.isValid).toBe(true);
            expect(template.invalidReason).toBeUndefined();
        });

        it('should allow optional invalidReason', () => {
            const template: TemplateFolder = {
                name: 'broken',
                displayName: 'Broken',
                isValid: false,
                invalidReason: 'Missing files'
            };

            expect(template.invalidReason).toBe('Missing files');
        });
    });
});
