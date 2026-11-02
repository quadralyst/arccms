/**
 * The files test mode answers with (specs/ai-media-spec.md, AM-D11): a grey picture of the
 * asked size, made here as a PNG; silence as a WAV, a second for every 15 characters of
 * speech, or the asked length of a sound, at most 10 seconds; and a 2-second grey video,
 * shipped below. Small, so a test site's Storage stays empty of anything that matters.
 */
import { deflateSync } from 'node:zlib';
import type { MadeFile } from './connectors/types.js';
import type { AiAspect, AiFileKind, AiImageSettings } from './types.js';

const MAX_TEST_SECONDS = 10;
const SAMPLE_RATE = 8000;

/** A 2-second grey MP4, 320 by 180 (made once with ffmpeg; about 2 KB). */
const GREY_VIDEO_BASE64 = 'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAPebW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAB9AAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAwh0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAB9AAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAUAAAAC0AAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAfQAAAIAAABAAAAAAKAbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAoAAAAUABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAACK21pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAetzdGJsAAAAw3N0c2QAAAAAAAAAAQAAALNhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAUAAtABIAAAASAAAAAAAAAABFUxhdmM2Mi4yOC4xMDIgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAAOWF2Y0MBZAAV/+EAG2dkABWscgRBQZ+fARAAAAMAEAAAAwFA8WLYRgEAB2joQ4OSyLD9+PgAAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAAAEAgAAAAAAAAAGHN0dHMAAAAAAAAAAQAAABQAAAQAAAAAFHN0c3MAAAAAAAAAAQAAAAEAAABgY3R0cwAAAAAAAAAKAAAAAQAACAAAAAABAAAoAAAAAAEAABAAAAAAAwAAAAAAAAAEAAAEAAAAAAEAACgAAAAAAQAAEAAAAAADAAAAAAAAAAQAAAQAAAAAAQAACAAAAAAcc3RzYwAAAAAAAAABAAAAAQAAABQAAAABAAAAZHN0c3oAAAAAAAAAAAAAABQAAALpAAAADwAAAA4AAAAOAAAADgAAAA4AAAAOAAAADgAAAA4AAAAOAAAAFAAAAA4AAAAOAAAADgAAAA4AAAAOAAAADgAAAA4AAAAOAAAAFgAAABRzdGNvAAAAAAAAAAEAAAQOAAAAYnVkdGEAAABabWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAtaWxzdAAAACWpdG9vAAAAHWRhdGEAAAABAAAAAExhdmY2Mi4xMi4xMDIAAAAIZnJlZQAABAptZGF0AAACsAYF//+s3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NSByMzIyMiBiMzU2MDVhIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyNSAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTE2IGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDM6MHgxMzMgbWU9dW1oIHN1Ym1lPTEwIHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MjQgY2hyb21hX21lPTEgdHJlbGxpcz0yIDh4OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9NiBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTggYl9weXJhbWlkPTIgYl9hZGFwdD0yIGJfYmlhcz0wIGRpcmVjdD0zIHdlaWdodGI9MSBvcGVuX2dvcD0wIHdlaWdodHA9MiBrZXlpbnQ9MjUwIGtleWludF9taW49MTAgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD02MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTQwLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAxZYiBAAJf/t4i/awg9QxXFesr+nKiDB4AAL4RP29BMA9KbAMAAAMBGxVAF45uacR1cQAAAAtBmgktiCP/AAAF3AAAAApBnhCHEEP/ACHhAAAACgGeGCaIb/8AMCAAAAAKAZ4YRohv/wAwIQAAAAoBnhhmiG//ADAhAAAACgGeGK1Ib/8AMCEAAAAKAZ4YzUhv/wAwIQAAAAoBnhjtSG//ADAgAAAACgGeGQ1Ib/8AMCAAAAAQQZoaSTUCAtEymBDvAAAsoQAAAApBniGlxBD/ACHgAAAACgGeKUWiG/8AMCAAAAAKAZ4pZaIb/wAwIQAAAAoBnimFohv/ADAhAAAACgGeKcySG/8AMCEAAAAKAZ4p7JIb/wAwIAAAAAoBnioMkhv/ADAgAAAACgGeKiySG/8AMCEAAAASQZoqabUCAtrRMpgBDf8AAFTA';

const ASPECT_RATIO: Record<AiAspect, number> = {
    '1:1': 1, '4:3': 4 / 3, '3:4': 3 / 4, '3:2': 3 / 2, '2:3': 2 / 3, '16:9': 16 / 9, '9:16': 9 / 16, '21:9': 21 / 9,
};

/** A picture's size from its aspect and resolution: about 1 MP standard, 4 MP high, in multiples of 8. */
export function pictureSize(image: AiImageSettings = {}): { width: number; height: number } {
    const ratio = ASPECT_RATIO[image.aspect ?? '1:1'] ?? 1;
    const pixels = image.resolution === 'high' ? 4_194_304 : 1_048_576;
    const height = Math.sqrt(pixels / ratio);
    const round8 = (n: number) => Math.max(8, Math.round(n / 8) * 8);
    return { width: round8(height * ratio), height: round8(height) };
}

let crcTable: number[] | null = null;
function crc32(bytes: Buffer): number {
    crcTable ??= Array.from({ length: 256 }, (_, n) => {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        return c >>> 0;
    });
    let crc = 0xffffffff;
    for (const b of bytes) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
}

/** A grey PNG of this size: one colour, so it packs into a few KB. */
export function greyPng(width: number, height: number): Buffer {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8; // bits per sample
    header[9] = 0; // greyscale
    const row = Buffer.alloc(width + 1, 0x80);
    row[0] = 0; // no filter
    const raw = Buffer.alloc(row.length * height);
    for (let y = 0; y < height; y++) row.copy(raw, y * row.length);
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

/** Silence as a 16-bit mono WAV. */
export function silentWav(seconds: number): Buffer {
    const samples = Math.round(seconds * SAMPLE_RATE);
    const data = Buffer.alloc(samples * 2);
    const header = Buffer.alloc(44);
    header.write('RIFF', 0, 'latin1');
    header.writeUInt32LE(36 + data.length, 4);
    header.write('WAVE', 8, 'latin1');
    header.write('fmt ', 12, 'latin1');
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(1, 22); // mono
    header.writeUInt32LE(SAMPLE_RATE, 24);
    header.writeUInt32LE(SAMPLE_RATE * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36, 'latin1');
    header.writeUInt32LE(data.length, 40);
    return Buffer.concat([header, data]);
}

/** How long test speech lasts: a second for every 15 characters, 1 to 10 seconds. */
export function testSpeechSeconds(chars: number): number {
    return Math.min(MAX_TEST_SECONDS, Math.max(1, Math.ceil(chars / 15)));
}

/** The stand-in files for one test call. */
export function standInFiles(kind: AiFileKind, settings: { image?: AiImageSettings; audioSeconds?: number; chars: number }): MadeFile[] {
    if (kind === 'image') {
        const { width, height } = pictureSize(settings.image);
        const count = Math.min(4, Math.max(1, settings.image?.count ?? 1));
        const png = greyPng(width, height);
        return Array.from({ length: count }, () => ({ bytes: png, mimeType: 'image/png', width, height }));
    }
    if (kind === 'speech') {
        const seconds = testSpeechSeconds(settings.chars);
        return [{ bytes: silentWav(seconds), mimeType: 'audio/wav', seconds }];
    }
    if (kind === 'audio') {
        const seconds = Math.min(MAX_TEST_SECONDS, Math.max(0.5, settings.audioSeconds ?? 1));
        return [{ bytes: silentWav(seconds), mimeType: 'audio/wav', seconds }];
    }
    return [{ bytes: Buffer.from(GREY_VIDEO_BASE64, 'base64'), mimeType: 'video/mp4', width: 320, height: 180, seconds: 2 }];
}
