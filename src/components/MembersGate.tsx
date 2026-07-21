import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Lock } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";

const MembersGate = ({ children }: { children: ReactNode }) => {
  const { user, profile, mfaVerified, loading, signOut } = useAuth();

  if (loading) {
    return (
      <div className="space-y-4 py-8">
        <Skeleton className="h-8 w-1/2 mx-auto" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (user && !mfaVerified) {
    return (
      <div className="text-center py-16 border border-border">
        <div className="w-12 h-12 rounded-full border border-champagne-muted flex items-center justify-center mx-auto mb-6">
          <Lock className="w-5 h-5 text-champagne" />
        </div>
        <h3 className="font-display text-2xl tracking-wider text-foreground mb-3">
          Verification Required
        </h3>
        <p className="text-smoke text-sm font-light leading-relaxed mb-8 max-w-sm mx-auto">
          For your security, please confirm the code we send you before
          making a booking.
        </p>
        <Link
          to="/login"
          state={{ from: "/#contact" }}
          className="inline-block border border-champagne text-champagne hover:bg-champagne hover:text-background transition-colors duration-500 text-xs tracking-[0.2em] uppercase px-10 py-4"
        >
          Verify Now
        </Link>
      </div>
    );
  }

  if (!user || (profile && profile.status !== "active")) {
    return (
      <div className="text-center py-16 border border-border">
        <div className="w-12 h-12 rounded-full border border-champagne-muted flex items-center justify-center mx-auto mb-6">
          <Lock className="w-5 h-5 text-champagne" />
        </div>
        <h3 className="font-display text-2xl tracking-wider text-foreground mb-3">
          Members Only
        </h3>
        <p className="text-smoke text-sm font-light leading-relaxed mb-8 max-w-sm mx-auto">
          Bookings are reserved for invited members. Sign in with your
          membership details to continue.
        </p>
        <Link
          to="/login"
          state={{ from: "/#contact" }}
          className="inline-block border border-champagne text-champagne hover:bg-champagne hover:text-background transition-colors duration-500 text-xs tracking-[0.2em] uppercase px-10 py-4"
        >
          Member Sign In
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8 pb-4 border-b border-border">
        <p className="text-smoke text-xs tracking-[0.15em] uppercase">
          Signed in{profile?.full_name ? ` as ${profile.full_name}` : ""}
        </p>
        <button
          type="button"
          onClick={() => signOut()}
          className="text-smoke hover:text-foreground transition-colors text-xs tracking-[0.15em] uppercase"
        >
          Sign Out
        </button>
      </div>
      {children}
    </div>
  );
};

export default MembersGate;
