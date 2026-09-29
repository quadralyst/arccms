/**
 * A small in-memory stand-in for the Admin SDK Firestore handle, enough for
 * callables that get, set, update, delete, run equality queries, batches and
 * transactions. Transactions apply writes at once (tests run one call at a
 * time). The test setup mocks `FieldValue.delete()` as `{ _delete: true }`,
 * which is honoured on update and merge. `fakeTimestamps` stands in for
 * `Timestamp` where code needs `toMillis()`.
 */

type Data = Record<string, unknown>;

let autoId = 0;

function isDeleteSentinel(value: unknown): boolean {
    return typeof value === 'object' && value !== null && (value as { _delete?: boolean })._delete === true;
}

/** A `Timestamp` with the parts the code under test uses. */
export class FakeTimestamp {
    constructor(private readonly ms: number) {}
    static now(): FakeTimestamp {
        return new FakeTimestamp(Date.now());
    }
    static fromMillis(ms: number): FakeTimestamp {
        return new FakeTimestamp(ms);
    }
    toMillis(): number {
        return this.ms;
    }
}

function applyFields(target: Data, fields: Data): Data {
    const next = { ...target };
    for (const [key, value] of Object.entries(fields)) {
        if (isDeleteSentinel(value)) delete next[key];
        else next[key] = value;
    }
    return next;
}

export class MemoryFirestore {
    readonly store = new Map<string, Map<string, Data>>();

    private coll(name: string): Map<string, Data> {
        if (!this.store.has(name)) this.store.set(name, new Map());
        return this.store.get(name)!;
    }

    /** Seed or read raw data in tests. */
    seed(collection: string, id: string, data: Data): void {
        this.coll(collection).set(id, { ...data });
    }

    read(collection: string, id: string): Data | undefined {
        return this.coll(collection).get(id);
    }

    all(collection: string): Array<{ id: string; data: Data }> {
        return [...this.coll(collection).entries()].map(([id, data]) => ({ id, data }));
    }

    collection(name: string) {
        const db = this;
        return {
            doc: (id?: string) => db.doc(name, id ?? `auto-${++autoId}`),
            add: async (data: Data) => {
                const ref = db.doc(name, `auto-${++autoId}`);
                await ref.set(data);
                return ref;
            },
            where: (field: string, _op: '==', value: unknown) => db.query(name, [[field, value]]),
        };
    }

    private query(name: string, filters: Array<[string, unknown]>, max = Infinity) {
        const db = this;
        const q = {
            where: (field: string, _op: '==', value: unknown) => db.query(name, [...filters, [field, value]], max),
            limit: (n: number) => db.query(name, filters, n),
            get: async () => {
                const docs = [...db.coll(name).entries()]
                    .filter(([, data]) => filters.every(([f, v]) => data[f] === v))
                    .slice(0, max)
                    .map(([id]) => db.snapshot(name, id));
                return { empty: docs.length === 0, size: docs.length, docs };
            },
        };
        return q;
    }

    private snapshot(name: string, id: string) {
        const data = this.coll(name).get(id);
        return { id, exists: data !== undefined, ref: this.doc(name, id), data: () => (data ? { ...data } : undefined) };
    }

    doc(name: string, id: string): any {
        const db = this;
        return {
            id,
            path: `${name}/${id}`,
            _name: name,
            get: async () => db.snapshot(name, id),
            set: async (data: Data, options?: { merge?: boolean }) => {
                const existing = options?.merge ? db.coll(name).get(id) ?? {} : {};
                db.coll(name).set(id, applyFields(existing, data));
            },
            create: async (data: Data) => {
                if (db.coll(name).has(id)) throw Object.assign(new Error('already exists'), { code: 6 });
                db.coll(name).set(id, applyFields({}, data));
            },
            update: async (data: Data) => {
                const existing = db.coll(name).get(id);
                if (!existing) throw Object.assign(new Error(`No document to update: ${name}/${id}`), { code: 5 });
                db.coll(name).set(id, applyFields(existing, data));
            },
            delete: async () => {
                db.coll(name).delete(id);
            },
        };
    }

    async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
        const tx = {
            get: (ref: any) => ('get' in ref && !('where' in ref) ? ref.get() : ref.get()),
            set: (ref: any, data: Data, options?: { merge?: boolean }) => void ref.set(data, options),
            create: (ref: any, data: Data) => {
                if (this.coll(ref._name).has(ref.id)) throw Object.assign(new Error('already exists'), { code: 6 });
                this.coll(ref._name).set(ref.id, applyFields({}, data));
            },
            update: (ref: any, data: Data) => void ref.update(data),
            delete: (ref: any) => void ref.delete(),
        };
        return fn(tx);
    }

    batch() {
        const ops: Array<() => Promise<void>> = [];
        return {
            set: (ref: any, data: Data, options?: { merge?: boolean }) => void ops.push(() => ref.set(data, options)),
            update: (ref: any, data: Data) => void ops.push(() => ref.update(data)),
            delete: (ref: any) => void ops.push(() => ref.delete()),
            commit: async () => {
                for (const op of ops) await op();
            },
        };
    }
}
