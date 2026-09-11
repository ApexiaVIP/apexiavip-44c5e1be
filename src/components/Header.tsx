import { Link } from "react-router-dom";
import apexiaLogo from "@/assets/apexia-logo.svg";
import { useAuth } from "@/hooks/useAuth";
import { isInstalledApp } from "@/lib/appLinks";

const Header = () => {
  const { user, isAdmin, signOut } = useAuth();
  const native = isInstalledApp();
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md pt-[env(safe-area-inset-top)]">
      <div className="container mx-auto px-8 py-6">
        <nav className="flex items-center justify-between">
          <Link to="/" className="flex items-center space-x-3">
            <img src={apexiaLogo} alt="Apexia VIP" className="h-14 md:h-16 w-auto" width="944" height="550" />
          </Link>
          
          <div className="flex items-center space-x-6 md:space-x-12">
            {!native && (
              <>
                <a
                  href="/#services"
                  className="hidden md:inline text-smoke hover:text-foreground transition-colors duration-500 text-xs tracking-[0.2em] uppercase"
                >
                  Services
                </a>
                <a
                  href="/#contact"
                  className="hidden md:inline text-smoke hover:text-foreground transition-colors duration-500 text-xs tracking-[0.2em] uppercase"
                >
                  Contact
                </a>
                <Link
                  to="/app"
                  className="text-smoke hover:text-foreground transition-colors duration-500 text-xs tracking-[0.2em] uppercase"
                >
                  App
                </Link>
              </>
            )}
            {isAdmin && !native && (
              <Link
                to="/admin"
                className="text-smoke hover:text-foreground transition-colors duration-500 text-xs tracking-[0.2em] uppercase"
              >
                Admin
              </Link>
            )}
            {user && !native && (
              <Link
                to="/bookings"
                className="text-smoke hover:text-foreground transition-colors duration-500 text-xs tracking-[0.2em] uppercase"
              >
                Bookings
              </Link>
            )}
            {user && !native && (
              <Link
                to="/profile"
                className="text-smoke hover:text-foreground transition-colors duration-500 text-xs tracking-[0.2em] uppercase"
              >
                Account
              </Link>
            )}
            {user ? (
              <button
                type="button"
                onClick={() => signOut()}
                className="text-smoke hover:text-foreground transition-colors duration-500 text-xs tracking-[0.2em] uppercase"
              >
                Sign Out
              </button>
            ) : (
              <Link
                to="/login"
                className="text-champagne hover:text-foreground transition-colors duration-500 text-xs tracking-[0.2em] uppercase"
              >
                Members
              </Link>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
};

export default Header;
