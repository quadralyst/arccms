/**
 * U5.5: one OTP switch, not two.
 *
 * `EmailTemplate.isActive` is what the server gates on; `Waitlists.otpEnabled` is
 * what the *public form* reads to decide whether to show the code step. Only the
 * admin Templates page ever wrote the second one, so seeding a default, importing,
 * or editing a template directly left the form asking for a code that would never
 * arrive — or skipping a step the server still required.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { store } = vi.hoisted(() => ({ store: new Map<string, any>() }));

function docRef(path: string): any {
  return {
    path,
    get: vi.fn(async () => ({ exists: store.has(path), data: () => store.get(path) })),
    update: vi.fn(async (data: any) => {
      store.set(path, { ...(store.get(path) || {}), ...data });
    }),
  };
}

vi.mock('../init', () => ({
  db: { collection: vi.fn((col: string) => ({ doc: (id: string) => docRef(`${col}/${id}`) })) },
}));
vi.mock('firebase-functions/v2', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));
vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentWritten: (_path: string, handler: any) => handler,
}));

const { syncOtpEnabledFlag } = await import('../email-core/syncOtpEnabledFlag.js');

const OTP = 'waitlist_verify_otp_email';

/** Shape of a v2 written-event, with before/after snapshots. */
function event(before: any, after: any) {
  const snap = (d: any) => (d === null ? { exists: false, data: () => undefined } : { exists: true, data: () => d });
  return { data: { before: snap(before), after: snap(after) } };
}

const call = (before: any, after: any) => (syncOtpEnabledFlag as any)(event(before, after));

describe('syncOtpEnabledFlag', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
    store.set('Waitlists/form-a', { name: 'Form A' });
  });

  it('mirrors a deactivated OTP template onto the form the public page reads', async () => {
    await call(
      { type: OTP, waitlistId: 'form-a', isActive: true },
      { type: OTP, waitlistId: 'form-a', isActive: false },
    );

    expect(store.get('Waitlists/form-a').otpEnabled).toBe(false);
  });

  it('mirrors reactivation back', async () => {
    store.set('Waitlists/form-a', { name: 'Form A', otpEnabled: false });

    await call(
      { type: OTP, waitlistId: 'form-a', isActive: false },
      { type: OTP, waitlistId: 'form-a', isActive: true },
    );

    expect(store.get('Waitlists/form-a').otpEnabled).toBe(true);
  });

  it('treats a missing isActive as active, matching the public form default', async () => {
    await call(null, { type: OTP, waitlistId: 'form-a' });

    expect(store.get('Waitlists/form-a').otpEnabled).toBe(true);
  });

  it('ignores welcome templates — they do not gate the OTP step', async () => {
    await call(
      { type: 'waitlist_welcome_email', waitlistId: 'form-a', isActive: true },
      { type: 'waitlist_welcome_email', waitlistId: 'form-a', isActive: false },
    );

    expect(store.get('Waitlists/form-a').otpEnabled).toBeUndefined();
  });

  it('ignores a global template, which governs no single form', async () => {
    await call(null, { type: OTP, scope: 'global', isActive: false });

    expect(store.get('Waitlists/form-a').otpEnabled).toBeUndefined();
  });

  it('does not write when isActive did not change', async () => {
    // An unrelated edit (subject, body) must not churn the form doc and set off
    // its own update triggers.
    await call(
      { type: OTP, waitlistId: 'form-a', isActive: true, subject: 'old' },
      { type: OTP, waitlistId: 'form-a', isActive: true, subject: 'new' },
    );

    expect(store.get('Waitlists/form-a').otpEnabled).toBeUndefined();
  });

  it('ignores deletion — the default is recreated on demand', async () => {
    store.set('Waitlists/form-a', { name: 'Form A', otpEnabled: true });

    await call({ type: OTP, waitlistId: 'form-a', isActive: true }, null);

    expect(store.get('Waitlists/form-a').otpEnabled).toBe(true);
  });

  it('does nothing when the form doc is gone', async () => {
    store.delete('Waitlists/form-a');

    await expect(
      call(null, { type: OTP, waitlistId: 'form-a', isActive: false }),
    ).resolves.toBeUndefined();
    expect(store.has('Waitlists/form-a')).toBe(false);
  });
});
