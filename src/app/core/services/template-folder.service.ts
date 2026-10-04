import { Injectable, signal } from '@angular/core';
import { Observable, of } from 'rxjs';
import { DEFAULT_TEMPLATE_FOLDER, SiteFileFrom, siteManifest } from '../site/site';

export interface TemplateFolder {
    name: string;
    displayName: string;
    /** Always true: a folder is listed only when the site has it. Kept for the pickers' markup. */
    isValid: boolean;
    invalidReason?: string;
    /** `app` when any of its files is the app's own (src/custom/site/templates/). */
    from?: SiteFileFrom;
}

/**
 * The template folders a content type can pick (docs/website/templates.html):
 * Arc CMS's default first, then every folder in the site's manifest, core's
 * (public/_site/templates/) and the app's (src/custom/site/templates/). The list
 * comes with the build, so it is always the folders this build serves; there is
 * nothing to register.
 */
@Injectable({
    providedIn: 'root'
})
export class TemplateFolderService {
    templateFolders = signal<TemplateFolder[]>([]);
    isLoading = signal<boolean>(false);

    /** The folders, the default first. */
    folders(): TemplateFolder[] {
        const templates = siteManifest().templates;
        const names = Object.keys(templates).filter((name) => name !== DEFAULT_TEMPLATE_FOLDER).sort();
        return [
            { name: DEFAULT_TEMPLATE_FOLDER, displayName: 'Default Template', isValid: true, from: 'core' },
            ...names.map((name) => ({
                name,
                displayName: this.formatDisplayName(name),
                isValid: true,
                from: (Object.values(templates[name]).includes('app') ? 'app' : 'core') as SiteFileFrom,
            })),
        ];
    }

    /** Whether the site has a folder of this name. */
    hasFolder(name: string | null | undefined): boolean {
        return !!name && !!siteManifest().templates[name];
    }

    /** The folders, as the pickers load them. */
    loadAndValidateTemplates(): Observable<TemplateFolder[]> {
        const folders = this.folders();
        this.templateFolders.set(folders);
        return of(folders);
    }

    /** "blog-modern" reads "Blog Modern". */
    private formatDisplayName(folderName: string): string {
        return folderName
            .split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }
}
