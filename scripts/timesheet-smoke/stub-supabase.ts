// Stand-in for supabase-js.
//
// It applies the filters it is given rather than handing back every row: a
// stub that ignores `.gte` cannot tell you whether a query's date window
// works, and would report a pass on a rule that does not exist.
type Row = Record<string, unknown>;

const tables = () => ((globalThis as Record<string, never>).__tables ?? {}) as Record<string, Row[]>;
const writes: { table: string; op: string; payload: unknown }[] = [];
(globalThis as Record<string, unknown>).__writes = writes;

interface Filter {
  op: string;
  column: string;
  value: unknown;
}

const keep = (row: Row, f: Filter): boolean => {
  const v = row[f.column];
  switch (f.op) {
    case "eq":
      return v === f.value;
    case "neq":
      return v !== f.value;
    case "is":
      return f.value === null ? v === null || v === undefined : v === f.value;
    case "in":
      return Array.isArray(f.value) && (f.value as unknown[]).includes(v);
    case "gte":
      return v !== null && v !== undefined && String(v) >= String(f.value);
    case "lte":
      return v !== null && v !== undefined && String(v) <= String(f.value);
    default:
      return true;
  }
};

const builder = (
  table: string,
  chain: string[] = [],
  filters: Filter[] = [],
  payload?: unknown
): Record<string, unknown> =>
  new Proxy({}, {
    get(_t, prop: string) {
      if (prop === "then") {
        const op = chain.find((c) => ["insert", "update", "delete"].includes(c));
        if (op) {
          writes.push({ table, op, payload });
          return (r: (v: unknown) => void) => Promise.resolve({ data: null, error: null }).then(r);
        }
        const rows = (tables()[table] ?? []).filter((row) => filters.every((f) => keep(row, f)));
        const data = chain.includes("maybeSingle") ? (rows[0] ?? null) : rows;
        return (r: (v: unknown) => void) => Promise.resolve({ data, error: null }).then(r);
      }
      return (...args: unknown[]) => {
        if (["eq", "neq", "is", "in", "gte", "lte"].includes(prop)) {
          return builder(
            table,
            [...chain, prop],
            [...filters, { op: prop, column: args[0] as string, value: args[1] }],
            payload
          );
        }
        return builder(
          table,
          [...chain, prop],
          filters,
          ["insert", "update"].includes(prop) ? args[0] : payload
        );
      };
    },
  });

export const createClient = () => ({ from: (table: string) => builder(table) });
