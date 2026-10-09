// Stand-in for supabase-js for the sign-in test. Counting queries (head:true)
// return a count, everything else returns the rows the test set up.
type Row = Record<string, unknown>;
const tables = () => ((globalThis as Record<string, never>).__tables ?? {}) as Record<string, Row[]>;

const builder = (table: string, chain: string[] = []): Record<string, unknown> =>
  new Proxy({}, {
    get(_t, prop: string) {
      if (prop === "then") {
        if (chain.some((c) => ["insert", "update", "delete"].includes(c))) {
          return (r: (v: unknown) => void) => Promise.resolve({ data: null, error: null }).then(r);
        }
        const rows = tables()[table] ?? [];
        const single = chain.includes("maybeSingle") || chain.includes("single");
        return (r: (v: unknown) => void) =>
          Promise.resolve({ data: single ? (rows[0] ?? null) : rows, error: null, count: 0 }).then(r);
      }
      return () => builder(table, [...chain, prop]);
    },
  });

export const createClient = () => ({
  from: (table: string) => builder(table),
  auth: { admin: { generateLink: async () => ({ data: null, error: null }) } },
});
