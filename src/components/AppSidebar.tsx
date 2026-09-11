import { useLocation } from "react-router-dom";
import { AppleIcon, PlayIcon } from "@/components/AppBadges";
import { APP_STORE_URL, PLAY_STORE_URL, isInstalledApp } from "@/lib/appLinks";

/**
 * A slim rail pinned to the right edge with the two store icons. Desktop
 * only: on a phone the header link does the job, and inside the apps there
 * is nothing to install. Stays off the partner desk, which has its own look.
 */
const AppSidebar = () => {
  const { pathname } = useLocation();
  const onDesk =
    pathname.startsWith("/mcfc") ||
    (typeof window !== "undefined" && window.location.hostname.startsWith("mcfc."));
  if (onDesk || pathname === "/app" || isInstalledApp()) return null;

  const item =
    "group relative flex items-center justify-center w-11 h-11 text-smoke hover:text-foreground transition-colors duration-500";
  const tip =
    "pointer-events-none absolute right-full mr-3 whitespace-nowrap text-[10px] tracking-[0.2em] uppercase text-smoke opacity-0 translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-500";

  return (
    <aside
      aria-label="Get the app"
      className="hidden md:flex fixed right-0 top-1/2 -translate-y-1/2 z-40 flex-col items-center border border-r-0 border-champagne-muted bg-background/70 backdrop-blur-md py-3 px-1 animate-fade-in"
    >
      <span className="text-[9px] tracking-[0.3em] uppercase text-champagne [writing-mode:vertical-rl] rotate-180 mb-3 select-none">
        The app
      </span>
      <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer" className={item} title="Apexia VIP on the App Store">
        <span className={tip}>App Store</span>
        <AppleIcon className="w-5 h-5" />
      </a>
      <div className="w-6 h-px bg-champagne-muted my-1" />
      <a href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer" className={item} title="Apexia VIP on Google Play">
        <span className={tip}>Google Play</span>
        <PlayIcon className="w-5 h-5" />
      </a>
    </aside>
  );
};

export default AppSidebar;
