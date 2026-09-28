import { describe, expect, it } from 'vitest';
import { audioExtension, canRecordVoice, pickAudioFormat } from './voice-recorder';

describe('voice recorder formats', () => {
    it('prefers MP4, which plays in every browser, then WebM and Ogg', () => {
        expect(pickAudioFormat(() => true)).toBe('audio/mp4');
        expect(pickAudioFormat((t) => t.startsWith('audio/webm'))).toBe('audio/webm;codecs=opus');
        expect(pickAudioFormat((t) => t.startsWith('audio/ogg'))).toBe('audio/ogg;codecs=opus');
        expect(pickAudioFormat(() => false)).toBe('');
    });

    it('names the file after what was recorded', () => {
        expect(audioExtension('audio/mp4')).toBe('mp4');
        expect(audioExtension('audio/aac')).toBe('mp4');
        expect(audioExtension('audio/webm;codecs=opus')).toBe('webm');
        expect(audioExtension('audio/ogg;codecs=opus')).toBe('ogg');
    });

    it('says no where the browser cannot record', () => {
        expect(canRecordVoice()).toBe(false); // jsdom has no MediaRecorder
    });
});
