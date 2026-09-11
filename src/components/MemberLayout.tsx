import type { ReactNode } from "react";
import Header from "@/components/Header";
import { isInstalledApp } from "@/lib/appLinks";

/**
 * App-style layout for member screens (Bookings, Account, Admin): the site
 * navigation stays present instead of a "back to site" link.
 */
const MemberLayout = ({ children }: { children: ReactNode }) => (
  <div className="min-h-screen bg-background">
    <Header />
    <main
      className={
        isInstalledApp()
          ? "pt-[calc(env(safe-area-inset-top)+8.5rem)] pb-[calc(env(safe-area-inset-bottom)+5.5rem)]"
          : "pt-40 md:pt-44"
      }
    >
      {children}
    </main>
  </div>
);

export default MemberLayout;
