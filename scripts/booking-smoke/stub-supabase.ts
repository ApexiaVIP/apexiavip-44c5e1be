// A stand-in for the supabase-js query builder: every method chains, and
// awaiting the chain yields a plausible row for the table in question. The
// smoke test only needs the handler to get all the way through, not real data.
const result = (table: string, chain: string[]) => {
  const c = chain.join(".");
  if (table === "mfa_sessions") return { data: { id: "mfa-1" }, error: null };
  if (table === "profiles" && c.includes("maybeSingle")) return { data: { status: "active" }, error: null };
  if (table === "rate_limits") return { data: [], error: null, count: 0 };
  if (table === "bookings" && c.includes("maybeSingle")) {
    return { data: { reference: "APEXIA-1", user_id: "user-1" }, error: null };
  }
  return { data: [], error: null };
};

const builder = (table: string, chain: string[] = []): Record<string, unknown> =>
  new Proxy({}, {
    get(_target, prop: string) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => Promise.resolve(result(table, chain)).then(resolve);
      }
      return () => builder(table, [...chain, prop]);
    },
  });

export const createClient = () => ({
  from: (table: string) => builder(table),
  auth: {
    getUser: async () => ({ data: { user: { id: "user-1", email: "member@example.com" } }, error: null }),
  },
  rpc: async () => ({ data: null, error: null }),
});
