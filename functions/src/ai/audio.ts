/**
 * What Arc reads of the audio a speech model makes (specs/ai-media-spec.md, AM-D6, AM-D9):
 * its length in seconds, for the answer and the record. Read from the bytes, never by
 * decoding them; an MP3's length is worked out from its first frame, so a file of varying
 * bit rate is about right, not exact.
 */

const MP3_BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MP3_BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const MP3_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** Where an MP3's audio starts: after an ID3v2 tag, when there is one. */
function id3End(bytes: Buffer): number {
    if (bytes.length < 10 || bytes.toString('latin1', 0, 3) !== 'ID3') return 0;
    const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
    return 10 + size + (bytes[5] & 0x10 ? 10 : 0);
}

/** An MP3's length from its first frame's bit rate, to a tenth of a second; null when it is not one Arc can read. */
export function mp3Seconds(bytes: Buffer): number | null {
    let i = id3End(bytes);
    const end = Math.min(bytes.length - 4, i + 64 * 1024);
    for (; i < end; i++) {
        if (bytes[i] !== 0xff || (bytes[i + 1] & 0xe0) !== 0xe0) continue;
        const version = (bytes[i + 1] >> 3) & 0x03; // 3: MPEG 1, 2: MPEG 2, 0: MPEG 2.5
        const layer = (bytes[i + 1] >> 1) & 0x03; // 1: layer III
        if (version === 1 || layer !== 1) continue;
        const kbps = (version === 3 ? MP3_BITRATES_V1_L3 : MP3_BITRATES_V2_L3)[(bytes[i + 2] >> 4) & 0x0f];
        const rate = MP3_RATES[version]?.[(bytes[i + 2] >> 2) & 0x03];
        if (!kbps || !rate) continue;
        return Math.round(((bytes.length - i) * 8) / (kbps * 1000) * 10) / 10;
    }
    return null;
}

/** A WAV's length from its header, to a tenth of a second; null when it is not one Arc can read. */
export function wavSeconds(bytes: Buffer): number | null {
    if (bytes.length < 44 || bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WAVE') return null;
    let byteRate = 0;
    for (let at = 12; at + 8 <= bytes.length;) {
        const id = bytes.toString('latin1', at, at + 4);
        const size = bytes.readUInt32LE(at + 4);
        if (id === 'fmt ' && at + 20 <= bytes.length) byteRate = bytes.readUInt32LE(at + 16);
        if (id === 'data') {
            if (!byteRate) return null;
            // A streamed WAV may give 0 or 0xFFFFFFFF as its size: count what is there.
            const data = size && size !== 0xffffffff ? Math.min(size, bytes.length - at - 8) : bytes.length - at - 8;
            return Math.round((data / byteRate) * 10) / 10;
        }
        at += 8 + size + (size % 2);
    }
    return null;
}

/** The length of speech by its type, or undefined when it cannot be read. */
export function audioSeconds(bytes: Buffer, mimeType: string): number | undefined {
    const seconds = mimeType === 'audio/mpeg' ? mp3Seconds(bytes) : mimeType === 'audio/wav' ? wavSeconds(bytes) : null;
    return seconds && seconds > 0 ? seconds : undefined;
}

/** The MIME type Arc saves a speech format as. */
export function speechMime(format: 'mp3' | 'wav' | 'opus'): string {
    return format === 'wav' ? 'audio/wav' : format === 'opus' ? 'audio/ogg' : 'audio/mpeg';
}
