// Stand-in for supabase-js. Each table answers with the rows the test set up.
// maybeSingle gives one row or null, as the real client does, because code
// that branches on "did we find one" is exactly what these tests check.
const tables = () => (globalThis as Record<string, never>).__tables ?? {};
const writes: { table: string; op: string; payload: unknown }[] = [];
(globalThis as Record<string, unknown>).__writes = writes;

const builder = (table: string, chain: string[] = [], payload?: unknown): Record<string, unknown> =>
  new Proxy({}, {
    get(_t, prop: string) {
      if (prop === "then") {
        const rows = (tables() as Record<string, unknown[]>)[table] ?? [];
        if (chain.includes("insert") || chain.includes("update") || chain.includes("delete")) {
          writes.push({ table, op: chain.find((c) => ["insert", "update", "delete"].includes(c))!, payload });
          return (r: (v: unknown) => void) => Promise.resolve({ data: null, error: null }).then(r);
        }
        const data = chain.includes("maybeSingle") ? (rows[0] ?? null) : rows;
        return (r: (v: unknown) => void) => Promise.resolve({ data, error: null }).then(r);
      }
      return (...args: unknown[]) =>
        builder(table, [...chain, prop], ["insert", "update"].includes(prop) ? args[0] : payload);
    },
  });

export const createClient = () => ({ from: (table: string) => builder(table) });
