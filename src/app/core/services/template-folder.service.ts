import { inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, map, catchError, forkJoin } from 'rxjs';

export interface TemplateFolder {
    name: string;
    displayName: string;
    isValid: boolean;
    invalidReason?: string;
}

/**
 * Service to fetch and validate available template folders
 * Scans /public/templates/ for folders and validates they contain required files
 */
@Injectable({
    providedIn: 'root'
})
export class TemplateFolderService {
    private http = inject(HttpClient);

    // Signal to store available templates
    templateFolders = signal<TemplateFolder[]>([]);
    isLoading = signal<boolean>(false);

    /**
     * Fetches list of template folders from the templates directory
     * Each folder must contain *-list.html and *-detail.html to be valid
     */
    getAvailableTemplates(): Observable<TemplateFolder[]> {
        this.isLoading.set(true);

        // Fetch the templates manifest (we'll create a simple endpoint or use a manifest file)
        return this.http.get<string[]>('/api/templates').pipe(
            map((folders: string[]) => {
                const templates: TemplateFolder[] = folders.map(folder => ({
                    name: folder,
                    displayName: this.formatDisplayName(folder),
                    isValid: true, // Will be validated separately
                }));

                // Add "default" option at the beginning
                templates.unshift({
                    name: 'default',
                    displayName: 'Default Template',
                    isValid: true,
                });

                this.templateFolders.set(templates);
                this.isLoading.set(false);
                return templates;
            }),
            catchError((error) => {
                console.error('Error fetching template folders:', error);
                this.isLoading.set(false);
                // Return default option on error
                const defaultTemplates: TemplateFolder[] = [{
                    name: 'default',
                    displayName: 'Default Template',
                    isValid: true,
                }];
                this.templateFolders.set(defaultTemplates);
                return of(defaultTemplates);
            })
        );
    }

    /**
     * Validates a template folder by checking if required files exist
     * @param folderName - Name of the template folder
     */
    validateTemplateFolder(folderName: string): Observable<TemplateFolder> {
        if (folderName === 'default') {
            return of({
                name: 'default',
                displayName: 'Default Template',
                isValid: true,
            });
        }

        // Check for *-list.html and *-detail.html files
        const listCheck = this.http.head(`/templates/${folderName}/${folderName}-list.html`, { observe: 'response' }).pipe(
            map(() => true),
            catchError(() => of(false))
        );

        const detailCheck = this.http.head(`/templates/${folderName}/${folderName}-detail.html`, { observe: 'response' }).pipe(
            map(() => true),
            catchError(() => of(false))
        );

        return forkJoin([listCheck, detailCheck]).pipe(
            map(([hasListFile, hasDetailFile]) => {
                const isValid = hasListFile && hasDetailFile;
                let invalidReason: string | undefined;

                if (!isValid) {
                    const missing: string[] = [];
                    if (!hasListFile) missing.push(`${folderName}-list.html`);
                    if (!hasDetailFile) missing.push(`${folderName}-detail.html`);
                    invalidReason = `Missing: ${missing.join(', ')}`;
                }

                return {
                    name: folderName,
                    displayName: this.formatDisplayName(folderName),
                    isValid,
                    invalidReason,
                };
            })
        );
    }

    /**
     * Fetches and validates all template folders
     */
    loadAndValidateTemplates(): Observable<TemplateFolder[]> {
        this.isLoading.set(true);

        // For now, we'll scan known folders or use a static list
        // In production, this would be an API endpoint
        return this.scanPublicTemplates().pipe(
            map((folders) => {
                this.templateFolders.set(folders);
                this.isLoading.set(false);
                return folders;
            }),
            catchError((error) => {
                console.error('Error loading templates:', error);
                this.isLoading.set(false);
                const defaultOnly: TemplateFolder[] = [{
                    name: 'default',
                    displayName: 'Default Template',
                    isValid: true,
                }];
                this.templateFolders.set(defaultOnly);
                return of(defaultOnly);
            })
        );
    }

    /**
     * Scans /public/templates/ directory for template folders
     * Uses a manifest file or API to get folder list
     */
    private scanPublicTemplates(): Observable<TemplateFolder[]> {
        // Fetch templates.json manifest that lists available folders
        return this.http.get<{ folders: string[] }>('/templates/templates.json').pipe(
            map((manifest) => {
                const templates: TemplateFolder[] = manifest.folders.map(folder => ({
                    name: folder,
                    displayName: this.formatDisplayName(folder),
                    isValid: true, // Manifest entries are assumed valid
                }));

                // Add "default" option at the beginning
                templates.unshift({
                    name: 'default',
                    displayName: 'Default Template',
                    isValid: true,
                });

                return templates;
            }),
            catchError(() => {
                // If manifest doesn't exist, return default only
                return of([{
                    name: 'default',
                    displayName: 'Default Template',
                    isValid: true,
                }]);
            })
        );
    }

    /**
     * Formats folder name for display (e.g., "blog-modern" -> "Blog Modern")
     */
    private formatDisplayName(folderName: string): string {
        return folderName
            .split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }
}
