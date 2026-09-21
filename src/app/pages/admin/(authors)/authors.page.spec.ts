/**
 * Tests for AuthorsPageComponent (docs/discoverability-spec.md, D2)
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import AuthorsPageComponent from './authors.page';
import { AuthorsService } from './authors.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { headerTestProviders } from '../../../../test/header-test-providers';

const AUTHORS = [
    { id: 'a1', name: 'Jane Doe', jobTitle: 'Founder', bio: '', photoUrl: '', url: '', slug: 'jane-doe', sameAs: ['https://x.com/jane'] },
    { id: 'a2', name: 'John Roe', jobTitle: '', bio: '', photoUrl: '', url: '', slug: 'john-roe', sameAs: [] },
];

describe('AuthorsPageComponent', () => {
    let component: AuthorsPageComponent;
    let fixture: ComponentFixture<AuthorsPageComponent>;
    let service: any;
    let toast: any;
    let dialog: any;

    beforeEach(async () => {
        service = {
            list: vi.fn().mockReturnValue(of(AUTHORS)),
            loadSettings: vi.fn().mockResolvedValue({ defaultAuthorId: 'a1' }),
            create: vi.fn().mockResolvedValue('a3'),
            save: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
            setDefaultAuthor: vi.fn().mockResolvedValue(undefined),
            ensureAdminAuthor: vi.fn().mockResolvedValue(null),
        };
        toast = { success: vi.fn(), error: vi.fn() };
        dialog = { open: vi.fn().mockReturnValue({ afterClosed: () => of(true) }) };

        await TestBed.configureTestingModule({
            imports: [AuthorsPageComponent, NoopAnimationsModule],
            providers: [
                { provide: AuthorsService, useValue: service },
                { provide: ToastService, useValue: toast },
                ...headerTestProviders(),
            ],
        })
            // MatDialogModule (imported by the component) provides its own
            // MatDialog; overrideProvider reaches that level, a root provider does not.
            .overrideProvider(MatDialog, { useValue: dialog })
            .compileComponents();

        fixture = TestBed.createComponent(AuthorsPageComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
        await fixture.whenStable();
    });

    it('seeds the admin author on init and adopts it as the default when none is set', async () => {
        service.loadSettings.mockResolvedValue({ defaultAuthorId: '' });
        service.ensureAdminAuthor.mockResolvedValue({ id: 'admin-u1', name: 'Gunjan Karun' });
        const f = TestBed.createComponent(AuthorsPageComponent);
        f.detectChanges();
        await f.whenStable();
        expect(service.ensureAdminAuthor).toHaveBeenCalled();
        expect(f.componentInstance.defaultAuthorId()).toBe('admin-u1');
    });

    it('lists authors and marks the default', () => {
        expect(component.authors().length).toBe(2);
        expect(component.rows().find(r => r.id === 'a1')?.isDefault).toBe(true);
        expect(component.rows().find(r => r.id === 'a2')?.isDefault).toBe(false);
    });

    it('refuses to save without a name', async () => {
        component.openAdd();
        component.form.name = '  ';
        await component.save();
        expect(service.create).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalled();
    });

    it('creates an author with parsed sameAs lines', async () => {
        component.openAdd();
        component.form.name = 'New Person';
        component.sameAsText = 'https://x.com/new\n\nhttps://github.com/new';
        await component.save();
        expect(service.create).toHaveBeenCalledWith(expect.objectContaining({
            name: 'New Person',
            sameAs: ['https://x.com/new', 'https://github.com/new'],
        }));
        expect(component.drawerOpen()).toBe(false);
    });

    it('makes the first author the default automatically', async () => {
        component.authors.set([]);
        component.defaultAuthorId.set('');
        component.openAdd();
        component.form.name = 'Only Writer';
        await component.save();
        expect(service.setDefaultAuthor).toHaveBeenCalledWith('a3');
        expect(component.defaultAuthorId()).toBe('a3');
    });

    it('edits an existing author in place', async () => {
        component.openEdit(AUTHORS[1] as any);
        expect(component.editing()?.id).toBe('a2');
        component.form.jobTitle = 'Editor';
        await component.save();
        expect(service.save).toHaveBeenCalledWith('a2', expect.objectContaining({ name: 'John Roe', jobTitle: 'Editor' }));
    });

    it('toggles the default author', async () => {
        await component.toggleDefault(AUTHORS[1] as any);
        expect(service.setDefaultAuthor).toHaveBeenCalledWith('a2');
        expect(component.defaultAuthorId()).toBe('a2');
        await component.toggleDefault(AUTHORS[1] as any);
        expect(service.setDefaultAuthor).toHaveBeenLastCalledWith('');
    });

    it('deletes after confirmation and clears the default if it was that author', async () => {
        component.confirmDelete(AUTHORS[0] as any);
        await fixture.whenStable();
        expect(service.remove).toHaveBeenCalledWith('a1');
        expect(service.setDefaultAuthor).toHaveBeenCalledWith('');
        expect(toast.success).toHaveBeenCalled();
    });
});
