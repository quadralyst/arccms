/**
 * Devices a person has signed in on (specs/sign-in-pin-spec.md, "Ask for a code on a
 * new device"). With the setting on, a PIN signs in only on a device the person has
 * proved before with a code by email or SMS, so a PIN seen over someone's shoulder
 * is no use anywhere else.
 *
 * Each browser makes a random device key once and keeps it (src/app/core/sign-in/device-key.ts).
 * The server keeps only its hash, in `auth_devices/<uid>`, closed to every browser:
 * at most MAX_DEVICES per person, the least recently used dropped first, and one
 * unused for a year forgotten. Forgot PIN forgets them all; deleting the account
 * deletes the list.
 */
import { createHash } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';

export const AUTH_DEVICES = 'auth_devices';
export const MAX_DEVICES = 10;
export const DEVICE_UNUSED_MS = 365 * 24 * 60 * 60 * 1000;

const KEY = /^[A-Za-z0-9_-]{32,128}$/;

interface Device {
    hash: string;
    addedAt: number;
    usedAt: number;
}

/** A device key the browser sent, or null when it sent none or one that is not a key. */
export function readDeviceKey(raw: unknown): string | null {
    return typeof raw === 'string' && KEY.test(raw) ? raw : null;
}

function deviceHash(key: string): string {
    return createHash('sha256').update(key).digest('hex');
}

/** The person's devices still remembered: none unused for a year. */
function devicesOf(data: Record<string, unknown> | undefined, now: number): Device[] {
    const list = Array.isArray(data?.['devices']) ? (data!['devices'] as Device[]) : [];
    return list.filter((d) => typeof d?.hash === 'string' && now - Number(d.usedAt ?? 0) < DEVICE_UNUSED_MS);
}

const ref = (uid: string) => db.collection(AUTH_DEVICES).doc(uid);

/** Whether this device was proved for this person before; a known one is marked used now. */
export async function knownDevice(uid: string, key: string | null): Promise<boolean> {
    if (!key) return false;
    const hash = deviceHash(key);
    const now = Date.now();
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref(uid));
        const devices = devicesOf(snap.data(), now);
        const found = devices.find((d) => d.hash === hash);
        if (!found) return false;
        found.usedAt = now;
        tx.set(ref(uid), { uid, devices, updatedAt: Timestamp.fromMillis(now) });
        return true;
    });
}

/** Remember this device for this person (after a code, a sign-up, or while signed in). Does nothing without a key. */
export async function rememberDevice(uid: string, key: string | null): Promise<void> {
    if (!key) return;
    const hash = deviceHash(key);
    const now = Date.now();
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref(uid));
        const devices = devicesOf(snap.data(), now);
        const addedAt = devices.find((d) => d.hash === hash)?.addedAt ?? now;
        const kept = devices.filter((d) => d.hash !== hash).sort((a, b) => b.usedAt - a.usedAt).slice(0, MAX_DEVICES - 1);
        tx.set(ref(uid), { uid, devices: [{ hash, addedAt, usedAt: now }, ...kept], updatedAt: Timestamp.fromMillis(now) });
    });
}

/** Forget every device of this person (Forgot PIN: whoever had the old PIN starts again with a code). */
export async function forgetDevices(uid: string): Promise<void> {
    await ref(uid).delete();
}

/** The refusal for a PIN tried on a device not proved yet: the page asks for a code, then the PIN again. */
export function newDeviceRefusal(): HttpsError {
    return new HttpsError('failed-precondition', 'Confirm this device with a code first.', { reason: 'new-device' });
}
