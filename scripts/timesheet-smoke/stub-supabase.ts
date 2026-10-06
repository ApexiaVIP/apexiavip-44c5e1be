// Stand-in for supabase-js. Each table answers with the rows the test set up;
// the date filtering is the database's job and is not what this test is for.
const tables: Record<string, unknown[]> = (globalThis as Record<string, never>).__tables ?? {};

const builder = (table: string): Record<string, unknown> =>
  new Proxy({}, {
    get(_t, prop: string) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) =>
          Promise.resolve({ data: tables[table] ?? [], error: null }).then(resolve);
      }
      return () => builder(table);
    },
  });

export const createClient = () => ({ from: (table: string) => builder(table) });
