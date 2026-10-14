export const serve = (handler: (req: Request) => Promise<Response>) => {
  (globalThis as Record<string, unknown>).__handler = handler;
};
