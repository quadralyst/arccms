import { describe, expect, it } from 'vitest';
import { uploadProblem } from './media-upload-problem';

describe('uploadProblem (RF5 5.2: plain words, the detail stays in the console)', () => {
    const tooLarge = new Error('File size (6.0 MB) exceeds the maximum allowed size (5 MB).');

    it('names the size limit, with or without the file name', () => {
        expect(uploadProblem(tooLarge, 5, 'big.png')).toEqual({ key: 'admin.media.problem.too_large_named', params: { name: 'big.png', max: 5 } });
        expect(uploadProblem(tooLarge, 5)).toEqual({ key: 'admin.media.problem.too_large', params: { max: 5 } });
    });

    it('names a wrong type and a GIF that cannot be cropped', () => {
        expect(uploadProblem(new Error('Invalid file type. Allowed types: JPEG, PNG, WebP, GIF.'), 5, 'a.svg').key).toBe('admin.media.problem.type');
        expect(uploadProblem(new Error('GIFs cannot be cropped: cropping would drop the animation.'), 5).key).toBe('admin.media.problem.gif');
    });

    it('turns anything else, such as a Firebase code, into "try again"', () => {
        expect(uploadProblem(new Error('storage/unauthorized'), 5, 'a.png')).toEqual({ key: 'admin.media.problem.upload_named', params: { name: 'a.png' } });
        expect(uploadProblem('internal', 5)).toEqual({ key: 'admin.media.problem.try_again', params: {} });
    });
});
