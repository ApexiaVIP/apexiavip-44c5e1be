import type { ReactNode } from "react";
import Header from "@/components/Header";

/**
 * App-style layout for member screens (Bookings, Account, Admin): the site
 * navigation stays present instead of a "back to site" link.
 */
const MemberLayout = ({ children }: { children: ReactNode }) => (
  <div className="min-h-screen bg-background">
    <Header />
    <main className="pt-40 md:pt-44">{children}</main>
  </div>
);

export default MemberLayout;
