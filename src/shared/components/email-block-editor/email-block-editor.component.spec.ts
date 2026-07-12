import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { EmailBlockEditorComponent } from './email-block-editor.component';
import { DEFAULT_BRAND_KIT } from '../../email-compiler/email-design.model';

describe('EmailBlockEditorComponent', () => {
    let component: EmailBlockEditorComponent;

    beforeEach(() => {
        TestBed.configureTestingModule({ imports: [EmailBlockEditorComponent] });
        component = TestBed.createComponent(EmailBlockEditorComponent).componentInstance;
        component.design = { blocks: [{ id: '1', type: 'heading', text: 'Hi', level: 1 }] };
        component.brandKit = { ...DEFAULT_BRAND_KIT };
    });

    it('adds, moves and removes blocks', () => {
        component.add('paragraph');
        expect(component.blocks().length).toBe(2);
        component.add('button');
        expect(component.blocks().length).toBe(3);
        component.move(2, -1);
        expect(component.blocks()[1].type).toBe('button');
        component.remove(0);
        expect(component.blocks().length).toBe(2);
    });

    it('insertTag appends a merge tag to a block field', () => {
        component.patch(0, { text: 'Hello' } as any);
        component.insertTag(0, 'text', '##NAME##');
        expect((component.blocks()[0] as any).text).toBe('Hello ##NAME##');
    });

    it('compiles a full document including the branded shell', () => {
        expect(component.compiledHtml()).toContain('width="600"');
        expect(component.compiledHtml()).toContain('>Hi</h1>');
    });

    it('marketing guard blocks save when unsubscribe tag is missing', () => {
        let emitted = false;
        component.saved.subscribe(() => (emitted = true));
        component.category = 'marketing';
        component.brandKit = { ...DEFAULT_BRAND_KIT, footerText: 'no unsubscribe here' };
        component.save();
        expect(emitted).toBe(false);
        expect(component.error()).toContain('##UNSUBSCRIBE_LINK##');
    });

    it('marketing save succeeds with the default footer (has unsubscribe)', () => {
        let payload: any = null;
        component.saved.subscribe((e) => (payload = e));
        component.category = 'marketing';
        component.save();
        expect(payload).toBeTruthy();
        expect(payload.html).toContain('##UNSUBSCRIBE_LINK##');
        expect(payload.design.blocks.length).toBe(1);
    });

    it('transactional save does not require unsubscribe', () => {
        let emitted = false;
        component.saved.subscribe(() => (emitted = true));
        component.category = 'transactional';
        component.brandKit = { ...DEFAULT_BRAND_KIT, footerText: 'no unsubscribe' };
        component.save();
        expect(emitted).toBe(true);
    });
});
