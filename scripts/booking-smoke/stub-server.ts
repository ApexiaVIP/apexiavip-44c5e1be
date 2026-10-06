// Captures the handler that the edge function hands to serve(), so the smoke
// test can call it directly instead of opening a port.
export const serve = (handler: (req: Request) => Promise<Response>) => {
  (globalThis as Record<string, unknown>).__handler = handler;
};
