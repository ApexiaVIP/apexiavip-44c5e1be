export const createClient = () => ({
  from: () =>
    new Proxy({}, {
      get(_t, prop: string) {
        if (prop === "then")
          return (r: (v: unknown) => void) =>
            Promise.resolve({ data: [], error: null, count: 0 }).then(r);
        return () => createClient().from();
      },
    }),
  auth: {
    getUser: async () => ({ data: { user: { id: "member-1" } }, error: null }),
  },
});
