/**
 * Coerce a Firestore value (Timestamp | Date | {seconds} | ISO string) into a JS
 * Date. Payment docs are written by Cloud Functions using Firestore Timestamps,
 * which arrive on the client as Timestamp objects (with `.toDate()`), so the
 * plain `Date` types on the models don't tell the whole runtime story.
 */
export function toJsDate(value: unknown): Date | null {
    if (!value) return null;
    if (value instanceof Date) return value;
    // Firestore Timestamp (has toDate())
    if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
        try {
            return (value as { toDate: () => Date }).toDate();
        } catch {
            return null;
        }
    }
    // Serialized timestamp { seconds, nanoseconds }
    const seconds = (value as { seconds?: number }).seconds;
    if (typeof seconds === 'number') return new Date(seconds * 1000);
    // ISO string / epoch millis
    if (typeof value === 'string' || typeof value === 'number') {
        const d = new Date(value);
        return isNaN(d.getTime()) ? null : d;
    }
    return null;
}
