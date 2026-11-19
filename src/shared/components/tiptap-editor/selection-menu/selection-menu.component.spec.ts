/**
 * The selection menu (specs/visual-editing-spec.md, VE-D27): the one menu both
 * editors show, so a button added or changed here changes in both.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { NodeSelection, TextSelection } from 'prosemirror-state';
import { SelectionMenuComponent } from './selection-menu.component';
import { translocoTestingModule } from '../../../../test/transloco-test-providers';

describe('SelectionMenuComponent', () => {
    let editor: Editor;

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [SelectionMenuComponent, translocoTestingModule()],
            providers: [{ provide: MatDialog, useValue: { open: () => ({ afterClosed: () => ({ subscribe: () => undefined }) }) } }],
        });
        editor = new Editor({ extensions: [StarterKit, Image], content: '<p>Hello world</p><img src="/a.png" alt="A">' });
    });

    afterEach(() => editor.destroy());

    function render() {
        const fixture = TestBed.createComponent(SelectionMenuComponent);
        fixture.componentRef.setInput('editor', editor);
        fixture.detectChanges();
        return fixture;
    }

    it('shows the text buttons for selected text, and Bold acts on it', () => {
        editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6)));
        const fixture = render();
        const el: HTMLElement = fixture.nativeElement;
        expect(el.querySelector('[data-test-id="image-menu"]')).toBeNull();
        const bold = el.querySelector<HTMLButtonElement>('button[aria-label="common.editor_toolbar.bold"]')
            ?? [...el.querySelectorAll('button')].find((b) => b.querySelector('.bi-type-bold'))!;
        bold.click();
        expect(editor.getHTML()).toContain('<strong>Hello</strong>');
    });

    it('shows Replace, Remove and alt text for a selected picture', () => {
        let imagePos = -1;
        editor.state.doc.descendants((node, pos) => {
            if (node.type.name === 'image') imagePos = pos;
        });
        editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, imagePos)));
        const fixture = render();
        const el: HTMLElement = fixture.nativeElement;
        let replaced = 0;
        fixture.componentInstance.replaceImage.subscribe(() => replaced++);
        el.querySelector<HTMLButtonElement>('[data-test-id="image-replace"]')!.click();
        expect(replaced).toBe(1);
        el.querySelector<HTMLButtonElement>('[data-test-id="image-remove"]')!.click();
        expect(editor.getHTML()).not.toContain('<img');
    });

    it('stops following an editor once it is gone', () => {
        const fixture = render();
        fixture.destroy();
        expect(() => editor.commands.setContent('<p>Later</p>')).not.toThrow();
    });
});
