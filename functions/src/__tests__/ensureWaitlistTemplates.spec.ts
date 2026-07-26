/**
 * U5.5: per-form default templates that heal themselves.
 *
 * The defaults used to be created only by the `onWaitlistsCreate` trigger, so any
 * form that missed it had none — and `getEmailTemplate` then fell through to an
 * unscoped global lookup that could return a *different* form's customised
 * template. These tests pin both halves: the ensure, and the fallback that must
 * never cross forms.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { store } = vi.hoisted(() => ({ store: new Map<string, any>() }));

function docRef(path: string): any {
  return {
    path,
    get: vi.fn(async () => ({
      exists: store.has(path),
      id: path.split('/').pop(),
      data: () => store.get(path),
    })),
    set: vi.fn(async (data: any) => { store.set(path, data); }),
    update: vi.fn(async (data: any) => { store.set(path, { ...(store.get(path) || {}), ...data }); }),
  };
}

/** Minimal query engine over `store`, supporting chained equality filters. */
function collectionApi(col: string): any {
  const build = (filters: [string, any][]): any => ({
    where: (field: string, _op: string, value: any) => build([...filters, [field, value]]),
    limit: () => ({
      get: async () => {
        const docs = [...store.entries()]
          .filter(([path]) => path.startsWith(`${col}/`) && !path.slice(col.length + 1).includes('/'))
          // Document-key order, which is what an unordered Firestore limit(1) returns.
          .sort(([a], [b]) => a.localeCompare(b))
          .filter(([, data]) => filters.every(([f, v]) => data?.[f] === v))
          .map(([path]) => ({ id: path.split('/').pop(), ref: docRef(path), data: () => store.get(path) }));
        return { empty: docs.length === 0, docs, size: docs.length };
      },
    }),
  });
  return { doc: (id: string) => docRef(`${col}/${id}`), ...build([]) };
}

const batchOps: any[] = [];
vi.mock('../init', () => ({
  db: {
    collection: vi.fn((col: string) => collectionApi(col)),
    batch: vi.fn(() => ({
      set: (ref: any, data: any) => { batchOps.push([ref.path, data]); },
      commit: async () => { for (const [path, data] of batchOps) store.set(path, data); batchOps.length = 0; },
    })),
  },
}));
vi.mock('firebase-admin/firestore', () => ({
  Timestamp: { now: () => ({ __ts: true }) },
}));
vi.mock('firebase-functions/v2', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));
vi.mock('../email-core/queueEmail', () => ({ queueEmail: vi.fn() }));

const {
  ensureWaitlistTemplates, waitlistDisplayName, waitlistTemplateDocId,
  isUntouchedSystemTemplate, SUPERSEDED_WELCOME_SUBJECTS, WELCOME_SUBJECT_DEFAULT,
} = await import('../email-core/defaultTemplates.js');
const { getEmailTemplate } = await import('../utils/emailTemplateHelper.js');

const OTP = 'waitlist_verify_otp_email';
const WELCOME = 'waitlist_welcome_email';

describe('ensureWaitlistTemplates', () => {
  beforeEach(() => {
    store.clear();
    batchOps.length = 0;
    vi.clearAllMocks();
    store.set('Settings/email', { senderName: 'Arc CMS', senderEmail: 'no-reply@example.com' });
    store.set('Waitlists/form-a', { name: 'Form A' });
    store.set('Waitlists/form-b', { name: 'Form B' });
    store.set('Waitlists/form-new', { name: 'Form New' });
  });

  it('creates both per-form templates when the form has none', async () => {
    const result = await ensureWaitlistTemplates('form-a');

    expect(result.created.sort()).toEqual([OTP, WELCOME].sort());
    expect(store.has(`EmailTemplate/form-a_${OTP}`)).toBe(true);
    expect(store.has(`EmailTemplate/form-a_${WELCOME}`)).toBe(true);
  });

  it('ships an OTP template that actually carries the ##OTP## tag', async () => {
    await ensureWaitlistTemplates('form-a');

    const otp = store.get(`EmailTemplate/form-a_${OTP}`);
    expect(otp.template).toContain('##OTP##');
    expect(otp.category).toBe('transactional');
    expect(otp.isActive).toBe(true);
  });

  it("names the form in the welcome subject rather than a literal placeholder", async () => {
    await ensureWaitlistTemplates('form-a');

    const welcome = store.get(`EmailTemplate/form-a_${WELCOME}`);
    // The subject is merge-processed, so this resolves to the form's own name.
    // It used to be the literal string "Waitlist welcome email".
    expect(welcome.subject).toBe('Welcome to ##WAITLIST##');
    expect(welcome.template).toContain('##WAITLIST##');
    expect(welcome.category).toBe('marketing');
  });

  it('is idempotent — a second run creates nothing', async () => {
    await ensureWaitlistTemplates('form-a');
    const second = await ensureWaitlistTemplates('form-a');

    expect(second.created).toEqual([]);
    expect(second.skipped.sort()).toEqual([OTP, WELCOME].sort());
  });

  it('never overwrites an admin-edited template', async () => {
    store.set(`EmailTemplate/form-a_${WELCOME}`, {
      type: WELCOME, waitlistId: 'form-a', subject: 'My own subject', template: 'custom', isActive: true,
    });

    await ensureWaitlistTemplates('form-a');

    expect(store.get(`EmailTemplate/form-a_${WELCOME}`).subject).toBe('My own subject');
  });

  it('recreates a deleted template — isActive:false is the off switch, not deletion', async () => {
    await ensureWaitlistTemplates('form-a');
    store.delete(`EmailTemplate/form-a_${OTP}`);

    const result = await ensureWaitlistTemplates('form-a');

    expect(result.created).toEqual([OTP]);
  });

  it('preserves a deactivated template instead of reactivating it', async () => {
    await ensureWaitlistTemplates('form-a');
    store.set(`EmailTemplate/form-a_${OTP}`, {
      ...store.get(`EmailTemplate/form-a_${OTP}`), isActive: false,
    });

    await ensureWaitlistTemplates('form-a');

    // Turning a form's OTP off must survive the ensure, or the off switch is useless.
    expect(store.get(`EmailTemplate/form-a_${OTP}`).isActive).toBe(false);
  });

  it('does nothing without a form id', async () => {
    const result = await ensureWaitlistTemplates('');
    expect(result).toEqual({ created: [], skipped: [] });
  });

  it('refuses to seed templates for a form that does not exist', async () => {
    // requestFormOtp is public by necessity, so an unauthenticated caller can post
    // any waitlistId. Without this guard each unknown id would write two orphan
    // EmailTemplate docs — unbounded writes from an anonymous endpoint.
    const result = await ensureWaitlistTemplates('not-a-real-form');

    expect(result).toEqual({ created: [], skipped: [] });
    expect(store.has(`EmailTemplate/not-a-real-form_${OTP}`)).toBe(false);
  });

  it('marks per-form docs with scope "form" so a global lookup cannot match them', async () => {
    await ensureWaitlistTemplates('form-a');
    expect(store.get(`EmailTemplate/form-a_${OTP}`).scope).toBe('form');
  });
});

describe('getEmailTemplate', () => {
  beforeEach(() => {
    store.clear();
    batchOps.length = 0;
    vi.clearAllMocks();
    store.set('Settings/email', { senderName: 'Arc CMS', senderEmail: 'no-reply@example.com' });
    store.set('Waitlists/form-a', { name: 'Form A' });
    store.set('Waitlists/form-b', { name: 'Form B' });
  });

  it("returns the form's own template when it exists", async () => {
    store.set(`EmailTemplate/form-b_${OTP}`, {
      type: OTP, waitlistId: 'form-b', subject: 'B only', isActive: true,
    });

    const t = await getEmailTemplate('form-b', OTP);

    expect(t.subject).toBe('B only');
  });

  it('seeds the defaults and returns them when the form has no template', async () => {
    const t = await getEmailTemplate('form-b', OTP);

    expect(t.template).toContain('##OTP##');
    expect(store.has(`EmailTemplate/form-b_${OTP}`)).toBe(true);
  });

  it("must not fall back to another form's customised template", async () => {
    // The regression. Form A sorts before Form B by doc id, and per-form docs share
    // the same `type`, so the old unscoped `where('type','==',…).limit(1)` handed
    // Form A's content — and Form A's branding — to Form B's subscribers.
    store.set(`EmailTemplate/form-a_${OTP}`, {
      type: OTP, waitlistId: 'form-a', subject: "Form A's private subject", isActive: true,
    });

    // With seeding suppressed and no global template, the only correct outcome is
    // to fail — borrowing Form A's is not an acceptable substitute.
    await expect(getEmailTemplate('form-b', OTP, { ensure: false })).rejects.toThrow(
      /No email template found/,
    );
  });

  it("still isolates forms when seeding is on — Form B gets its own, not Form A's", async () => {
    store.set(`EmailTemplate/form-a_${OTP}`, {
      type: OTP, waitlistId: 'form-a', subject: "Form A's private subject", isActive: true,
    });

    const t = await getEmailTemplate('form-b', OTP);

    expect(t.waitlistId).toBe('form-b');
    expect(t.subject).not.toBe("Form A's private subject");
  });

  it('falls back only to a genuinely global template', async () => {
    store.set(`EmailTemplate/${OTP}`, {
      type: OTP, scope: 'global', subject: 'Global default', isActive: true,
    });
    store.set(`EmailTemplate/form-a_${OTP}`, {
      type: OTP, waitlistId: 'form-a', subject: "Form A's private subject", isActive: true,
    });

    const t = await getEmailTemplate('form-b', OTP, { ensure: false });

    expect(t.subject).toBe('Global default');
  });

  it('throws when nothing can be found or created', async () => {
    await expect(getEmailTemplate('form-b', OTP, { ensure: false })).rejects.toThrow(
      /No email template found/,
    );
  });
});

describe('waitlistDisplayName', () => {
  it('falls back so a "Welcome to ##WAITLIST##" subject can never render empty', () => {
    expect(waitlistDisplayName('Founding Circle')).toBe('Founding Circle');
    expect(waitlistDisplayName('  ')).toBe('our waitlist');
    expect(waitlistDisplayName('')).toBe('our waitlist');
    expect(waitlistDisplayName(null)).toBe('our waitlist');
    expect(waitlistDisplayName(undefined)).toBe('our waitlist');
  });
});

describe('waitlistTemplateDocId', () => {
  it('uses the `${formId}_${type}` scheme the admin page writes', () => {
    expect(waitlistTemplateDocId('form-a', OTP)).toBe(`form-a_${OTP}`);
  });
});

describe('the welcome-subject upgrade for already-seeded forms', () => {
  // ensureWaitlistTemplates never overwrites, so on an upgraded install every form
  // keeps the subject it was seeded with. Without an upgrade path the new default
  // would only ever reach forms created afterwards, and existing installs would go
  // on sending the literal string "Waitlist welcome email".

  beforeEach(() => {
    store.clear();
    batchOps.length = 0;
    store.set('Settings/email', { senderName: 'Arc CMS', senderEmail: 'no-reply@example.com' });
    store.set('Waitlists/form-new', { name: 'Form New' });
  });

  it('lists every subject earlier versions shipped as the default', () => {
    expect(SUPERSEDED_WELCOME_SUBJECTS).toContain('Waitlist welcome email');
    // The admin page's own copy of the default, now removed.
    expect(SUPERSEDED_WELCOME_SUBJECTS).toContain('Welcome to the waitlist!');
    expect(SUPERSEDED_WELCOME_SUBJECTS).not.toContain(WELCOME_SUBJECT_DEFAULT);
  });

  it('treats a system-seeded template as safe to upgrade', () => {
    expect(isUntouchedSystemTemplate({ createdBy: 'system', modifiedBy: 'system' })).toBe(true);
    // Older docs predate the audit fields entirely.
    expect(isUntouchedSystemTemplate({})).toBe(true);
  });

  it('refuses to upgrade anything a human has saved', () => {
    // An admin who saved this template keeps their subject, even if it happens to
    // match an old default.
    expect(isUntouchedSystemTemplate({ createdBy: 'system', modifiedBy: 'admin@example.com' })).toBe(false);
    expect(isUntouchedSystemTemplate({ createdBy: 'admin@example.com' })).toBe(false);
  });

  it('seeds new forms with the current default, so they need no upgrade', async () => {
    await ensureWaitlistTemplates('form-new');
    expect(store.get(`EmailTemplate/form-new_${WELCOME}`).subject).toBe(WELCOME_SUBJECT_DEFAULT);
  });
});
