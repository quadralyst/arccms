import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Functions } from '@angular/fire/functions';

const m = vi.hoisted(() => ({ calls: [] as Array<{ name: string; data: any }> }));
vi.mock('@angular/fire/functions', () => ({
    Functions: class {},
    httpsCallable: vi.fn((_f: unknown, name: string) => async (data: any) => {
        m.calls.push({ name, data });
        if (name === 'arccms-sampleAppUsers') return { data: { fields: [{ path: 'plan.tier' }, { path: 'isPro' }] } };
        return { data: { matched: 3, withEmail: 2, subscribed: 1, scanned: 10, truncated: false, rows: [] } };
    }),
}));

import { AppListConditionsComponent } from './app-list-conditions.component';

describe('AppListConditionsComponent', () => {
    beforeEach(async () => {
        m.calls.length = 0;
        await TestBed.configureTestingModule({
            imports: [AppListConditionsComponent, NoopAnimationsModule],
            providers: [{ provide: Functions, useValue: {} }],
        }).compileComponents();
    });

    it('lists the sampled fields, sorted, and counts matches for the saved conditions', async () => {
        const fixture = TestBed.createComponent(AppListConditionsComponent);
        const c = fixture.componentInstance;
        c.conditions = [{ field: 'isPro', op: 'is', value: 'true' }];
        await c.ngOnInit();
        await c.runPreview();
        fixture.detectChanges();
        expect(c.fields()).toEqual(['isPro', 'plan.tier']);
        expect(m.calls.filter((x) => x.name === 'arccms-previewAppList').at(-1)?.data).toEqual({ conditions: [{ field: 'isPro', op: 'is', value: 'true' }] });
        expect((fixture.nativeElement as HTMLElement).textContent).toContain('Matches 3');
        expect((fixture.nativeElement as HTMLElement).textContent).toContain('1 can be emailed now (1 unsubscribed)');
        c.ngOnDestroy();
    });

    it('turns rows into conditions: lists split on commas, no value for empty checks', () => {
        const c = TestBed.createComponent(AppListConditionsComponent).componentInstance;
        const emitted: any[] = [];
        c.conditionsChange.subscribe((v) => emitted.push(v));
        c.conditions = [{ field: 'plan.tier', op: 'any_of', value: ['pro', 'business'] }];
        expect(c.rows()[0].text).toBe('pro, business');
        c.update(0, { text: 'pro, , team ' });
        c.add();
        c.update(1, { field: 'status', op: 'empty', text: 'ignored' });
        expect(emitted.at(-1)).toEqual([
            { field: 'plan.tier', op: 'any_of', value: ['pro', 'team'] },
            { field: 'status', op: 'empty' },
        ]);
        c.remove(0);
        expect(c.current()).toEqual([{ field: 'status', op: 'empty' }]);
        c.ngOnDestroy();
    });
});
