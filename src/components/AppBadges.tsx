import { APP_STORE_URL, PLAY_STORE_URL, isInstalledApp } from "@/lib/appLinks";

export const AppleIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
    <path d="M16.37 12.7c-.02-2.3 1.88-3.4 1.96-3.45-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.15-2.76.83-3.48.83-.72 0-1.83-.81-3-.79-1.55.02-2.97.9-3.77 2.28-1.6 2.78-.41 6.9 1.15 9.16.77 1.1 1.68 2.34 2.87 2.3 1.15-.05 1.59-.75 2.98-.75s1.78.75 3 .72c1.24-.02 2.02-1.12 2.78-2.23.87-1.28 1.23-2.52 1.25-2.58-.03-.01-2.4-.92-2.42-3.69zM14.1 5.98c.63-.77 1.06-1.84.94-2.9-.91.04-2.02.61-2.67 1.37-.58.68-1.1 1.77-.96 2.81 1.02.08 2.05-.52 2.69-1.28z" />
  </svg>
);

export const PlayIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
    <path d="M3.6 2.4c-.24.25-.38.63-.38 1.13v16.94c0 .5.14.88.39 1.12l.06.06L13.16 12v-.22L3.66 2.34l-.06.06zm12.72 12.78L13.16 12v-.22l3.16-3.17.07.04 3.75 2.13c1.07.6 1.07 1.6 0 2.2l-3.75 2.13-.07.07zm-.07.07L13.16 12 3.6 21.6c.35.37.94.42 1.6.04l11.05-6.39zM5.2 2.36c-.66-.37-1.25-.33-1.6.04L13.16 12l3.09-3.24L5.2 2.36z" />
  </svg>
);

interface Props {
  className?: string;
  /** "sm" is the quiet icon-and-label pair; "lg" is a proper store button */
  size?: "sm" | "lg";
}

/**
 * App Store and Google Play links. Renders nothing inside the store apps
 * themselves, where an invitation to install would be odd.
 */
const AppBadges = ({ className = "", size = "sm" }: Props) => {
  if (isInstalledApp()) return null;

  if (size === "lg") {
    const button =
      "group inline-flex items-center gap-4 border border-champagne-muted hover:border-champagne px-6 py-4 transition-colors duration-500 min-w-[200px]";
    return (
      <div className={`flex flex-col sm:flex-row items-center gap-4 ${className}`}>
        <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer" className={button}>
          <AppleIcon className="w-7 h-7 text-foreground" />
          <span className="text-left leading-tight">
            <span className="block text-[9px] tracking-[0.25em] uppercase text-smoke">Download on the</span>
            <span className="block text-sm tracking-[0.15em] uppercase text-foreground">App Store</span>
          </span>
        </a>
        <a href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer" className={button}>
          <PlayIcon className="w-7 h-7 text-foreground" />
          <span className="text-left leading-tight">
            <span className="block text-[9px] tracking-[0.25em] uppercase text-smoke">Get it on</span>
            <span className="block text-sm tracking-[0.15em] uppercase text-foreground">Google Play</span>
          </span>
        </a>
      </div>
    );
  }

  const link =
    "group inline-flex items-center gap-2 text-smoke hover:text-foreground transition-colors";
  const label = "text-[10px] tracking-[0.2em] uppercase";

  return (
    <div className={`flex items-center gap-6 ${className}`}>
      <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer" className={link}>
        <AppleIcon className="w-4 h-4" />
        <span className={label}>App Store</span>
      </a>
      <a href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer" className={link}>
        <PlayIcon className="w-4 h-4" />
        <span className={label}>Google Play</span>
      </a>
    </div>
  );
};

export default AppBadges;
