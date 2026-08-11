import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { EmailBlock, EmailBlockType, EmailDesign, IEmailBrandKit, DEFAULT_BRAND_KIT } from '../../email-compiler/email-design.model';
import { compileEmailDesign, compiledHtmlHasUnsubscribe } from '../../email-compiler/compiler';
import { createBlock, moveBlock, removeBlock, appendTag } from './block-ops';
import { HashtagAutocompleteDirective } from '../../directives/hashtag-autocomplete/hashtag-autocomplete.directive';

export interface BlockEditorSaveEvent {
    design: EmailDesign;
    html: string;
}

/**
 * Block-based email editor (Phase 4, D3). Admins compose from blocks and never
 * touch HTML/CSS. Compiles to email-safe HTML client-side at save; emits both
 * the design JSON and compiled HTML so the caller stores both.
 */
@Component({
    selector: 'arc-email-block-editor',
    standalone: true,
    imports: [
        CommonModule, FormsModule, MatButtonModule, MatIconModule, MatMenuModule,
        MatFormFieldModule, MatInputModule, MatSelectModule, HashtagAutocompleteDirective,
    ],
    templateUrl: './email-block-editor.component.html',
})
export class EmailBlockEditorComponent {
    private sanitizer = inject(DomSanitizer);

    @Input() set design(value: EmailDesign | null | undefined) {
        this.blocks.set(value?.blocks ? [...value.blocks] : []);
    }
    @Input() brandKit: IEmailBrandKit = { ...DEFAULT_BRAND_KIT };
    /** Available merge tags for the chip palette. */
    @Input() placeholders: string[] = ['##NAME##', '##EMAIL##'];
    /** 'marketing' enforces the unsubscribe guard on save. */
    @Input() category: 'transactional' | 'marketing' = 'transactional';

    @Output() saved = new EventEmitter<BlockEditorSaveEvent>();
    @Output() testSend = new EventEmitter<BlockEditorSaveEvent>();

    blocks = signal<EmailBlock[]>([]);
    previewMode = signal<'desktop' | 'mobile'>('desktop');
    error = signal('');

    readonly blockTypes: EmailBlockType[] = [
        'heading', 'paragraph', 'image', 'button', 'divider', 'spacer', 'columns', 'social', 'raw',
    ];

    private currentDesign = computed<EmailDesign>(() => ({ blocks: this.blocks() }));

    compiledHtml = computed<string>(() => compileEmailDesign(this.currentDesign(), this.brandKit));

    previewHtml = computed<SafeHtml>(() => this.sanitizer.bypassSecurityTrustHtml(this.compiledHtml()));

    add(type: EmailBlockType): void {
        this.blocks.update((b) => [...b, createBlock(type)]);
    }

    move(index: number, dir: -1 | 1): void {
        this.blocks.update((b) => moveBlock(b, index, dir));
    }

    remove(index: number): void {
        this.blocks.update((b) => removeBlock(b, index));
    }

    patch(index: number, patch: Partial<EmailBlock>): void {
        this.blocks.update((b) => b.map((blk, i) => (i === index ? ({ ...blk, ...patch } as EmailBlock) : blk)));
    }

    /** Heading level select emits a string; narrow it to the 1|2|3 union here (not in the template). */
    setHeadingLevel(index: number, value: string): void {
        const level = Number(value) as 1 | 2 | 3;
        this.patch(index, { level });
    }

    /** Insert a merge tag into a text/html field of the block. */
    insertTag(index: number, field: 'text' | 'html', tag: string): void {
        this.blocks.update((b) =>
            b.map((blk, i) => {
                if (i !== index) return blk;
                const current = (blk as any)[field] || '';
                return { ...blk, [field]: appendTag(current, tag) } as EmailBlock;
            }),
        );
    }

    private guard(): boolean {
        if (this.category === 'marketing' && !compiledHtmlHasUnsubscribe(this.compiledHtml())) {
            this.error.set('Marketing emails must include an ##UNSUBSCRIBE_LINK##. Restore it in the brand-kit footer.');
            return false;
        }
        this.error.set('');
        return true;
    }

    save(): void {
        if (!this.guard()) return;
        this.saved.emit({ design: this.currentDesign(), html: this.compiledHtml() });
    }

    sendTest(): void {
        if (!this.guard()) return;
        this.testSend.emit({ design: this.currentDesign(), html: this.compiledHtml() });
    }
}
