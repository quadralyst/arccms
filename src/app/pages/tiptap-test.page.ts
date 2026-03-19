import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import TiptapEditorComponent from '../../shared/components/tiptap-editor/tiptap-editor.component';

@Component({
  selector: 'app-tiptap-test-page',
  standalone: true,
  imports: [CommonModule, FormsModule, TiptapEditorComponent],
  template: `
    <div class="notion-container">
      <!-- Header -->
      <header class="notion-header">
        <div class="header-content">
          <h1 class="page-title">Welcome to <span class="highlight">Notion-like</span> template ✨</h1>
        </div>
      </header>

      <!-- Main Content -->
      <main class="notion-main">
        <div class="editor-wrapper">
          <!-- Instructions -->
          <div class="instructions">
            <p class="instruction-text">
              <span class="emoji">💡</span> 
              <strong>Tip:</strong> Select text to see the floating toolbar. 
              Type <kbd>/</kbd> to open the command menu.
            </p>
          </div>

          <!-- TipTap Editor -->
          <div class="notion-editor-container">
            <app-tiptap-editor
              [productValue]="editorContent"
              (textEditorContent)="onContentChange($event)"
            ></app-tiptap-editor>
          </div>

          <!-- Quick Actions -->
          <div class="quick-actions">
            <button class="action-btn" (click)="setSampleContent()">
              📝 Load Sample
            </button>
            <button class="action-btn secondary" (click)="clearContent()">
              🗑️ Clear
            </button>
          </div>
        </div>

        <!-- Preview Panel (collapsible) -->
        <details class="preview-panel">
          <summary class="preview-header">📄 View Raw HTML</summary>
          <pre class="html-preview">{{ editorContent }}</pre>
        </details>
      </main>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      min-height: 100vh;
      background: linear-gradient(135deg, #fdfbfb 0%, #ebedee 100%);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    .notion-container {
      max-width: 900px;
      margin: 0 auto;
      padding: 2rem;
    }

    .notion-header {
      margin-bottom: 2rem;
    }

    .page-title {
      font-size: 2.5rem;
      font-weight: 700;
      color: #37352f;
      margin: 0;
    }

    .highlight {
      background: linear-gradient(120deg, #f6d365 0%, #fda085 100%);
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .notion-main {
      background: white;
      border-radius: 16px;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
      overflow: hidden;
    }

    .editor-wrapper {
      padding: 2rem;
    }

    .instructions {
      margin-bottom: 1.5rem;
      padding: 1rem 1.25rem;
      background: linear-gradient(135deg, #3c76f5 0%, #1d47a3 100%);
      border-radius: 12px;
      color: white;
    }

    .instruction-text {
      margin: 0;
      font-size: 0.95rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .emoji {
      font-size: 1.25rem;
    }

    kbd {
      background: rgba(255, 255, 255, 0.2);
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      font-family: monospace;
      font-size: 0.9rem;
    }

    .notion-editor-container {
      min-height: 400px;
      border: 2px solid #e8e8e8;
      border-radius: 12px;
      overflow: hidden;
      transition: border-color 0.2s ease;
    }

    .notion-editor-container:focus-within {
      border-color: #2383e2;
      box-shadow: 0 0 0 3px rgba(35, 131, 226, 0.1);
    }

    .quick-actions {
      display: flex;
      gap: 0.75rem;
      margin-top: 1.5rem;
    }

    .action-btn {
      padding: 0.75rem 1.25rem;
      border: none;
      border-radius: 8px;
      font-size: 0.9rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
      background: linear-gradient(135deg, #3c76f5 0%, #1d47a3 100%);
      color: white;
    }

    .action-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(60, 118, 245, 0.4);
    }

    .action-btn.secondary {
      background: #f1f1f1;
      color: #37352f;
    }

    .action-btn.secondary:hover {
      background: #e5e5e5;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .preview-panel {
      border-top: 1px solid #e8e8e8;
    }

    .preview-header {
      padding: 1rem 2rem;
      cursor: pointer;
      font-weight: 500;
      color: #6b6b6b;
      user-select: none;
    }

    .preview-header:hover {
      background: #f9f9f9;
    }

    .html-preview {
      margin: 0;
      padding: 1.5rem 2rem;
      background: #1e1e1e;
      color: #9cdcfe;
      font-size: 0.85rem;
      overflow-x: auto;
      max-height: 300px;
      font-family: 'Fira Code', 'Monaco', monospace;
    }

    /* Notion-like editor styles */
    ::ng-deep .ProseMirror {
      padding: 1.5rem !important;
      min-height: 350px;
      outline: none;
      font-size: 1rem;
      line-height: 1.7;
      color: #37352f;
    }

    ::ng-deep .ProseMirror h1 {
      font-size: 2rem;
      font-weight: 700;
      margin-top: 2rem;
      margin-bottom: 0.5rem;
    }

    ::ng-deep .ProseMirror h2 {
      font-size: 1.5rem;
      font-weight: 600;
      margin-top: 1.5rem;
      margin-bottom: 0.5rem;
    }

    ::ng-deep .ProseMirror h3 {
      font-size: 1.25rem;
      font-weight: 600;
      margin-top: 1.25rem;
      margin-bottom: 0.5rem;
    }

    ::ng-deep .ProseMirror p {
      margin-bottom: 0.75rem;
    }

    ::ng-deep .ProseMirror blockquote {
      border-left: 3px solid #37352f;
      padding-left: 1rem;
      margin: 1rem 0;
      color: #6b6b6b;
    }

    ::ng-deep .ProseMirror ul,
    ::ng-deep .ProseMirror ol {
      padding-left: 1.5rem;
      margin: 0.5rem 0;
    }

    ::ng-deep .ProseMirror code {
      background: rgba(135, 131, 120, 0.15);
      padding: 0.2rem 0.4rem;
      border-radius: 3px;
      font-family: 'SFMono-Regular', Consolas, monospace;
      font-size: 0.9em;
      color: #eb5757;
    }

    ::ng-deep .ProseMirror pre {
      background: #1e1e1e;
      color: #d4d4d4;
      padding: 1rem;
      border-radius: 8px;
      overflow-x: auto;
      margin: 1rem 0;
    }

    ::ng-deep .ProseMirror pre code {
      background: none;
      color: inherit;
      padding: 0;
    }

    /* Bubble menu styling */
    ::ng-deep .bubble_menu {
      background: white !important;
      border-radius: 8px !important;
      box-shadow: 0 2px 16px rgba(0, 0, 0, 0.12) !important;
      padding: 0.5rem !important;
    }

    /* Placeholder styling */
    ::ng-deep .ProseMirror p.is-empty::before {
      color: #9b9b9b;
      content: 'Start writing your thoughts here... ✏️';
      float: left;
      height: 0;
      pointer-events: none;
    }
  `]
})
export default class TiptapTestPageComponent {
  editorContent = `
    <h1>Welcome to Your Notion-like Editor 📝</h1>
    <p>This is a <strong>rich text editor</strong> that works like Notion!</p>
    <h2>Getting Started</h2>
    <p>Try some of these features:</p>
    <ul>
      <li><strong>Bold</strong>, <em>italic</em>, and <u>underline</u> text</li>
      <li>Create lists (ordered and unordered)</li>
      <li>Add <code>inline code</code> snippets</li>
    </ul>
    <blockquote>💡 Pro tip: Select text to see the floating toolbar, or type <strong>/</strong> to open the command menu!</blockquote>
    <h2>Markdown Support</h2>
    <p>You can also use markdown shortcuts:</p>
    <ul>
      <li><code># </code> for headings</li>
      <li><code>- </code> for bullet lists</li>
      <li><code>> </code> for quotes</li>
    </ul>
  `;

  onContentChange(content: string): void {
    this.editorContent = content;
  }

  setSampleContent(): void {
    this.editorContent = `
      <h1>Sample Document 📄</h1>
      <p>This is a sample document to demonstrate the editor's capabilities.</p>
      <h2>Features</h2>
      <ul>
        <li>Rich text formatting</li>
        <li>Floating bubble menu</li>
        <li>Slash commands</li>
        <li>Markdown shortcuts</li>
      </ul>
      <blockquote>The best way to predict the future is to create it.</blockquote>
      <p>Start editing to explore all features!</p>
    `;
  }

  clearContent(): void {
    this.editorContent = '';
  }
}
