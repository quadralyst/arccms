import { describe, it, expect, vi } from 'vitest';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { RowAction, isDangerAction, planRowActions } from './row-actions';
import { RowActionsComponent } from './row-actions.component';

const a = (action: string, extra: Partial<RowAction> = {}): RowAction => ({ action, icon: `fas fa-${action}`, label: action, ...extra });
const keys = (slots: { key: string }[]) => slots.map(s => s.key);

describe('planRowActions', () => {
    const users = [a('view'), a('edit'), a('toggleActive'), a('verify', { hide: (r) => r.verified }), a('delete')];

    it('shows up to three actions inline, in priority order', () => {
        const plan = planRowActions([a('delete'), a('default'), a('edit')], [{}]);
        expect(keys(plan.inline)).toEqual(['edit', 'default', 'delete']);
        expect(plan.menu).toEqual([]);
    });

    it('keeps two inline and moves the rest to the menu when there are more than three', () => {
        const plan = planRowActions(users, [{ verified: false }]);
        expect(keys(plan.inline)).toEqual(['edit', 'view']);
        expect(keys(plan.menu)).toEqual(['toggleActive', 'verify', 'delete']);
    });

    it('never puts a danger action inline when the menu is in use', () => {
        const plan = planRowActions([a('delete'), a('edit'), a('tags'), a('templates')], [{}]);
        expect(keys(plan.inline)).toEqual(['edit', 'tags']);
        expect(keys(plan.menu)).toEqual(['templates', 'delete']);
    });

    it('counts the actions rows actually show, across every row', () => {
        const drafts = [a('preview'), a('edit'), a('unpublish', { hide: r => !r.pub }), a('history', { hide: r => !r.pub }), a('delete')];
        expect(planRowActions(drafts, [{ pub: false }, { pub: false }]).menu).toEqual([]);
        expect(keys(planRowActions(drafts, [{ pub: false }, { pub: true }]).menu)).toEqual(['unpublish', 'history', 'delete']);
    });

    it('counts positions in use, so rows showing different actions cannot widen the column', () => {
        const actions = [a('edit'), a('one', { hide: r => r.k !== 1 }), a('two', { hide: r => r.k !== 2 }), a('three', { hide: r => r.k !== 3 })];
        const plan = planRowActions(actions, [{ k: 1 }, { k: 2 }, { k: 3 }]);
        expect(keys(plan.inline)).toEqual(['edit', 'one']);
        expect(keys(plan.menu)).toEqual(['two', 'three']);
    });

    it('drops actions no row shows', () => {
        const plan = planRowActions([a('edit'), a('cancel', { hide: () => true })], [{}, {}]);
        expect(keys(plan.inline)).toEqual(['edit']);
    });

    it('lets alternates share one slot', () => {
        const drips = [
            a('edit'),
            a('activate', { slot: 'status', hide: r => r.s !== 'draft' }),
            a('resume', { slot: 'status', hide: r => r.s !== 'paused' }),
            a('pause', { slot: 'status', hide: r => r.s !== 'active' }),
            a('archive'),
        ];
        const plan = planRowActions(drips, [{ s: 'draft' }, { s: 'active' }, { s: 'paused' }]);
        expect(keys(plan.inline)).toEqual(['edit', 'status', 'archive']);
        expect(plan.inline[1].actions.map(x => x.action)).toEqual(['activate', 'resume', 'pause']);
    });

    it('keeps fewer inline on a narrow screen', () => {
        expect(keys(planRowActions([a('edit'), a('view'), a('delete')], [{}], { compact: true }).inline)).toEqual(['edit']);
        expect(keys(planRowActions([a('edit'), a('delete')], [{}], { compact: true }).inline)).toEqual(['edit', 'delete']);
    });

    it('honours maxInline, priority and placement', () => {
        expect(keys(planRowActions(users, [{}], { maxInline: 1 }).inline)).toEqual(['edit']);
        expect(keys(planRowActions([a('edit'), a('tags', { priority: 1 }), a('x'), a('delete')], [{}]).inline)).toEqual(['tags', 'edit']);
        expect(keys(planRowActions([a('edit'), a('view', { placement: 'menu' })], [{}]).menu)).toEqual(['view']);
    });

    it('infers danger from the name or a delete class', () => {
        expect(isDangerAction(a('remove'))).toBe(true);
        expect(isDangerAction(a('disable', { class: 'delete' }))).toBe(true);
        expect(isDangerAction(a('delete', { danger: false }))).toBe(false);
        expect(isDangerAction(a('edit'))).toBe(false);
    });
});

describe('RowActionsComponent', () => {
    function render(actions: RowAction[], row: any, rows?: any[]) {
        TestBed.configureTestingModule({ imports: [RowActionsComponent], providers: [provideNoopAnimations()] });
        const fixture = TestBed.createComponent(RowActionsComponent);
        fixture.componentRef.setInput('actions', actions);
        fixture.componentRef.setInput('row', row);
        if (rows) fixture.componentRef.setInput('rows', rows);
        fixture.detectChanges();
        return fixture;
    }

    it('renders inline icons and no menu for a short list', () => {
        const el = render([a('edit'), a('delete')], {}).nativeElement as HTMLElement;
        expect(el.querySelectorAll('.action-btn').length).toBe(2);
        expect(el.querySelector('.more-btn')).toBeNull();
    });

    it('renders a more button when actions overflow', () => {
        const el = render([a('view'), a('edit'), a('block'), a('verify'), a('delete')], {}).nativeElement as HTMLElement;
        expect(el.querySelectorAll('.action-btn:not(.more-btn)').length).toBe(2);
        expect(el.querySelector('.more-btn')).not.toBeNull();
    });

    it('keeps an empty slot where a row hides an action', () => {
        const actions = [a('edit'), a('default', { hide: r => r.isDefault }), a('delete')];
        const el = render(actions, { isDefault: true }, [{ isDefault: true }, { isDefault: false }]).nativeElement as HTMLElement;
        expect(el.querySelectorAll('.action-btn').length).toBe(2);
        expect(el.querySelectorAll('.action-slot').length).toBe(1);
    });

    it('follows hide and iconFn when page state or the row changes in place', () => {
        // The app is zoneless: a page re-renders its table and the table its
        // rows, but an OnPush row-actions cell with unchanged inputs would keep
        // showing a Block icon for a blocked user, or a hidden Remove.
        @Component({
            standalone: true,
            imports: [RowActionsComponent],
            template: `<arc-row-actions [actions]="actions" [row]="row"></arc-row-actions>`,
        })
        class HostComponent {
            formFed = false;
            row = { active: true };
            actions: RowAction[] = [
                a('toggle', { iconFn: r => r.active ? 'fas fa-ban' : 'fas fa-check' }),
                a('remove', { hide: () => this.formFed }),
            ];
        }
        TestBed.configureTestingModule({ imports: [HostComponent], providers: [provideNoopAnimations()] });
        const fixture = TestBed.createComponent(HostComponent);
        fixture.detectChanges();
        const el = fixture.nativeElement as HTMLElement;
        expect(el.querySelectorAll('.action-btn').length).toBe(2);

        fixture.componentInstance.row.active = false;
        fixture.componentInstance.formFed = true;
        fixture.componentRef.changeDetectorRef.markForCheck();
        fixture.detectChanges();
        expect(el.querySelector('.action-btn i')?.className).toContain('fa-check');
        expect(el.querySelectorAll('.action-btn').length).toBe(1);
    });

    it('drops colour classes from menu icons', () => {
        const fixture = render([a('edit'), a('view'), a('tags', { icon: 'fas fa-tags text-warning' }), a('delete')], {});
        expect(fixture.componentInstance.menuIconOf(a('tags', { icon: 'fas fa-tags text-warning' }))).toBe('fas fa-tags');
    });

    it('runs onAction, or emits when there is none, without reaching the row', () => {
        const onAction = vi.fn();
        const fixture = render([a('edit', { onAction }), a('delete')], { id: 1 });
        const emitted: any[] = [];
        fixture.componentInstance.actionClick.subscribe(e => emitted.push(e));
        const rowClick = vi.fn();
        (fixture.nativeElement as HTMLElement).parentElement?.addEventListener('click', rowClick);
        const [edit, del] = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.action-btn'));
        edit.click();
        del.click();
        expect(onAction).toHaveBeenCalledWith({ id: 1 });
        expect(emitted).toEqual([{ action: 'delete', row: { id: 1 } }]);
        expect(rowClick).not.toHaveBeenCalled();
    });
});
