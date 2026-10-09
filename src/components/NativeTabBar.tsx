import { NavLink, useLocation } from "react-router-dom";
import { CalendarPlus, CarFront, Navigation, ShieldCheck, UserRound } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { isInstalledApp } from "@/lib/appLinks";

const memberTabs = [
  { to: "/book", label: "Book", icon: CalendarPlus },
  { to: "/bookings", label: "Bookings", icon: CarFront },
  { to: "/profile", label: "Account", icon: UserRound },
];

/**
 * Bottom navigation for the store apps. Only appears once a member is
 * signed in, and never on the website.
 */
const NativeTabBar = () => {
  const { user, profile, mfaVerified, isAdmin } = useAuth();
  const { pathname } = useLocation();
  if (!isInstalledApp() || !user || !mfaVerified) return null;
  if (pathname === "/login" || pathname.startsWith("/mcfc")) return null;

  const isChauffeur = (profile as { is_driver?: boolean } | null)?.is_driver === true;
  // A chauffeur has one screen, so the bar would only get in the way. Someone
  // who is both, which the office are while they are testing, keeps it.
  if (isChauffeur && !isAdmin) return null;

  const visible = [
    ...memberTabs,
    ...(isChauffeur ? [{ to: "/driver", label: "Driving", icon: Navigation }] : []),
    ...(isAdmin ? [{ to: "/admin", label: "Admin", icon: ShieldCheck }] : []),
  ];

  return (
    <nav
      aria-label="App navigation"
      className="fixed bottom-0 left-0 right-0 z-50 bg-background/90 backdrop-blur-md border-t border-border pb-[env(safe-area-inset-bottom)]"
    >
      <div className="flex">
        {visible.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center gap-1.5 pt-3 pb-2 text-[10px] tracking-[0.2em] uppercase transition-colors duration-300 ${
                isActive ? "text-champagne" : "text-smoke"
              }`
            }
          >
            <Icon className="w-5 h-5" strokeWidth={1.5} />
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
};

export default NativeTabBar;
