// Minimal in-memory stand-in for the MongoDB collection methods the TRON
// sponsor uses, so its tests need no database (the relay's Mongo-backed
// suites fail without local credentials). Supports equality plus $gt / $gte /
// $lt / $lte / $in filters, $set / $unset / $setOnInsert updates, upsert and
// unique indexes (duplicate → { code: 11000 }, like the driver).

type Doc = Record<string, unknown>;

function cmp(a: unknown, b: unknown): number {
  const av = a instanceof Date ? a.getTime() : (a as number);
  const bv = b instanceof Date ? b.getTime() : (b as number);
  return av < bv ? -1 : av > bv ? 1 : 0;
}

function eq(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date)
    return a.getTime() === b.getTime();
  return a === b;
}

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([k, cond]) => {
    const v = doc[k];
    if (
      cond &&
      typeof cond === 'object' &&
      !(cond instanceof Date) &&
      !Array.isArray(cond)
    ) {
      return Object.entries(cond as Doc).every(([op, arg]) => {
        if (v === undefined) return false;
        switch (op) {
          case '$gt':
            return cmp(v, arg) > 0;
          case '$gte':
            return cmp(v, arg) >= 0;
          case '$lt':
            return cmp(v, arg) < 0;
          case '$lte':
            return cmp(v, arg) <= 0;
          case '$in':
            return (arg as unknown[]).some((x) => eq(v, x));
          default:
            throw new Error(`fakeMongo: unsupported operator ${op}`);
        }
      });
    }
    return eq(v, cond);
  });
}

function applyUpdate(doc: Doc, update: Doc, inserting: boolean): void {
  for (const [op, fields] of Object.entries(update)) {
    if (op === '$set') Object.assign(doc, fields);
    else if (op === '$unset') {
      for (const k of Object.keys(fields as Doc)) delete doc[k];
    } else if (op === '$setOnInsert') {
      if (inserting) Object.assign(doc, fields);
    } else throw new Error(`fakeMongo: unsupported update ${op}`);
  }
}

export class FakeCollection {
  docs: Doc[] = [];
  private nextId = 1;

  constructor(private readonly uniqueKeys: string[][] = []) {}

  private violatesUnique(candidate: Doc, ignore?: Doc): boolean {
    return this.uniqueKeys.some((keys) =>
      this.docs.some(
        (d) => d !== ignore && keys.every((k) => eq(d[k], candidate[k])),
      ),
    );
  }

  async findOne(filter: Doc): Promise<Doc | null> {
    const d = this.docs.find((x) => matches(x, filter));
    return d ? { ...d } : null;
  }

  find(filter: Doc) {
    let result = this.docs
      .filter((x) => matches(x, filter))
      .map((d) => ({ ...d }));
    const cursor = {
      limit(n: number) {
        result = result.slice(0, n);
        return cursor;
      },
      async toArray() {
        return result;
      },
    };
    return cursor;
  }

  async insertOne(doc: Doc) {
    const d = { _id: this.nextId++, ...doc };
    if (this.violatesUnique(d)) {
      throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    }
    this.docs.push(d);
    return { acknowledged: true, insertedId: d._id };
  }

  async updateOne(filter: Doc, update: Doc, opts: { upsert?: boolean } = {}) {
    const d = this.docs.find((x) => matches(x, filter));
    if (d) {
      applyUpdate(d, update, false);
      return { matchedCount: 1, modifiedCount: 1 };
    }
    if (opts.upsert) {
      const fresh: Doc = { _id: this.nextId++ };
      for (const [k, v] of Object.entries(filter)) {
        if (typeof v !== 'object' || v instanceof Date) fresh[k] = v;
      }
      applyUpdate(fresh, update, true);
      if (this.violatesUnique(fresh)) {
        throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
      }
      this.docs.push(fresh);
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
    }
    return { matchedCount: 0, modifiedCount: 0 };
  }

  async findOneAndUpdate(filter: Doc, update: Doc) {
    const d = this.docs.find((x) => matches(x, filter));
    if (!d) return null;
    const before = { ...d };
    applyUpdate(d, update, false);
    return before;
  }

  async deleteOne(filter: Doc) {
    const i = this.docs.findIndex((x) => matches(x, filter));
    if (i >= 0) this.docs.splice(i, 1);
    return { deletedCount: i >= 0 ? 1 : 0 };
  }

  async deleteMany(filter: Doc) {
    const before = this.docs.length;
    this.docs = this.docs.filter((x) => !matches(x, filter));
    return { deletedCount: before - this.docs.length };
  }

  async countDocuments(filter: Doc): Promise<number> {
    return this.docs.filter((x) => matches(x, filter)).length;
  }
}

/** The two TRON collections with the relay's real unique indexes. */
export function fakeTronCollections() {
  return {
    ops: new FakeCollection([['digest']]),
    reservations: new FakeCollection([['chain', 'vault', 'nonce']]),
  };
}
