import { isInstalledApp } from "@/lib/appLinks";

/**
 * Inside the store apps the page should behave like an app, not a web page:
 * no pinch zoom, no sideways pan, no text selection on chrome, and the
 * layout allowed under the notch and home indicator. The website itself
 * keeps normal browser behaviour, including zoom for accessibility.
 */
export const installNativeShell = () => {
  if (typeof document === "undefined" || !isInstalledApp()) return;

  document.documentElement.classList.add("native");

  const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (viewport) {
    viewport.content =
      "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";
  }
};
