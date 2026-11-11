import { describe, expect, it } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { NotificationBellComponent } from './notification-bell.component';
import { NotificationService } from '../../services/notification.service';
import { AuthState } from '../../../app/pages/(auth)/auth.store';
import { translocoTestingModule } from '../../../test/transloco-test-providers';

function render(lang = 'en', unread = 2) {
    const notes = Array.from({ length: unread }, (_, i) => ({ id: `n${i}`, title: 'T', body: 'B', read: false }));
    TestBed.configureTestingModule({
        imports: [NotificationBellComponent, translocoTestingModule({ lang })],
        providers: [
            provideRouter([]),
            { provide: NotificationService, useValue: { watch: () => of(notes), markRead: async () => {}, markAllRead: async () => {} } },
            { provide: AuthState, useValue: { currentUser: signal({ uid: 'u1' }), isAdmin: () => true } },
        ],
    });
    const fixture = TestBed.createComponent(NotificationBellComponent);
    fixture.detectChanges();
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('button') as HTMLButtonElement;
}

describe('NotificationBellComponent', () => {
    it('names the bell with the unread count', () => {
        expect(render('en', 2).getAttribute('aria-label')).toBe('Notifications, 2 unread');
    });

    it('names the bell plainly when nothing is unread', () => {
        expect(render('en', 0).getAttribute('aria-label')).toBe('Notifications');
    });

    it('names the bell in the admin language', () => {
        expect(render('hi', 3).getAttribute('aria-label')).toBe('सूचनाएँ, 3 अपठित');
    });
});
