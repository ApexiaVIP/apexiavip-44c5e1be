import { Link } from "react-router-dom";
import AuthShell from "@/components/AuthShell";

/**
 * Informational landing for welcome emails and legacy invite links.
 * Sign-in is passwordless (mobile + SMS code), so there is nothing to set up.
 */
const Welcome = () => (
  <AuthShell
    eyebrow="Welcome to Apexia VIP"
    title="Your Membership Is Ready"
    subtitle="Sign in with the mobile number registered with your membership. We will text you a secure access code. There is no password to remember."
  >
    <Link
      to="/login"
      className="inline-block border border-champagne text-champagne hover:bg-champagne hover:text-background transition-colors duration-500 text-xs tracking-[0.2em] uppercase px-10 py-4"
    >
      Member Sign In
    </Link>
  </AuthShell>
);

export default Welcome;
