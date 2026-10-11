import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { FileHandlerExtension, FileHandlerKey, FileHandlerOptions, htmlHasText } from './file-handler-extension';

/**
 * A file dropped or pasted into the rich text editor. An image must go to the
 * media library and in by URL, never into the content as a data URL.
 */

type Uploader = NonNullable<FileHandlerOptions['uploadImage']>;

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function imageFile(name = 'photo.jpg', type = 'image/jpeg'): File {
    return new File([new Uint8Array([1, 2, 3])], name, { type });
}

describe('FileHandlerExtension', () => {
    let editor: Editor;
    let uploadImage: ReturnType<typeof vi.fn<Uploader>>;
    let onUploadError: ReturnType<typeof vi.fn<FileHandlerOptions['onUploadError']>>;
    let readAsDataURL: ReturnType<typeof vi.spyOn>;

    function makeEditor(options: Partial<FileHandlerOptions>) {
        // The extension brings its own image node.
        editor = new Editor({
            element: document.createElement('div'),
            content: '<p>Hello world</p>',
            extensions: [StarterKit, FileHandlerExtension.configure(options)],
        });
        // jsdom has no layout, so a drop point cannot be resolved; put it after "Hello".
        vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: 6, inside: -1 });
    }

    function drop(files: File[]): { handled: boolean; preventDefault: ReturnType<typeof vi.fn> } {
        const preventDefault = vi.fn();
        const event = { dataTransfer: { files }, clientX: 10, clientY: 10, preventDefault } as unknown as DragEvent;
        const handler = FileHandlerKey.get(editor.state)!.props.handleDOMEvents!.drop!;
        const handled = handler.call(FileHandlerKey.get(editor.state)!, editor.view, event) as boolean;
        return { handled, preventDefault };
    }

    function paste(files: File[], html = ''): boolean {
        const event = {
            clipboardData: { files, getData: (type: string) => (type === 'text/html' ? html : '') },
            preventDefault: vi.fn(),
        } as unknown as ClipboardEvent;
        const handler = FileHandlerKey.get(editor.state)!.props.handleDOMEvents!.paste!;
        return handler.call(FileHandlerKey.get(editor.state)!, editor.view, event) as boolean;
    }

    const placeholders = () => Array.from(editor.view.dom.querySelectorAll('.arc-image-uploading'));
    const images = () => Array.from(editor.view.dom.querySelectorAll('img')).map((img) => img.getAttribute('src'));

    beforeEach(() => {
        uploadImage = vi.fn<Uploader>();
        onUploadError = vi.fn();
        readAsDataURL = vi.spyOn(FileReader.prototype, 'readAsDataURL');
    });

    afterEach(() => {
        editor?.destroy();
        vi.restoreAllMocks();
    });

    it('uploads a dropped image, shows a placeholder with progress, then inserts the uploaded URL', async () => {
        const upload = deferred<string>();
        let progress!: (percent: number) => void;
        uploadImage.mockImplementation((_file, onProgress) => {
            progress = onProgress;
            return upload.promise;
        });
        makeEditor({ uploadImage, onUploadError, uploadingLabel: (file, percent) => `Uploading ${file.name} ${Math.round(percent)}%` });
        const file = imageFile();

        const { handled, preventDefault } = drop([file]);

        expect(handled).toBe(true);
        expect(preventDefault).toHaveBeenCalled();
        expect(uploadImage).toHaveBeenCalledWith(file, expect.any(Function));
        expect(placeholders()).toHaveLength(1);
        expect(placeholders()[0].textContent).toBe('Uploading photo.jpg 0%');
        // The placeholder is a decoration: it never reaches the saved content.
        expect(editor.getHTML()).toBe('<p>Hello world</p>');

        progress(42.4);
        expect(placeholders()[0].textContent).toBe('Uploading photo.jpg 42%');

        upload.resolve('https://storage.example/mediaImages%2Fphoto-abc123-m.webp?alt=media');
        await flush();

        expect(placeholders()).toHaveLength(0);
        expect(images()).toEqual(['https://storage.example/mediaImages%2Fphoto-abc123-m.webp?alt=media']);
        expect(editor.getHTML()).not.toContain('data:');
        expect(readAsDataURL).not.toHaveBeenCalled();
        expect(onUploadError).not.toHaveBeenCalled();
    });

    it('uploads a pasted image at the cursor', async () => {
        uploadImage.mockResolvedValue('https://storage.example/pasted-m.webp');
        makeEditor({ uploadImage, onUploadError });
        editor.commands.setTextSelection(1);

        expect(paste([imageFile('screenshot.png', 'image/png')])).toBe(true);
        await flush();

        expect(images()).toEqual(['https://storage.example/pasted-m.webp']);
        expect(editor.getHTML()).not.toContain('data:');
        expect(readAsDataURL).not.toHaveBeenCalled();
    });

    it('removes the placeholder and reports the error when the upload fails, inserting nothing', async () => {
        const error = new Error('File size (9.0 MB) exceeds the maximum allowed size (5 MB).');
        uploadImage.mockRejectedValue(error);
        makeEditor({ uploadImage, onUploadError });
        const file = imageFile('huge.jpg');

        drop([file]);
        await flush();

        expect(placeholders()).toHaveLength(0);
        expect(images()).toEqual([]);
        expect(onUploadError).toHaveBeenCalledWith(file, error);
        expect(editor.getHTML()).toBe('<p>Hello world</p>');
        expect(readAsDataURL).not.toHaveBeenCalled();
    });

    it('reports an image type the library refuses and inserts nothing', async () => {
        const error = new Error('Invalid file type. Allowed types: JPEG, PNG, WebP, GIF.');
        uploadImage.mockRejectedValue(error);
        makeEditor({ uploadImage, onUploadError });
        const file = imageFile('vector.svg', 'image/svg+xml');

        drop([file]);
        await flush();

        expect(onUploadError).toHaveBeenCalledWith(file, error);
        expect(editor.getHTML()).not.toContain('<img');
    });

    it('never inlines an image when no uploader is configured', async () => {
        makeEditor({});

        const { handled, preventDefault } = drop([imageFile()]);
        paste([imageFile()]);
        await flush();

        // Still handled, so the browser does not open the file instead.
        expect(handled).toBe(true);
        expect(preventDefault).toHaveBeenCalled();
        expect(editor.getHTML()).toBe('<p>Hello world</p>');
        expect(readAsDataURL).not.toHaveBeenCalled();
    });

    it('uploads several dropped images one at a time and keeps their order', async () => {
        const first = deferred<string>();
        const second = deferred<string>();
        uploadImage.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        makeEditor({ uploadImage, onUploadError });

        drop([imageFile('one.jpg'), imageFile('two.png', 'image/png')]);
        expect(placeholders()).toHaveLength(2);
        expect(uploadImage).toHaveBeenCalledTimes(1);

        first.resolve('https://storage.example/one-m.webp');
        await flush();
        expect(uploadImage).toHaveBeenCalledTimes(2);
        expect(placeholders()).toHaveLength(1);

        second.resolve('https://storage.example/two-m.webp');
        await flush();
        expect(images()).toEqual(['https://storage.example/one-m.webp', 'https://storage.example/two-m.webp']);
    });

    it('drops the image if the admin deleted its placeholder while it uploaded', async () => {
        const upload = deferred<string>();
        uploadImage.mockReturnValue(upload.promise);
        makeEditor({ uploadImage, onUploadError });

        drop([imageFile()]);
        editor.commands.setContent('<p>Something else</p>');
        upload.resolve('https://storage.example/late-m.webp');
        await flush();

        expect(editor.getHTML()).toBe('<p>Something else</p>');
    });

    it('does nothing once the editor is gone', async () => {
        const upload = deferred<string>();
        uploadImage.mockReturnValue(upload.promise);
        makeEditor({ uploadImage, onUploadError });

        drop([imageFile()]);
        editor.destroy();
        upload.resolve('https://storage.example/late-m.webp');
        await flush();

        expect(onUploadError).not.toHaveBeenCalled();
    });

    it('uploads a dropped document to Files and puts in a file card (MF-D20)', async () => {
        const upload = deferred<{ url: string; title: string; type: 'pdf'; bytes: number; pages: number }>();
        const uploadDocument = vi.fn(() => upload.promise);
        makeEditor({ uploadImage, uploadDocument, onUploadError });

        drop([new File(['%PDF'], 'brochure.pdf', { type: 'application/pdf' })]);
        expect(uploadImage).not.toHaveBeenCalled();
        expect(uploadDocument).toHaveBeenCalledTimes(1);
        expect(placeholders()).toHaveLength(1);

        upload.resolve({ url: 'https://storage.example/brochure.pdf', title: 'Brochure', type: 'pdf', bytes: 2048, pages: 3 });
        await flush();

        expect(placeholders()).toHaveLength(0);
        const html = editor.getHTML();
        expect(html).toContain('class="arc-file" data-arc-file="pdf"');
        expect(html).toContain('href="https://storage.example/brochure.pdf"');
        expect(html).toContain('<span class="arc-file-title">Brochure</span>');
        expect(editor.getText()).not.toContain('[File:');
    });

    it('refuses a file that is neither an image nor a document, and never puts its name in the text', () => {
        const onUnsupported = vi.fn();
        const uploadDocument = vi.fn();
        makeEditor({ uploadImage, uploadDocument, onUploadError, onUnsupported });

        drop([new File(['<html>'], 'page.html', { type: 'text/html' })]);

        expect(onUnsupported).toHaveBeenCalledWith(expect.objectContaining({ name: 'page.html' }));
        expect(uploadImage).not.toHaveBeenCalled();
        expect(uploadDocument).not.toHaveBeenCalled();
        expect(editor.getText()).not.toContain('page.html');
    });

    it('uploads nothing into a read-only editor', () => {
        makeEditor({ uploadImage, onUploadError });
        editor.setEditable(false);

        expect(drop([imageFile()]).handled).toBe(false);
        expect(paste([imageFile()])).toBe(false);
        expect(uploadImage).not.toHaveBeenCalled();
    });

    it('lets a drop with no files through (text, or an image moved inside the editor)', () => {
        makeEditor({ uploadImage, onUploadError });
        expect(drop([]).handled).toBe(false);
    });

    it('lets a paste with words in it through, even with a picture of them on the clipboard', () => {
        makeEditor({ uploadImage, onUploadError });

        expect(paste([imageFile('cells.png', 'image/png')], '<table><tr><td>Revenue</td></tr></table>')).toBe(false);
        expect(uploadImage).not.toHaveBeenCalled();
    });

    it('uploads a pasted image whose HTML is only the image', async () => {
        uploadImage.mockResolvedValue('https://storage.example/copied-m.webp');
        makeEditor({ uploadImage, onUploadError });

        expect(paste([imageFile()], '<meta charset="utf-8"><img src="https://elsewhere.example/a.jpg">')).toBe(true);
        await flush();
        expect(images()).toEqual(['https://storage.example/copied-m.webp']);
    });
});

describe('htmlHasText', () => {
    it('is false for nothing, or for an image alone', () => {
        expect(htmlHasText(undefined)).toBe(false);
        expect(htmlHasText('')).toBe(false);
        expect(htmlHasText('<img src="x.png">')).toBe(false);
    });

    it('is true when there are words', () => {
        expect(htmlHasText('<p>Hello</p><img src="x.png">')).toBe(true);
    });
});
