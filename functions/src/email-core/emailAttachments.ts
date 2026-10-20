import { storage } from '../init.js';
import { arcStorageBucket, arcStoragePrefix } from '../arc-config.js';

/**
 * Files an email carries (specs/app-email-spec.md, AE-D8). They are kept in Storage
 * beside the log, not in the log itself (a Firestore document holds at most 1 MB):
 * each log has its own copy under `{storagePrefix}email-logs/{logId}/`, read again by
 * every send attempt and deleted with the log when it is purged. Storage rules let
 * admins read them and nobody write them from a browser.
 */

/** At most this many files on one email. */
export const MAX_ATTACHMENTS = 10;
/** At most this many bytes in all, after decoding, on one email: 5 MB. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
/** The Storage folder, under the install's prefix, that holds the files of each log. */
export const EMAIL_LOG_FILES_FOLDER = 'email-logs';

/** A file to attach, as the app gives it. */
export interface EmailAttachmentInput {
  /** The file name the recipient sees, such as `sales.csv`. */
  name: string;
  /** Its media type, such as `text/csv` or `application/pdf`. */
  contentType: string;
  /** Text (sent as UTF-8), bytes (a Buffer or Uint8Array), or base64 text with `encoding: 'base64'`. */
  content: string | Uint8Array;
  encoding?: 'utf8' | 'base64';
}

/** A file checked and ready to store. */
export interface PreparedAttachment {
  name: string;
  contentType: string;
  size: number;
  bytes: Buffer;
}

/** A file as the log lists it. `path` is set once it is stored; a blocked send stores none. */
export interface StoredAttachment {
  name: string;
  contentType: string;
  size: number;
  path?: string;
}

const CONTENT_TYPE = /^[\w.+-]+\/[\w.+-]+(\s*;\s*[\w-]+=[\w."-]+)*$/;

/** A file name safe for a Storage path and a mail header: no folders, no control characters. */
function cleanName(name: unknown): string {
  return typeof name === 'string'
    ? name.replace(/[\u0000-\u001f\u007f/\\]/g, '').replace(/^\.+/, '').trim().slice(0, 120)
    : '';
}

/** Check the app's files and read them into bytes. Throws, saying what to fix, when one is wrong or they are too big. */
export function prepareAttachments(input: unknown): PreparedAttachment[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw new Error('sendAppEmail: attachments must be a list of { name, contentType, content }.');
  if (input.length > MAX_ATTACHMENTS) throw new Error(`sendAppEmail: at most ${MAX_ATTACHMENTS} attachments on one email.`);
  let total = 0;
  const prepared = input.map((file: Partial<EmailAttachmentInput> | undefined, i): PreparedAttachment => {
    const name = cleanName(file?.name);
    if (!name) throw new Error(`sendAppEmail: attachment ${i + 1} needs a file name, such as 'sales.csv'.`);
    const contentType = typeof file?.contentType === 'string' ? file.contentType.trim() : '';
    if (!CONTENT_TYPE.test(contentType)) throw new Error(`sendAppEmail: attachment '${name}' needs a media type, such as 'text/csv'.`);
    const content = file?.content;
    let bytes: Buffer;
    if (typeof content === 'string') bytes = Buffer.from(content, file?.encoding === 'base64' ? 'base64' : 'utf8');
    // isView, not instanceof: a Buffer from another realm (a test runner) is still bytes.
    else if (ArrayBuffer.isView(content)) bytes = Buffer.from(content.buffer, content.byteOffset, content.byteLength);
    else throw new Error(`sendAppEmail: attachment '${name}' needs its content, as text or bytes.`);
    total += bytes.length;
    return { name, contentType, size: bytes.length, bytes };
  });
  if (total > MAX_ATTACHMENT_BYTES) {
    throw new Error(`sendAppEmail: the attachments come to ${(total / 1024 / 1024).toFixed(1)} MB; one email carries at most 5 MB.`);
  }
  return prepared;
}

function bucket() {
  const name = arcStorageBucket();
  return name ? storage.bucket(name) : storage.bucket();
}

/** The Storage folder of one log's files. */
export function emailLogFolder(logId: string): string {
  return `${arcStoragePrefix()}${EMAIL_LOG_FILES_FOLDER}/${logId}/`;
}

/** The files as a blocked log lists them: names, types and sizes, nothing stored. */
export function listedAttachments(files: PreparedAttachment[]): StoredAttachment[] {
  return files.map(({ name, contentType, size }) => ({ name, contentType, size }));
}

/** Store the files beside log `logId`, before the log is written, so a send never runs ahead of them. */
export async function storeAttachments(logId: string, files: PreparedAttachment[]): Promise<StoredAttachment[]> {
  const folder = emailLogFolder(logId);
  return Promise.all(files.map(async (file, i) => {
    const path = `${folder}${i + 1}-${file.name}`;
    await bucket().file(path).save(file.bytes, { contentType: file.contentType, resumable: false });
    return { name: file.name, contentType: file.contentType, size: file.size, path };
  }));
}

/** Read a log's files for a send. Throws when one is missing, so the send is retried or fails. */
export async function loadAttachments(files: StoredAttachment[] | undefined): Promise<Array<{ filename: string; contentType: string; content: Buffer }>> {
  const stored = (files ?? []).filter((f) => f.path);
  return Promise.all(stored.map(async (f) => {
    const [content] = await bucket().file(f.path as string).download();
    return { filename: f.name, contentType: f.contentType, content };
  }));
}

/** Delete the files of logs being purged. A failure is logged, never thrown: the purge goes on. */
export async function deleteEmailLogFiles(logs: Array<{ id: string; data: Record<string, unknown> }>): Promise<void> {
  const withFiles = logs.filter((l) => Array.isArray(l.data['attachments']) && (l.data['attachments'] as StoredAttachment[]).some((f) => f.path));
  await Promise.all(withFiles.map(async (l) => {
    try {
      await bucket().deleteFiles({ prefix: emailLogFolder(l.id) });
    } catch (err) {
      console.error(`deleteEmailLogFiles: could not delete the files of ${l.id}`, err);
    }
  }));
}
