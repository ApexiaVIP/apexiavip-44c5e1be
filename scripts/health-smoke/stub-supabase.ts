// Stand-in for supabase-js, enough for a table read.
type Row = Record<string, unknown>;
const tables = () => ((globalThis as Record<string, never>).__tables ?? {}) as Record<string, Row[]>;

export const createClient = () => ({
  from: (table: string) => ({
    select: (_columns: string) => {
      if ((globalThis as Record<string, unknown>).__readFails) {
        return Promise.resolve({ data: null, error: new Error("database unreachable") });
      }
      return Promise.resolve({ data: tables()[table] ?? [], error: null });
    },
  }),
});
