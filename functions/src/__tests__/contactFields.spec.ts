/**
 * U4.5 contact custom fields: registry validation and the write policy that stops
 * one form clobbering another form's data.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { store } = vi.hoisted(() => ({ store: new Map<string, any>() }));

function docRef(path: string) {
  return {
    path,
    get: vi.fn(async () => ({ exists: store.has(path), data: () => store.get(path) })),
    set: vi.fn(async (data: any, opts?: any) => {
      const prev = store.get(path) || {};
      if (opts?.merge) {
        // Deep-merge only `fields`, which is all these helpers merge into.
        const merged = { ...prev, ...data };
        if (data.fields && prev.fields) merged.fields = { ...prev.fields, ...data.fields };
        store.set(path, merged);
      } else {
        store.set(path, data);
      }
    }),
    update: vi.fn(async (data: any) => {
      const cur = { ...(store.get(path) || {}) };
      for (const [k, v] of Object.entries(data)) {
        if (k.startsWith('fields.')) {
          cur.fields = { ...(cur.fields || {}), [k.slice('fields.'.length)]: v };
        } else {
          cur[k] = v;
        }
      }
      store.set(path, cur);
    }),
  };
}

vi.mock('../init', () => ({
  db: { collection: vi.fn((col: string) => ({ doc: (id: string) => docRef(`${col}/${id}`) })) },
}));

vi.mock('firebase-admin/firestore', () => ({
  Timestamp: { now: vi.fn(() => ({ seconds: 0, nanoseconds: 0 })) },
}));

import {
  fieldKeyFromLabel,
  validateFieldKey,
  upsertFieldDef,
  deleteFieldDef,
  setContactFields,
  getFieldRegistry,
} from '../email-core/contactFields.js';

const HASH = 'contact-1';
const REGISTRY = 'Settings/contact_fields';

function seedRegistry(fields: Record<string, any>): void {
  store.set(REGISTRY, { fields });
}

describe('contactFields', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  describe('key derivation + validation', () => {
    it('slugifies labels so one label means one field', () => {
      expect(fieldKeyFromLabel('Company')).toBe('company');
      expect(fieldKeyFromLabel('Company Name')).toBe('company_name');
      expect(fieldKeyFromLabel('  Job Title!  ')).toBe('job_title');
      // Two forms labelling it differently still land on the same key.
      expect(fieldKeyFromLabel('company')).toBe(fieldKeyFromLabel('Company'));
    });

    it('rejects labels with nothing sluggable', () => {
      expect(validateFieldKey('!!!').ok).toBe(false);
      expect(validateFieldKey('').ok).toBe(false);
    });

    it('rejects reserved keys that would shadow contact identity or consent', () => {
      for (const reserved of ['email', 'Name', 'consent', 'listIds', 'tags', 'disabled']) {
        const res = validateFieldKey(reserved);
        expect(res.ok, `${reserved} should be reserved`).toBe(false);
        expect(res.error).toMatch(/reserved/i);
      }
    });

    it('allows an ordinary business field', () => {
      expect(validateFieldKey('Company').ok).toBe(true);
    });
  });

  describe('registry CRUD', () => {
    it('creates a field with fill as the default policy', async () => {
      const key = await upsertFieldDef({ label: 'Company', type: 'text' });
      expect(key).toBe('company');
      const reg = await getFieldRegistry();
      expect(reg['company']).toMatchObject({ key: 'company', label: 'Company', type: 'text', writePolicy: 'fill' });
    });

    it('refuses a reserved key', async () => {
      await expect(upsertFieldDef({ label: 'Email', type: 'text' })).rejects.toThrow(/reserved/i);
    });

    it('editing preserves the key so existing values stay attached', async () => {
      await upsertFieldDef({ label: 'Company', type: 'text' });
      await upsertFieldDef({ key: 'company', label: 'Employer', type: 'text' });
      const reg = await getFieldRegistry();
      expect(Object.keys(reg)).toEqual(['company']);
      expect(reg['company'].label).toBe('Employer');
    });

    it('delete removes the definition', async () => {
      await upsertFieldDef({ label: 'Company', type: 'text' });
      await upsertFieldDef({ label: 'Role', type: 'text' });
      await deleteFieldDef('company');
      expect(Object.keys(await getFieldRegistry())).toEqual(['role']);
    });

    it('deleting a definition does not destroy collected values', async () => {
      seedRegistry({ company: { key: 'company', label: 'Company', type: 'text' } });
      store.set(`Contacts/${HASH}`, { email: 'a@x.com', fields: { company: 'Acme' } });

      await deleteFieldDef('company');

      expect(store.get(`Contacts/${HASH}`).fields).toEqual({ company: 'Acme' });
    });
  });

  describe('setContactFields write policy', () => {
    beforeEach(() => {
      seedRegistry({
        company: { key: 'company', label: 'Company', type: 'text', writePolicy: 'fill' },
        role: { key: 'role', label: 'Role', type: 'text', writePolicy: 'overwrite' },
      });
      store.set(`Contacts/${HASH}`, { email: 'a@x.com' });
    });

    it('writes a value when the contact has none', async () => {
      const res = await setContactFields(HASH, { company: 'Acme' });
      expect(res.written).toEqual(['company']);
      expect(store.get(`Contacts/${HASH}`).fields).toEqual({ company: 'Acme' });
    });

    it('fill policy does NOT overwrite what the contact already gave', async () => {
      // The core guarantee: a second form cannot silently replace form one's data.
      await setContactFields(HASH, { company: 'Acme' });
      const res = await setContactFields(HASH, { company: 'Other Corp' });

      expect(res.skipped).toEqual(['company']);
      expect(res.written).toEqual([]);
      expect(store.get(`Contacts/${HASH}`).fields.company).toBe('Acme');
    });

    it('overwrite policy replaces on re-submit', async () => {
      await setContactFields(HASH, { role: 'dev' });
      const res = await setContactFields(HASH, { role: 'lead' });

      expect(res.written).toEqual(['role']);
      expect(store.get(`Contacts/${HASH}`).fields.role).toBe('lead');
    });

    it('force overrides the fill policy (admin editing directly)', async () => {
      await setContactFields(HASH, { company: 'Acme' });
      const res = await setContactFields(HASH, { company: 'Admin Corp' }, { force: true });

      expect(res.written).toEqual(['company']);
      expect(store.get(`Contacts/${HASH}`).fields.company).toBe('Admin Corp');
    });

    it('reports unknown keys instead of creating junk fields', async () => {
      const res = await setContactFields(HASH, { nonsense: 'x' });
      expect(res.unknown).toEqual(['nonsense']);
      expect(store.get(`Contacts/${HASH}`).fields).toBeUndefined();
    });

    it('ignores empty values so a blank input cannot erase a real one', async () => {
      await setContactFields(HASH, { company: 'Acme' });
      await setContactFields(HASH, { company: '' }, { force: true });
      expect(store.get(`Contacts/${HASH}`).fields.company).toBe('Acme');
    });

    it('no-ops for a contact that does not exist', async () => {
      const res = await setContactFields('missing', { company: 'Acme' });
      expect(res.written).toEqual([]);
    });

    it('is idempotent — re-running the same values changes nothing', async () => {
      await setContactFields(HASH, { company: 'Acme', role: 'dev' });
      const before = JSON.stringify(store.get(`Contacts/${HASH}`).fields);
      await setContactFields(HASH, { company: 'Acme', role: 'dev' });
      expect(JSON.stringify(store.get(`Contacts/${HASH}`).fields)).toBe(before);
    });
  });
});
