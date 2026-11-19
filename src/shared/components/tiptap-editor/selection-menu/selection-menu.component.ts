import { ChangeDetectorRef, Component, EventEmitter, Input, OnDestroy, Output, inject } from '@angular/core';
import { OverlayModule } from '@angular/cdk/overlay';
import { NgClass } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslocoPipe } from '@jsverse/transloco';
import { Editor } from '@tiptap/core';
import { ARC_BLOCKS, ArcBlockKind, ArcBlockMeta } from '../service/arc-block-extension';
import { removeImage, selectedImage, setImageAlt } from '../service/image-actions';
import { UrlAddDialog } from '../service/url-add-dialog/add-url.component';

/**
 * The selection menu (specs/visual-editing-spec.md, VE-D27): text style, bold and
 * the other marks, quote, blocks and tables, lists, alignment, link, code, undo and
 * redo; with a picture selected, Replace, Remove and its alt text (VE-D16).
 *
 * The form editor shows it in TipTap's bubble menu; the Visual Editor shows it in a
 * box beside the selection on the page. One menu, so both editors offer the same
 * buttons in the same order. Replace asks the host for the media picker, whose
 * heading names the field.
 */
@Component({
    selector: 'arc-selection-menu',
    standalone: true,
    imports: [OverlayModule, NgClass, MatTooltip, TranslocoPipe],
    templateUrl: './selection-menu.component.html',
    styleUrl: './selection-menu.component.scss',
})
export class SelectionMenuComponent implements OnDestroy {
    private readonly cdr = inject(ChangeDetectorRef);
    private readonly dialog = inject(MatDialog);
    private readonly redraw = () => this.cdr.markForCheck();
    private current: Editor | null = null;

    /** The editor the buttons act on; what they show follows its every change. */
    @Input({ required: true }) set editor(editor: Editor) {
        this.current?.off('transaction', this.redraw);
        this.current = editor;
        editor?.on('transaction', this.redraw);
    }
    get editor(): Editor {
        return this.current!;
    }

    /** Replace on a selected picture: the host opens the media picker. */
    @Output() readonly replaceImage = new EventEmitter<void>();

    readonly arcBlocks: readonly ArcBlockMeta[] = ARC_BLOCKS;
    isOpenFormateOverlay = false;
    isOpenListTypeOverlay = false;
    isOpenAlignOverlay = false;
    isOpenBlocksOverlay = false;

    selectedImage() {
        return selectedImage(this.current);
    }

    removeSelectedImage(): void {
        const image = selectedImage(this.current);
        if (image) removeImage(this.editor, image.pos);
    }

    setSelectedImageAlt(alt: string): void {
        const image = selectedImage(this.current);
        if (image) setImageAlt(this.editor, image.pos, alt);
    }

    insertArcBlock(kind: ArcBlockKind): void {
        this.editor.chain().focus().insertArcBlock(kind).run();
        this.isOpenBlocksOverlay = false;
    }

    insertTable(): void {
        this.editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
        this.isOpenBlocksOverlay = false;
    }

    /** Link: asks for the address; Cancel, or Add with the box empty, changes nothing. */
    addLink(): void {
        const editor = this.editor;
        const ref = this.dialog.open(UrlAddDialog, {
            enterAnimationDuration: '450ms',
            exitAnimationDuration: '300ms',
            width: '70vh',
            data: { msg: 'common.add_url.link_text', placeholder: 'common.add_url.link' },
            disableClose: true,
        });
        ref.afterClosed().subscribe((result) => {
            if (!result || editor.isDestroyed) return;
            editor.chain().focus().extendMarkRange('link').setLink({ href: result }).run();
        });
    }

    ngOnDestroy(): void {
        this.current?.off('transaction', this.redraw);
        this.current = null;
    }
}
