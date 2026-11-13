/**
 * Asking once more for a path the app does not own.
 *
 * Contact cards and the signature install page are static files on the domain,
 * not app routes. The service worker sits in front of them, and a worker
 * installed before those paths existed answers them from the app shell, so the
 * visitor lands on the app's not-found screen instead of their contact card.
 * The worker updates during that same load, so asking for the page a second
 * time gets the real file.
 *
 * Guarded to one attempt per path, because a reload that keeps failing is worse
 * than the screen it was trying to avoid.
 */
const SERVED_AS_FILES = /^\/(contacts|vcards|setup)\//;
const ALREADY_TRIED = "static-path-retried";

export interface Retry {
  tried: () => string | null;
  remember: (pathname: string) => void;
  askAgain: () => void;
}

export const inBrowser: Retry = {
  tried: () => {
    try {
      return window.sessionStorage.getItem(ALREADY_TRIED);
    } catch {
      return null;
    }
  },
  remember: (pathname) => {
    try {
      window.sessionStorage.setItem(ALREADY_TRIED, pathname);
    } catch {
      // A browser that refuses storage gets one attempt and no memory of it,
      // which is the same outcome as not trying at all.
    }
  },
  askAgain: () => window.location.reload(),
};

/** True when the page was asked for again, so the caller should sit still. */
export const retryStaticPath = (pathname: string, how: Retry = inBrowser): boolean => {
  if (!SERVED_AS_FILES.test(pathname)) return false;
  if (how.tried() === pathname) return false;
  how.remember(pathname);
  how.askAgain();
  return true;
};
