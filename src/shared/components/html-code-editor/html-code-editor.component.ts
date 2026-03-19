/**
 * HTML Code Editor Component
 * 
 * A lightweight HTML code editor with syntax highlighting using PrismJS.
 * Used for editing HTML source across email templates and content editors.
 */

import { CommonModule } from '@angular/common';
import {
    AfterViewInit,
    Component,
    ElementRef,
    EventEmitter,
    Input,
    OnChanges,
    Output,
    SimpleChanges,
    ViewChild,
    signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import Prism from 'prismjs';
import 'prismjs/components/prism-markup';

@Component({
    selector: 'arc-html-code-editor',
    standalone: true,
    imports: [CommonModule, FormsModule],
    template: `
        <div class="code-editor-container" [style.height]="height">
            <!-- Line numbers -->
            @if (showLineNumbers) {
            <div class="line-numbers" #lineNumbers>
                @for (line of lineCount(); track line) {
                <span class="line-number">{{ line }}</span>
                }
            </div>
            }
            <div class="code-editor-wrapper">
                <!-- Highlighted code display -->
                <pre class="code-highlight" #codeHighlight aria-hidden="true"><code 
                    class="language-markup" 
                    [innerHTML]="highlightedCode()"></code></pre>
                
                <!-- Editable textarea overlay -->
                <textarea
                    #codeTextarea
                    class="code-textarea"
                    [value]="content"
                    (input)="onInput($event)"
                    (keydown)="onKeyDown($event)"
                    (scroll)="syncScroll($event)"
                    [placeholder]="placeholder"
                    spellcheck="false"
                    autocomplete="off"
                    autocapitalize="off">
                </textarea>
            </div>

        </div>
    `,
    styles: [`
        .code-editor-container {
            position: relative;
            display: flex;
            background: #1e1e1e;
            border-radius: 8px;
            overflow: hidden;
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', monospace;
            font-size: 13px;
            line-height: 1.6;
            min-height: 200px;
        }

        .line-numbers {
            padding: 12px 8px;
            background: #252526;
            color: #858585;
            text-align: right;
            user-select: none;
            // min-width: 40px;
            border-right: 1px solid #333;
            
            .line-number {
                display: block;
                height: 1.6em;
            }
        }

        .code-editor-wrapper {
            flex: 1;
            position: relative;
            overflow: hidden;
        }

        .code-highlight,
        .code-textarea {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            margin: 0;
            padding: 12px;
            font-family: inherit;
            font-size: inherit;
            line-height: inherit;
            white-space: pre-wrap;
            word-wrap: break-word;
            overflow-wrap: break-word;
            overflow: auto;
        }

        .code-highlight {
            pointer-events: none;
            background: transparent;
            color: #d4d4d4;
            
            code {
                display: block;
                background: transparent;
            }
        }

        .code-textarea {
            width: 100%;
            height: 100%;
            min-height: 200px;
            resize: none;
            background: transparent;
            color: transparent;
            caret-color: #fff;
            border: none;
            outline: none;
            
            &::placeholder {
                color: #6c757d;
            }
        }

        /* PrismJS Theme - VS Code Dark+ inspired */
        :host ::ng-deep {
            .token.comment,
            .token.prolog,
            .token.doctype,
            .token.cdata {
                color: #6a9955;
            }

            .token.punctuation {
                color: #808080;
            }

            .token.property,
            .token.tag,
            .token.boolean,
            .token.number,
            .token.constant,
            .token.symbol {
                color: #569cd6;
            }

            .token.selector,
            .token.attr-name,
            .token.string,
            .token.char,
            .token.builtin {
                color: #ce9178;
            }

            .token.operator,
            .token.entity,
            .token.url {
                color: #d4d4d4;
            }

            .token.atrule,
            .token.attr-value,
            .token.keyword {
                color: #c586c0;
            }

            .token.function {
                color: #dcdcaa;
            }

            .token.regex,
            .token.important,
            .token.variable {
                color: #d16969;
            }
        }
    `],
})
export class HtmlCodeEditorComponent implements AfterViewInit, OnChanges {
    @Input() content: string = '';
    @Input() placeholder: string = '<html>...</html>';
    @Input() height: string = '300px';
    @Input() showLineNumbers: boolean = true;
    @Output() contentChange = new EventEmitter<string>();

    @ViewChild('codeTextarea') codeTextarea!: ElementRef<HTMLTextAreaElement>;
    @ViewChild('codeHighlight') codeHighlight!: ElementRef<HTMLPreElement>;
    @ViewChild('lineNumbers') lineNumbersEl!: ElementRef<HTMLDivElement>;

    highlightedCode = signal<string>('');
    lineCount = signal<number[]>([1]);

    ngAfterViewInit(): void {
        this.updateHighlight();
    }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['content']) {
            this.updateHighlight();
        }
    }

    onInput(event: Event): void {
        const textarea = event.target as HTMLTextAreaElement;
        this.content = textarea.value;
        this.contentChange.emit(this.content);
        this.updateHighlight();
    }

    onKeyDown(event: KeyboardEvent): void {
        const textarea = event.target as HTMLTextAreaElement;

        // Handle Tab key - insert spaces instead of tab
        if (event.key === 'Tab') {
            event.preventDefault();
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const spaces = '  ';

            this.content = this.content.substring(0, start) + spaces + this.content.substring(end);
            this.contentChange.emit(this.content);

            // Update textarea and cursor position
            setTimeout(() => {
                textarea.value = this.content;
                textarea.selectionStart = textarea.selectionEnd = start + spaces.length;
                this.updateHighlight();
            }, 0);
        }
    }

    syncScroll(event: Event): void {
        const textarea = event.target as HTMLTextAreaElement;
        if (this.codeHighlight) {
            this.codeHighlight.nativeElement.scrollTop = textarea.scrollTop;
            this.codeHighlight.nativeElement.scrollLeft = textarea.scrollLeft;
        }
        if (this.lineNumbersEl) {
            this.lineNumbersEl.nativeElement.scrollTop = textarea.scrollTop;
        }
    }

    private updateHighlight(): void {
        // Use PrismJS for syntax highlighting
        const highlighted = Prism.highlight(
            this.content || '',
            Prism.languages['markup'],
            'markup'
        );
        this.highlightedCode.set(highlighted);

        // Update line count
        const lines = (this.content || '').split('\n').length;
        this.lineCount.set(Array.from({ length: lines }, (_, i) => i + 1));
    }

    /**
     * Insert text at the current cursor position.
     * This method can be called from parent components to insert placeholders, etc.
     */
    insertTextAtCursor(text: string): void {
        const textarea = this.codeTextarea?.nativeElement;
        if (!textarea) return;

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;

        this.content = this.content.substring(0, start) + text + this.content.substring(end);
        this.contentChange.emit(this.content);

        // Update textarea and cursor position
        setTimeout(() => {
            textarea.value = this.content;
            textarea.selectionStart = textarea.selectionEnd = start + text.length;
            textarea.focus();
            this.updateHighlight();
        }, 0);
    }

    /**
     * Focus the textarea
     */
    focus(): void {
        this.codeTextarea?.nativeElement?.focus();
    }
}
