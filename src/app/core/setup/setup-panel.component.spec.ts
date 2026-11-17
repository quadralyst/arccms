import { describe, expect, it, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { SetupPanelComponent } from './setup-panel.component';
import { SetupStatusService } from './setup-status.service';
import type { SetupRow } from './setup-items';

const langs = {
    en: {
        admin: { dashboard: { setup: {
            heading: 'Finish setting up', intro: 'Intro', optional: 'Optional', needed: 'Needed', set_up: 'Set up', check: 'Check',
            email_title: 'Email', email_off: 'Email is off.',
        } } },
    },
};

const row = (id: string, need: Partial<SetupRow['need']>): SetupRow => ({
    item: { id, icon: 'fa-solid fa-plug', route: `/admin/settings/${id}`, pending: async () => null },
    need: { required: false, title: id, why: `${id} why`, ...need },
});

describe('SetupPanelComponent', () => {
    const status = { rows: signal<SetupRow[]>([]), loaded: signal(true) };

    beforeEach(async () => {
        status.rows.set([]);
        status.loaded.set(true);
        await TestBed.configureTestingModule({
            imports: [SetupPanelComponent, TranslocoTestingModule.forRoot({ langs, translocoConfig: { defaultLang: 'en', availableLangs: ['en'] }, preloadLangs: true })],
            providers: [provideRouter([]), { provide: SetupStatusService, useValue: status }],
        }).compileComponents();
    });

    const render = () => {
        const fixture = TestBed.createComponent(SetupPanelComponent);
        fixture.detectChanges();
        return fixture.nativeElement as HTMLElement;
    };

    it('renders nothing when nothing is pending, or before the checks answer', () => {
        expect(render().querySelector('[data-testid="setup-panel"]')).toBeNull();
        status.rows.set([row('sms', {})]);
        status.loaded.set(false);
        expect(render().querySelector('[data-testid="setup-panel"]')).toBeNull();
    });

    it('lists each pending item with its tag, why and a link to its settings', () => {
        status.rows.set([
            row('email', { required: true, titleKey: 'admin.dashboard.setup.email_title', whyKey: 'admin.dashboard.setup.email_off' }),
            row('sms', {}),
        ]);
        const el = render();
        const [email, sms] = Array.from(el.querySelectorAll('.setup-row'));
        expect(el.querySelector('h2')?.textContent).toContain('Finish setting up');
        expect(email.textContent).toContain('Email');
        expect(email.textContent).toContain('Needed');
        expect(email.textContent).toContain('Email is off.');
        expect(email.querySelector('a')?.getAttribute('href')).toBe('/admin/settings/email');
        expect(email.querySelector('a')?.textContent).toContain('Set up');
        expect(sms.textContent).toContain('Optional');
    });

    it('shows a warning row with Check, and the written text when a key has no translation', () => {
        status.rows.set([row('maps', { warning: true, titleKey: 'app.setup.maps', title: 'Maps', whyKey: 'app.setup.maps_why', why: 'The maps key failed.' })]);
        const el = render();
        const maps = el.querySelector('.setup-row')!;
        expect(maps.classList).toContain('warning');
        expect(maps.textContent).toContain('Maps');
        expect(maps.textContent).toContain('The maps key failed.');
        expect(maps.querySelector('a')?.textContent).toContain('Check');
    });
});
